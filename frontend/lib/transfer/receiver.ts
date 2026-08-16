import type { FileMetadata } from '../webrtc/signaling';
import type { FileStorage } from '../storage';
import { sha256Stream } from './hashing';
import { parse, type ProtocolMessage } from './protocol';

export type { FileMetadata };

export interface ReceiverProgress {
  fileId: string;
  fileName: string;
  totalBytes: number;
  receivedBytes: number;
  totalChunks: number;
  receivedChunks: number;
  speed: number;
  averageSpeed: number;
  eta: number;
  state: 'idle' | 'negotiating' | 'transferring' | 'paused' | 'verifying' | 'done' | 'error';
  error?: string;
  hashResult?: 'pending' | 'ok' | 'mismatch';
  expectedHash?: string;
  computedHash?: string;
  path?: string;
}

export type ReceiverListener = (p: ReceiverProgress) => void;

export interface ReceiverOptions {
  channel: RTCDataChannel;
  storage: FileStorage;
  onProgress?: ReceiverListener;
  onLog?: (msg: string) => void;
  onFileComplete?: (file: FileMetadata, blob: Blob) => void;
  verifyIntegrity?: boolean;
}

export class Receiver {
  private channel: RTCDataChannel;
  private storage: FileStorage;
  private onProgress?: ReceiverListener;
  private onFileComplete?: (file: FileMetadata, blob: Blob) => void;
  private onLog?: (msg: string) => void;
  private fileList: FileMetadata[] = [];
  private chunkSize = 1024 * 1024;
  private progress: Map<string, ReceiverProgress> = new Map();
  private expectedHashes: Map<string, string> = new Map();
  private startedAt = performance.now();
  private lastTick = 0;
  private requesting = false;
  private verifyAssembled: boolean;
  private pendingOffer: { fileId: string; index: number; size: number } | null = null;
  private lastSpeedSample: { bytes: number; t: number } = { bytes: 0, t: 0 };

  constructor(opts: ReceiverOptions) {
    this.channel = opts.channel;
    this.storage = opts.storage;
    this.onProgress = opts.onProgress;
    this.onFileComplete = opts.onFileComplete;
    this.onLog = opts.onLog;
    this.verifyAssembled = opts.verifyIntegrity ?? true;
  }

  start() {
    this.channel.binaryType = 'arraybuffer';
    this.channel.addEventListener('message', (ev) => this.onMessage(ev));
    this.channel.addEventListener('close', () => this.onClose());
    this.channel.addEventListener('error', (e) => this.onError((e as ErrorEvent).message));
    this.send({ type: 'HELLO', version: 1, peerId: this.channel.label });
    this.lastSpeedSample = { bytes: 0, t: performance.now() };
  }

  private send(msg: ProtocolMessage) {
    if (this.channel.readyState !== 'open') return;
    this.channel.send(JSON.stringify(msg));
  }

  private async onMessage(ev: MessageEvent) {
    if (typeof ev.data === 'string') {
      const msg = parse(ev.data);
      if (msg) await this.handleControl(msg);
    } else if (ev.data instanceof ArrayBuffer) {
      await this.handleChunkData(ev.data);
    }
  }

  private onClose() {
    for (const p of this.progress.values()) {
      if (p.state !== 'done') p.state = 'error';
    }
  }

  private onError(msg: string) {
    for (const p of this.progress.values()) {
      if (p.state !== 'done') {
        p.state = 'error';
        p.error = msg;
      }
    }
  }

  private async handleControl(msg: ProtocolMessage) {
    switch (msg.type) {
      case 'FILE_LIST': {
        this.fileList = msg.files;
        this.chunkSize = msg.chunkSize;
        for (const f of msg.files) {
          const existing = await this.storage.receivedChunks(f.id);
          const p: ReceiverProgress = {
            fileId: f.id,
            fileName: f.name,
            totalBytes: f.size,
            receivedBytes: Math.min(f.size, existing.size * this.chunkSize),
            totalChunks: f.totalChunks,
            receivedChunks: existing.size,
            speed: 0,
            averageSpeed: 0,
            eta: 0,
            state: 'negotiating',
            path: f.path,
          };
          this.progress.set(f.id, p);
        }
        await this.requestFiles();
        break;
      }
      case 'CHUNK_OFFER': {
        this.pendingOffer = { fileId: msg.fileId, index: msg.chunkIndex, size: msg.size };
        break;
      }
      case 'TRANSFER_COMPLETE': {
        const p = this.progress.get(msg.fileId);
        const file = this.fileList.find((f) => f.id === msg.fileId);
        if (!p || !file) break;
        p.state = 'verifying';
        p.hashResult = 'pending';
        this.emit(p);
        try {
          const blob = await this.storage.assemble(file.id, file.mime);
          if (this.verifyAssembled) {
            const computed = await sha256Stream(blob);
            p.computedHash = computed;
            const expected = this.expectedHashes.get(file.id);
            if (expected) {
              p.expectedHash = expected;
              p.hashResult = expected === computed ? 'ok' : 'mismatch';
            } else {
              p.hashResult = 'ok';
            }
          }
          p.state = 'done';
          p.receivedBytes = p.totalBytes;
          p.receivedChunks = p.totalChunks;
          this.emit(p);
          this.onFileComplete?.(file, blob);
        } catch (err) {
          p.state = 'error';
          p.error = String(err);
          this.emit(p);
        }
        break;
      }
      case 'HASH': {
        this.expectedHashes.set(msg.fileId, msg.sha256);
        const p = this.progress.get(msg.fileId);
        if (p) {
          p.expectedHash = msg.sha256;
          this.emit(p);
        }
        break;
      }
      case 'PAUSE': {
        for (const p of this.progress.values()) p.state = 'paused';
        break;
      }
      case 'RESUME': {
        for (const p of this.progress.values()) {
          if (p.state === 'paused') p.state = 'transferring';
        }
        break;
      }
      case 'ERROR': {
        for (const p of this.progress.values()) {
          if (p.state !== 'done') {
            p.state = 'error';
            p.error = msg.message;
          }
        }
        break;
      }
    }
  }

  private async requestFiles() {
    if (this.requesting) return;
    this.requesting = true;
    try {
      for (const f of this.fileList) {
        const p = this.progress.get(f.id);
        if (!p) continue;
        let existing: Set<number>;
        try {
          existing = await this.storage.receivedChunks(f.id);
        } catch {
          existing = new Set();
        }
        if (existing.size >= f.totalChunks) {
          p.state = 'done';
          p.receivedBytes = p.totalBytes;
          p.receivedChunks = p.totalChunks;
          this.emit(p);
          continue;
        }
        p.state = 'transferring';
        this.emit(p);
        this.send({ type: 'FILE_REQUEST', fileId: f.id, resumeFrom: [...existing] });
      }
    } finally {
      this.requesting = false;
    }
  }

  private async handleChunkData(buf: ArrayBuffer) {
    if (!this.pendingOffer) return;
    const { fileId, index, size } = this.pendingOffer;
    this.pendingOffer = null;
    if (buf.byteLength !== size) {
      this.send({ type: 'CHUNK_FAIL', fileId, chunkIndex: index, reason: 'size mismatch' });
      return;
    }
    try {
      await this.storage.writeChunk(fileId, index, buf);
      const p = this.progress.get(fileId);
      if (p) {
        p.receivedChunks++;
        p.receivedBytes = Math.min(p.totalBytes, p.receivedBytes + buf.byteLength);
        this.updateSpeed(p);
        this.emitTick(p);
      }
      this.send({ type: 'CHUNK_ACK', fileId, chunkIndex: index });
    } catch (err) {
      this.send({ type: 'CHUNK_FAIL', fileId, chunkIndex: index, reason: String(err) });
    }
  }

  private updateSpeed(p: ReceiverProgress) {
    const now = performance.now();
    const dt = (now - this.lastSpeedSample.t) / 1000;
    const dBytes = p.receivedBytes - this.lastSpeedSample.bytes;
    if (dt > 0.4) {
      p.speed = dBytes / dt;
      this.lastSpeedSample = { bytes: p.receivedBytes, t: now };
    }
    const elapsed = (now - this.startedAt) / 1000;
    if (elapsed > 0) p.averageSpeed = p.receivedBytes / elapsed;
    const remaining = p.totalBytes - p.receivedBytes;
    p.eta = p.speed > 0 ? remaining / p.speed : 0;
  }

  private emit(p: ReceiverProgress) {
    this.onProgress?.(p);
  }

  private emitTick(p: ReceiverProgress) {
    const now = performance.now();
    if (now - this.lastTick < 100 && p.state !== 'done' && p.state !== 'error') return;
    this.lastTick = now;
    this.onProgress?.(p);
  }

  getProgress(): ReceiverProgress[] {
    return [...this.progress.values()];
  }

  close() {
    try {
      this.channel.close();
    } catch {}
  }
}
