import { PeerConnection } from './connection';
import { Receiver, type ReceiverProgress } from '../transfer/receiver';
import { Sender, type SenderProgress, type SenderFileEntry } from '../transfer/sender';
import type { FileMetadata, SignalingClient } from './signaling';
import type { FileStorage } from '../storage';

export interface PeerSlot {
  peerId: string;
  pc: PeerConnection;
  dataChannel: RTCDataChannel | null;
  sender?: Sender;
  receiver?: Receiver;
  receiverProgress: ReceiverProgress[];
  senderProgress: SenderProgress[];
  state: RTCPeerConnectionState;
  role: 'host' | 'peer';
  transferStarted?: boolean;
}

export interface RoomState {
  roomId: string;
  password: string | null;
  metadata: import('./signaling').TransferMetadata | null;
  localRole: 'host' | 'peer';
  localPeerId: string;
  hostPeerId: string | null;
  peers: Map<string, PeerSlot>;
}

export class RoomManager {
  state: RoomState;
  private signaling: SignalingClient;
  private onPeersChange: (peers: PeerSlot[]) => void;
  private onMetadata: (meta: import('./signaling').TransferMetadata | null) => void;
  private onLog: (msg: string) => void;
  private storageFactory: () => Promise<FileStorage>;
  private getFileBlobs: () => Map<string, File | Blob>;
  private getFileMeta: () => FileMetadata[];
  private chunkSize: number;

  constructor(opts: {
    signaling: SignalingClient;
    initial: RoomState;
    storageFactory: () => Promise<FileStorage>;
    getFileBlobs: () => Map<string, File | Blob>;
    getFileMeta: () => FileMetadata[];
    chunkSize: number;
    onPeersChange: (peers: PeerSlot[]) => void;
    onMetadata: (meta: import('./signaling').TransferMetadata | null) => void;
    onLog: (msg: string) => void;
  }) {
    this.signaling = opts.signaling;
    this.state = opts.initial;
    this.storageFactory = opts.storageFactory;
    this.getFileBlobs = opts.getFileBlobs;
    this.getFileMeta = opts.getFileMeta;
    this.chunkSize = opts.chunkSize;
    this.onPeersChange = opts.onPeersChange;
    this.onMetadata = opts.onMetadata;
    this.onLog = opts.onLog;
  }

  attach() {
    this.signaling.on('peer-joined', (data: { peerId: string }) => {
      this.handlePeerJoined(data.peerId);
    });
    this.signaling.on('peer-left', (data: { peerId: string }) => {
      this.removePeer(data.peerId);
    });
    this.signaling.on('host-info', (data: { peerId: string; metadata: import('./signaling').TransferMetadata | null }) => {
      this.state.hostPeerId = data.peerId;
      this.state.metadata = data.metadata;
      this.onMetadata(data.metadata);
      // host initiates connection to us
      this.handlePeerJoined(data.peerId, true);
    });
    this.signaling.on('host-metadata', (data: { metadata: import('./signaling').TransferMetadata | null }) => {
      this.state.metadata = data.metadata;
      this.onMetadata(data.metadata);
    });
    this.signaling.on('offer', (data: { from: string; sdp: RTCSessionDescriptionInit }) => {
      this.handleOffer(data.from, data.sdp);
    });
    this.signaling.on('answer', (data: { from: string; sdp: RTCSessionDescriptionInit }) => {
      this.handleAnswer(data.from, data.sdp);
    });
    this.signaling.on('ice-candidate', (data: { from: string; candidate: RTCIceCandidateInit }) => {
      this.handleIce(data.from, data.candidate);
    });
    this.signaling.on('room-closed', () => {
      this.onLog('Room closed by host');
      this.removeAll();
    });
  }

  detach() {
    this.removeAll();
  }

  private async handlePeerJoined(remotePeerId: string, hostInitiates = false) {
    if (this.state.peers.has(remotePeerId)) return;
    const isInitiator =
      (this.state.localRole === 'host' && !hostInitiates) ||
      (this.state.localRole === 'peer' && hostInitiates);
    const pc = new PeerConnection({
      peerId: remotePeerId,
      role: this.state.localRole,
      signaling: this.signaling,
      roomId: this.state.roomId,
      targetPeerId: remotePeerId,
      isInitiator,
      callbacks: {
        onConnectionStateChange: (state) => {
          const slot = this.state.peers.get(remotePeerId);
          if (slot) {
            slot.state = state;
            this.onPeersChange([...this.state.peers.values()]);
          }
        },
        onDataChannel: (dc) => {
          const slot = this.state.peers.get(remotePeerId);
          if (!slot) return;
          if (slot.dataChannel) {
            dc.close();
            return;
          }
          slot.dataChannel = dc;
          this.bindChannel(slot);
          this.onPeersChange([...this.state.peers.values()]);
        },
      },
    });
    const slot: PeerSlot = {
      peerId: remotePeerId,
      pc,
      dataChannel: null,
      receiverProgress: [],
      senderProgress: [],
      state: pc.pc.connectionState,
      role: this.state.localRole === 'host' ? 'peer' : 'host',
    };

    if (this.state.localRole === 'host' && !hostInitiates && !slot.dataChannel) {
      const dc = pc.createDataChannel('dropbeam-0');
      slot.dataChannel = dc;
    }

    this.state.peers.set(remotePeerId, slot);
    this.onPeersChange([...this.state.peers.values()]);

    if (slot.dataChannel) {
      this.bindChannel(slot);
    }
  }

  private async handleOffer(from: string, sdp: RTCSessionDescriptionInit) {
    let slot = this.state.peers.get(from);
    const isNew = !slot;
    if (!slot) {
      await this.handlePeerJoined(from, true);
      slot = this.state.peers.get(from)!;
    }
    await slot.pc.handleOffer(sdp);

    if (isNew && this.state.localRole === 'host' && !slot.dataChannel) {
      const dc = slot.pc.createDataChannel('dropbeam-0');
      slot.dataChannel = dc;
      this.bindChannel(slot);
    }
  }

  private async handleAnswer(from: string, sdp: RTCSessionDescriptionInit) {
    const slot = this.state.peers.get(from);
    if (!slot) return;
    await slot.pc.handleAnswer(sdp);
  }

  private async handleIce(from: string, candidate: RTCIceCandidateInit) {
    const slot = this.state.peers.get(from);
    if (!slot) return;
    await slot.pc.handleIceCandidate(candidate);
  }

  private removePeer(peerId: string) {
    const slot = this.state.peers.get(peerId);
    if (!slot) return;
    try {
      slot.sender?.close?.();
    } catch {}
    try {
      slot.receiver?.close?.();
    } catch {}
    slot.pc.close();
    this.state.peers.delete(peerId);
    this.onPeersChange([...this.state.peers.values()]);
  }

  private removeAll() {
    for (const id of [...this.state.peers.keys()]) this.removePeer(id);
  }

  private bindChannel(slot: PeerSlot) {
    if (!slot.dataChannel) return;
    slot.dataChannel.binaryType = 'arraybuffer';
    slot.dataChannel.addEventListener('close', () => {
      // keep state, allow reconnection
    });
    if (slot.dataChannel.readyState === 'open') {
      this.startTransferForSlot(slot);
    } else {
      slot.dataChannel.addEventListener('open', () => {
        this.startTransferForSlot(slot);
      }, { once: true });
    }
  }

  private startTransferForSlot(slot: PeerSlot) {
    if (slot.transferStarted) return;
    slot.transferStarted = true;
    if (this.state.localRole === 'host') {
      this.startSenderForSlot(slot);
    } else {
      this.startReceiverForSlot(slot);
    }
  }

  private async startSenderForSlot(slot: PeerSlot) {
    if (!slot.dataChannel) return;
    const maxMsgSize = (slot.dataChannel as RTCDataChannel & { maxMessageSize?: number }).maxMessageSize;
    const SAFE_CHUNK = 256 * 1024;
    const effectiveChunkSize = (maxMsgSize && maxMsgSize > 0)
      ? Math.min(this.chunkSize, maxMsgSize)
      : Math.min(this.chunkSize, SAFE_CHUNK);
    const blobs = this.getFileBlobs();
    const metas = this.getFileMeta();
    if (metas.length === 0) return;
    const entries: SenderFileEntry[] = metas.map((m) => ({
      metadata: {
        ...m,
        totalChunks: Math.max(1, Math.ceil(m.size / effectiveChunkSize)),
      },
      file: blobs.get(m.id)!,
      plan: {
        fileId: m.id,
        chunkSize: effectiveChunkSize,
        totalChunks: Math.max(1, Math.ceil(m.size / effectiveChunkSize)),
      },
    }));
    const sender = new Sender({
      channel: slot.dataChannel,
      files: entries,
      chunkSize: effectiveChunkSize,
      onProgress: (p) => {
        const idx = slot.senderProgress.findIndex((x) => x.fileId === p.fileId);
        if (idx >= 0) slot.senderProgress[idx] = p;
        else slot.senderProgress.push(p);
        this.onPeersChange([...this.state.peers.values()]);
      },
    });
    sender.attach();
    await sender.start();
    slot.sender = sender;
  }

  private async startReceiverForSlot(slot: PeerSlot) {
    if (!slot.dataChannel) return;
    const storage = await this.storageFactory();
    const receiver = new Receiver({
      channel: slot.dataChannel,
      storage,
      onProgress: (p) => {
        const idx = slot.receiverProgress.findIndex((x) => x.fileId === p.fileId);
        if (idx >= 0) slot.receiverProgress[idx] = p;
        else slot.receiverProgress.push(p);
        this.onPeersChange([...this.state.peers.values()]);
      },
      onFileComplete: (file, blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
    });
    receiver.start();
    slot.receiver = receiver;
  }
}
