import type { FileMetadata } from '../webrtc/signaling';
import { FlowController, attachBufferEvents } from './flow-control';
import { chunkRangeFor, type ChunkPlan, DEFAULT_CHUNK_SIZE, missingChunkIndexes } from './chunker';
import { sha256Stream } from './hashing';
import { encode, type ProtocolMessage } from './protocol';

export interface SenderFileEntry {
  metadata: FileMetadata;
  file: File | Blob;
  plan: ChunkPlan;
  computedHash?: string;
}

export interface SenderProgress {
  fileId: string;
  totalBytes: number;
  sentBytes: number;
  totalChunks: number;
  sentChunks: number;
  speed: number;
  averageSpeed: number;
  eta: number;
  state: 'idle' | 'preparing' | 'waiting' | 'transferring' | 'paused' | 'verifying' | 'done' | 'error';
  error?: string;
}

export type SenderListener = (p: SenderProgress) => void;

export interface SenderOptions {
  channel: RTCDataChannel;
  files: SenderFileEntry[];
  onProgress?: SenderListener;
  onLog?: (msg: string) => void;
  highWaterMark?: number;
  lowWaterMark?: number;
  chunkSize?: number;
  computeHash?: boolean;
}

export class Sender {
  private channel: RTCDataChannel;
  private files: SenderFileEntry[];
  private onProgress?: SenderListener;
  private onLog?: (msg: string) => void;
  private flow: FlowController;
  private chunkSize: number;
  private computeHash: boolean;
  private running = false;
  private paused = false;
  private currentFileIndex = 0;
  private progress: Map<string, SenderProgress> = new Map();
  private detachBuffer: (() => void) | null = null;
  private lastUpdateAt = 0;
  private speedSamples: { bytes: number; t: number }[] = [];

  constructor(opts: SenderOptions) {
    this.channel = opts.channel;
    this.files = opts.files;
    this.onProgress = opts.onProgress;
    this.onLog = opts.onLog;
    this.flow = new FlowController(opts.highWaterMark, opts.lowWaterMark);
    this.chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.computeHash = opts.computeHash ?? true;
    for (const entry of opts.files) {
      this.progress.set(entry.metadata.id, this.makeInitial(entry));
    }
  }

  private makeInitial(entry: SenderFileEntry): SenderProgress {
    return {
      fileId: entry.metadata.id,
      totalBytes: entry.metadata.size,
      sentBytes: 0,
      totalChunks: entry.plan.totalChunks,
      sentChunks: 0,
      speed: 0,
      averageSpeed: 0,
      eta: 0,
      state: 'idle',
    };
  }

  attach() {
    this.detachBuffer?.();
    this.detachBuffer = attachBufferEvents(this.channel, this.flow, () => this.maybeTick());
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.channel.addEventListener('open', () => this.onOpen());
    this.channel.addEventListener('close', () => this.onClose());
    this.channel.addEventListener('error', (e) => this.onError((e as ErrorEvent).message));
    if (this.channel.readyState === 'open') this.onOpen();
  }

  pause() {
    this.paused = true;
    this.channel.send(encode({ type: 'PAUSE', fileId: '' } as ProtocolMessage));
  }

  resume() {
    this.paused = false;
    this.channel.send(encode({ type: 'RESUME', fileId: '' } as ProtocolMessage));
  }

  close() {
    this.running = false;
    this.flow.forceResume();
    this.detachBuffer?.();
    this.detachBuffer = null;
    try {
      this.channel.close();
    } catch {}
  }

  private onOpen() {
    this.runLoop().catch((err) => this.onError(String(err)));
  }

  private onClose() {
    this.detachBuffer?.();
    this.detachBuffer = null;
    this.running = false;
  }

  private onError(msg: string) {
    for (const [id, p] of this.progress) {
      p.state = 'error';
      p.error = msg;
      this.emit(p);
    }
  }

  private async runLoop() {
    this.sendHello();
    this.sendFileList();

    for (let i = 0; i < this.files.length; i++) {
      this.currentFileIndex = i;
      const entry = this.files[i];
      const prog = this.progress.get(entry.metadata.id)!;
      prog.state = 'waiting';
      this.emit(prog);
      await this.waitForFileRequest(entry.metadata.id);

      if (this.computeHash) {
        prog.state = 'verifying';
        this.emit(prog);
        entry.computedHash = await sha256Stream(entry.file, (bytes) => {
          const total = entry.file.size;
          const percent = bytes / total;
          prog.sentBytes = Math.max(prog.sentBytes, Math.floor(bytes * 0.001));
          this.maybeTick();
        });
        this.sendHash(entry.metadata.id, entry.computedHash);
      }

      prog.state = 'transferring';
      this.emit(prog);
      this.lastUpdateAt = performance.now();
      this.speedSamples = [];
      await this.sendChunks(entry);
      this.sendComplete(entry.metadata.id);
      prog.state = 'done';
      prog.sentBytes = prog.totalBytes;
      prog.sentChunks = prog.totalChunks;
      this.emit(prog);
    }
  }

  private async waitForFileRequest(fileId: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const handler = (ev: MessageEvent) => {
        const msg = this.parseMessage(ev);
        if (!msg) return;
        if (msg.type === 'FILE_REQUEST' && msg.fileId === fileId) {
          this.channel.removeEventListener('message', handler);
          resolve();
        }
      };
      this.channel.addEventListener('message', handler);
    });
  }

  private async sendChunks(entry: SenderFileEntry) {
    const { metadata, file, plan } = entry;
    const prog = this.progress.get(metadata.id)!;
    let sentChunks = 0;
    const startedAt = performance.now();

    for (let i = 0; i < plan.totalChunks; i++) {
      if (!this.running) return;
      while (this.paused || this.flow.paused) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const range = chunkRangeFor(metadata.size, i, plan.chunkSize);
      const slice = file.slice(range.start, range.end);
      const buf = await slice.arrayBuffer();
      await this.sendChunkWithFlow(metadata.id, i, buf);
      sentChunks++;
      prog.sentChunks = sentChunks;
      prog.sentBytes += buf.byteLength;
      this.updateSpeed(prog, startedAt);
      this.maybeTick();
    }
  }

  private async sendChunkWithFlow(fileId: string, index: number, buf: ArrayBuffer) {
    while (this.flow.paused) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const header: ProtocolMessage = {
      type: 'CHUNK_OFFER',
      fileId,
      chunkIndex: index,
      size: buf.byteLength,
    };
    try {
      const headerStr = encode(header);
      this.channel.send(headerStr);
      this.channel.send(buf);
      this.flow.consider(this.channel.bufferedAmount);
    } catch (err) {
      console.error('[sender] sendChunkWithFlow error:', err, 'chunkIndex:', index, 'bufSize:', buf.byteLength, 'channelState:', this.channel.readyState, 'bufferedAmount:', this.channel.bufferedAmount);
      throw err;
    }
  }

  private sendFileList() {
    const msg: ProtocolMessage = {
      type: 'FILE_LIST',
      files: this.files.map((f) => f.metadata),
      chunkSize: this.chunkSize,
    };
    this.channel.send(encode(msg));
  }

  private sendHash(fileId: string, sha: string) {
    const msg: ProtocolMessage = { type: 'HASH', fileId, sha256: sha };
    this.channel.send(encode(msg));
  }

  private sendComplete(fileId: string) {
    const msg: ProtocolMessage = { type: 'TRANSFER_COMPLETE', fileId };
    this.channel.send(encode(msg));
  }

  private sendHello() {
    const msg: ProtocolMessage = {
      type: 'HELLO',
      version: 1,
      peerId: this.channel.label,
    };
    this.channel.send(encode(msg));
  }

  private parseMessage(ev: MessageEvent): ProtocolMessage | null {
    if (typeof ev.data !== 'string') return null;
    try {
      return JSON.parse(ev.data) as ProtocolMessage;
    } catch {
      return null;
    }
  }

  private updateSpeed(prog: SenderProgress, startedAt: number) {
    const elapsed = (performance.now() - startedAt) / 1000;
    if (elapsed <= 0) return;
    const overall = prog.sentBytes / elapsed;
    prog.averageSpeed = overall;
    const last = this.speedSamples[this.speedSamples.length - 1] ?? { bytes: 0, t: startedAt };
    const dt = (performance.now() - last.t) / 1000;
    const db = prog.sentBytes - last.bytes;
    const inst = dt > 0 ? db / dt : 0;
    prog.speed = inst;
    if (this.speedSamples.length > 10) this.speedSamples.shift();
    this.speedSamples.push({ bytes: prog.sentBytes, t: performance.now() });
    const remaining = prog.totalBytes - prog.sentBytes;
    prog.eta = inst > 0 ? remaining / inst : 0;
  }

  private lastTick = 0;
  private maybeTick() {
    const now = performance.now();
    if (now - this.lastTick > 150) {
      this.lastTick = now;
      for (const p of this.progress.values()) this.emit(p);
    }
  }

  private emit(p: SenderProgress) {
    this.onProgress?.(p);
  }
}

export function planSender(
  files: { id: string; size: number; name: string; mime: string; path?: string }[],
  filesBlobs: Map<string, File | Blob>,
  chunkSize = DEFAULT_CHUNK_SIZE,
): SenderFileEntry[] {
  return files.map((m) => ({
    metadata: {
      id: m.id,
      name: m.name,
      size: m.size,
      mime: m.mime,
      totalChunks: Math.max(1, Math.ceil(m.size / chunkSize)),
      path: m.path,
    },
    file: filesBlobs.get(m.id)!,
    plan: {
      fileId: m.id,
      chunkSize,
      totalChunks: Math.max(1, Math.ceil(m.size / chunkSize)),
    },
  }));
}

export { missingChunkIndexes };
