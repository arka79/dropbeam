import { getIceServers } from './ice';
import { SignalingClient } from './signaling';

export type ConnectionRole = 'host' | 'peer';

export interface PeerCallbacks {
  onDataChannel?: (channel: RTCDataChannel) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onIceConnectionStateChange?: (state: RTCIceConnectionState) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onSignalError?: (err: Error) => void;
}

export class PeerConnection {
  readonly pc: RTCPeerConnection;
  readonly peerId: string;
  readonly role: ConnectionRole;
  private signaling: SignalingClient;
  private roomId: string;
  private callbacks: PeerCallbacks;
  private isPolite: boolean;
  private makingOffer = false;
  private ignoreOffer = false;
  private dataChannel: RTCDataChannel | null = null;
  private targetPeerId: string;
  private disconnectedTimer: ReturnType<typeof setTimeout> | null = null;
  private iceRestartCount = 0;
  private static MAX_ICE_RESTARTS = 3;
  private static DISCONNECTED_TIMEOUT_MS = 5000;

  constructor(opts: {
    peerId: string;
    role: ConnectionRole;
    signaling: SignalingClient;
    roomId: string;
    targetPeerId: string;
    isInitiator: boolean;
    callbacks?: PeerCallbacks;
  }) {
    this.peerId = opts.peerId;
    this.role = opts.role;
    this.signaling = opts.signaling;
    this.roomId = opts.roomId;
    this.targetPeerId = opts.targetPeerId;
    this.callbacks = opts.callbacks ?? {};
    this.isPolite = opts.isInitiator
      ? opts.role === 'peer'
      : opts.role === 'host';

    this.pc = new RTCPeerConnection({
      iceServers: getIceServers(),
      iceTransportPolicy: 'all',
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });

    this.pc.addEventListener('icecandidate', (ev) => {
      if (ev.candidate) {
        this.signaling.sendIceCandidate(this.roomId, opts.targetPeerId, ev.candidate.toJSON());
      }
    });

    this.pc.addEventListener('connectionstatechange', () => {
      this.callbacks.onConnectionStateChange?.(this.pc.connectionState);
    });

    this.pc.addEventListener('iceconnectionstatechange', () => {
      const state = this.pc.iceConnectionState;
      this.callbacks.onIceConnectionStateChange?.(state);

      // ICE restart logic: if disconnected for too long, attempt restart
      if (state === 'disconnected') {
        if (!this.disconnectedTimer) {
          this.disconnectedTimer = setTimeout(() => {
            this.attemptIceRestart();
          }, PeerConnection.DISCONNECTED_TIMEOUT_MS);
        }
      } else {
        // Clear timer if connected/completed/failed
        if (this.disconnectedTimer) {
          clearTimeout(this.disconnectedTimer);
          this.disconnectedTimer = null;
        }
      }

      if (state === 'failed') {
        this.attemptIceRestart();
      }
    });

    this.pc.addEventListener('negotiationneeded', () => {
      this.handleNegotiation();
    });

    this.pc.addEventListener('datachannel', (ev) => {
      this.dataChannel = ev.channel;
      this.setupDataChannel(ev.channel);
    });
  }

  createDataChannel(label: string, opts?: RTCDataChannelInit): RTCDataChannel {
    const dc = this.pc.createDataChannel(label, {
      ordered: true,
      ...opts,
    });
    this.dataChannel = dc;
    this.setupDataChannel(dc);
    return dc;
  }

  getDataChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  async handleOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    try {
      this.ignoreOffer = !this.isPolite && (this.makingOffer || this.pc.signalingState !== 'stable');
      if (this.ignoreOffer) return;
      await this.pc.setRemoteDescription(sdp);
      await this.pc.setLocalDescription(await this.pc.createAnswer());
      if (this.pc.localDescription) {
        this.signaling.sendAnswer(this.roomId, this.peerId, this.pc.localDescription.toJSON());
      }
    } catch (err) {
      this.callbacks.onSignalError?.(err as Error);
    }
  }

  async handleAnswer(sdp: RTCSessionDescriptionInit): Promise<void> {
    try {
      if (this.pc.signalingState !== 'have-local-offer') return;
      await this.pc.setRemoteDescription(sdp);
    } catch (err) {
      this.callbacks.onSignalError?.(err as Error);
    }
  }

  async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      if (candidate) {
        await this.pc.addIceCandidate(candidate);
      }
    } catch (err) {
      if (!this.ignoreOffer) this.callbacks.onSignalError?.(err as Error);
    }
  }

  private async handleNegotiation(iceRestart = false) {
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer({ iceRestart });
      await this.pc.setLocalDescription(offer);
      if (this.pc.localDescription) {
        this.signaling.sendOffer(this.roomId, this.targetPeerId, this.pc.localDescription.toJSON());
      }
    } catch (err) {
      this.callbacks.onSignalError?.(err as Error);
    } finally {
      this.makingOffer = false;
    }
  }

  private setupDataChannel(dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';
    this.callbacks.onDataChannel?.(dc);
  }

  private attemptIceRestart() {
    if (this.iceRestartCount >= PeerConnection.MAX_ICE_RESTARTS) {
      console.warn(`[PeerConnection] Max ICE restarts (${PeerConnection.MAX_ICE_RESTARTS}) reached for peer ${this.peerId}`);
      return;
    }

    this.iceRestartCount++;
    console.log(`[PeerConnection] Attempting ICE restart #${this.iceRestartCount} for peer ${this.peerId}`);

    try {
      this.pc.restartIce();
      // Trigger re-negotiation with iceRestart: true
      this.handleNegotiation(true);
    } catch (err) {
      console.error('[PeerConnection] ICE restart failed:', err);
    }
  }

  close() {
    if (this.disconnectedTimer) {
      clearTimeout(this.disconnectedTimer);
      this.disconnectedTimer = null;
    }
    try {
      this.dataChannel?.close();
    } catch {}
    try {
      this.pc.close();
    } catch {}
  }
}
