import {
  io,
  type Socket,
} from 'socket.io-client';

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  mime: string;
  totalChunks: number;
  sha256?: string;
  path?: string;
}

export interface TransferMetadata {
  files: FileMetadata[];
  totalBytes: number;
  chunkSize: number;
  roomId: string;
  createdAt: number;
}

export interface RoomPublicInfo {
  id: string;
  hasPassword: boolean;
  createdAt: number;
  hostOnline: boolean;
  peerCount: number;
  metadata: TransferMetadata | null;
}

export type SignalingEvents = {
  registered: {
    peerId: string;
  };

  'room-closed': {
    roomId: string;
    reason?: string;
  };

  'peer-joined': {
    peerId: string;
    role?: string;
  };

  'peer-left': {
    peerId: string;
  };

  'host-info': {
    peerId: string;
    metadata: TransferMetadata | null;
  };

  'host-metadata': {
    metadata: TransferMetadata | null;
  };

  offer: {
    from: string;
    sdp: RTCSessionDescriptionInit;
  };

  answer: {
    from: string;
    sdp: RTCSessionDescriptionInit;
  };

  'ice-candidate': {
    from: string;
    candidate: RTCIceCandidateInit;
  };

  'peer-message': {
    from: string;
    payload: unknown;
  };

  'peer-timeout': {
    peerId: string;
  };
};

type EventName =
  keyof SignalingEvents;

type Listener = (
  payload: unknown,
) => void;

export class SignalingClient {
  private socket:
    | Socket
    | null = null;

  private listeners =
    new Map<
      EventName,
      Set<Listener>
    >();

  constructor(
    private readonly url: string,
  ) {}

  // ==========================================================
  // CONNECT
  // ==========================================================

  connect(
    role: 'host' | 'peer',
  ): Promise<string> {
    return new Promise(
      (resolve, reject) => {
        const socket =
          io(this.url, {
            transports: [
              'websocket',
            ],

            reconnection: true,

            reconnectionAttempts: 10,

            reconnectionDelay: 500,

            timeout: 10_000,
          });

        this.socket =
          socket;

        let settled = false;

        const timeout =
          setTimeout(() => {
            if (settled) {
              return;
            }

            settled = true;

            reject(
              new Error(
                'Signaling timeout',
              ),
            );
          }, 12_000);

        socket.on(
          'connect',
          () => {
            console.log(
              '🔌 Signaling connected:',
              socket.id,
            );

            /*
             * DO NOT SEND peerId.
             *
             * Server creates it.
             */

            socket.emit(
              'register',
              {
                role,
              },
            );
          },
        );

        socket.on(
          'registered',
          (
            data: {
              peerId: string;
            },
          ) => {
            if (settled) {
              return;
            }

            settled = true;

            clearTimeout(
              timeout,
            );

            this.attachDefaultListeners();

            console.log(
              '✅ Registered:',
              data.peerId,
            );

            resolve(
              data.peerId,
            );
          },
        );

        socket.on(
          'connect_error',
          (error) => {
            console.error(
              '❌ Signaling error:',
              error,
            );

            if (!settled) {
              settled = true;

              clearTimeout(
                timeout,
              );

              reject(error);
            }
          },
        );
      },
    );
  }

  // ==========================================================
  // LISTENERS
  // ==========================================================

  private attachDefaultListeners() {
    if (!this.socket) {
      return;
    }

    const events:
      EventName[] = [
        'room-closed',
        'peer-joined',
        'peer-left',
        'host-info',
        'host-metadata',
        'offer',
        'answer',
        'ice-candidate',
        'peer-message',
        'peer-timeout',
      ];

    for (
      const event of events
    ) {
      this.socket.on(
        event,
        (payload) => {
          const set =
            this.listeners.get(
              event,
            );

          if (!set) {
            return;
          }

          for (
            const callback
            of set
          ) {
            callback(
              payload,
            );
          }
        },
      );
    }
  }

  on<T = unknown>(
    event: EventName,
    callback: (
      payload: T,
    ) => void,
  ) {
    if (
      !this.listeners.has(
        event,
      )
    ) {
      this.listeners.set(
        event,
        new Set(),
      );
    }

    this.listeners
      .get(event)!
      .add(
        callback as Listener,
      );

    return () =>
      this.off(
        event,
        callback,
      );
  }

  off<T = unknown>(
    event: EventName,
    callback: (
      payload: T,
    ) => void,
  ) {
    this.listeners
      .get(event)
      ?.delete(
        callback as Listener,
      );
  }

  // ==========================================================
  // CREATE ROOM
  // ==========================================================

  createRoom(
    password:
      | string
      | null,
    metadata:
      | TransferMetadata
      | null,
  ) {
    return new Promise<{
      ok: boolean;
      roomId?: string;
      error?: string;
      info?: RoomPublicInfo;
    }>((resolve) => {
      if (!this.socket) {
        resolve({
          ok: false,
          error:
            'Socket not connected',
        });

        return;
      }

      this.socket.emit(
        'create-room',
        {
          password,
          metadata,
        },
        (
          response: {
            ok?: boolean;
            roomId?: string;
            error?: string;
            info?: RoomPublicInfo;
          },
        ) => {
          resolve({
            ok:
              Boolean(
                response?.ok,
              ),

            roomId:
              response?.roomId,

            error:
              response?.error,

            info:
              response?.info,
          });
        },
      );
    });
  }

  // ==========================================================
  // JOIN ROOM
  // ==========================================================

  joinRoom(
    roomId: string,
    password:
      | string
      | null,
  ) {
    return new Promise<{
      ok: boolean;
      roomId?: string;
      error?: string;
      info?: RoomPublicInfo;
      hostId?: string;
      metadata?: TransferMetadata | null;
      alreadyJoined?: boolean;
    }>((resolve) => {
      if (!this.socket) {
        resolve({
          ok: false,
          error:
            'Socket not connected',
        });

        return;
      }

      this.socket.emit(
        'join-room',
        {
          roomId,
          password,
        },
        (
          response: {
            ok?: boolean;
            roomId?: string;
            error?: string;
            info?: RoomPublicInfo;
            hostId?: string;
            metadata?: TransferMetadata | null;
            alreadyJoined?: boolean;
          },
        ) => {
          resolve({
            ok: Boolean(response?.ok),
            roomId: response?.roomId,
            error: response?.error,
            info: response?.info,
            hostId: response?.hostId,
            metadata: response?.metadata,
            alreadyJoined: response?.alreadyJoined,
          });
        },
      );
    });
  }

  // ==========================================================
  // LEAVE
  // ==========================================================

  leaveRoom(
    roomId: string,
  ) {
    return new Promise<{
      ok: boolean;
    }>((resolve) => {
      if (!this.socket) {
        resolve({
          ok: false,
        });

        return;
      }

      this.socket.emit(
        'leave-room',
        {
          roomId,
        },
        (
          response: {
            ok: boolean;
          },
        ) => {
          resolve(
            response,
          );
        },
      );
    });
  }

  // ==========================================================
  // WEBRTC
  // ==========================================================

  sendOffer(
    roomId: string,
    target: string,
    sdp: RTCSessionDescriptionInit,
  ) {
    this.socket?.emit(
      'offer',
      {
        roomId,
        target,
        sdp,
      },
    );
  }

  sendAnswer(
    roomId: string,
    target: string,
    sdp: RTCSessionDescriptionInit,
  ) {
    this.socket?.emit(
      'answer',
      {
        roomId,
        target,
        sdp,
      },
    );
  }

  sendIceCandidate(
    roomId: string,
    target: string,
    candidate: RTCIceCandidateInit,
  ) {
    this.socket?.emit(
      'ice-candidate',
      {
        roomId,
        target,
        candidate,
      },
    );
  }

  // ==========================================================
  // MESSAGES
  // ==========================================================

  sendPeerMessage(
    roomId: string,
    target: string,
    payload: unknown,
  ) {
    this.socket?.emit(
      'peer-message',
      {
        roomId,
        target,
        payload,
      },
    );
  }

  broadcastPeerMessage(
    roomId: string,
    payload: unknown,
  ) {
    this.socket?.emit(
      'broadcast',
      {
        roomId,
        payload,
      },
    );
  }

  // ==========================================================
  // METADATA
  // ==========================================================

  setHostMetadata(
    roomId: string,
    metadata: TransferMetadata,
  ) {
    this.socket?.emit(
      'host-metadata',
      {
        roomId,
        metadata,
      },
    );
  }

  // ==========================================================
  // DISCONNECT
  // ==========================================================

  disconnect() {
    this.socket?.disconnect();

    this.socket =
      null;

    this.listeners.clear();
  }
}