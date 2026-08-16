import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 4000);

const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const HOST_IDLE_TTL_MS = 60 * 60 * 1000;
const PEER_IDLE_TTL_MS = 30 * 60 * 1000;

const MAX_PEERS = 32;

const app = express();

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST'],
  }),
);

app.use(express.json());

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },

  maxHttpBufferSize: 1e6,
});

// ============================================================
// STORAGE
// ============================================================

const rooms = new Map();
const peerSockets = new Map();
const socketToPeer = new Map();

// ============================================================
// HELPERS
// ============================================================

function randomId(length = 12) {
  const alphabet =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  const bytes =
    crypto.randomBytes(length);

  let id = '';

  for (let i = 0; i < length; i++) {
    id +=
      alphabet[
        bytes[i] % alphabet.length
      ];
  }

  return id;
}

function hashPassword(password) {
  if (!password) {
    return null;
  }

  return crypto
    .createHash('sha256')
    .update(password)
    .digest('hex');
}

// ============================================================
// ROOM
// ============================================================

class Room {
  constructor(
    id,
    hostId,
    passwordHash = null,
  ) {
    this.id = id;
    this.hostId = hostId;
    this.passwordHash = passwordHash;

    this.createdAt = Date.now();
    this.lastActivity = Date.now();

    this.peers = new Map();

    this.metadata = null;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  publicInfo() {
    let peerCount =
      this.peers.size;

    if (
      this.peers.has(
        this.hostId,
      )
    ) {
      peerCount--;
    }

    return {
      id: this.id,

      hasPassword:
        Boolean(
          this.passwordHash,
        ),

      createdAt:
        this.createdAt,

      hostOnline:
        this.peers.has(
          this.hostId,
        ),

      peerCount,

      metadata:
        this.metadata,
    };
  }

  destroy() {
    console.log(
      `🗑️ Destroying room: ${this.id}`,
    );

    for (
      const peer of this.peers.values()
    ) {
      peer.socket.emit(
        'room-closed',
        {
          roomId: this.id,
          reason: 'Room closed',
        },
      );

      peer.socket.leave(
        this.id,
      );
    }

    this.peers.clear();

    rooms.delete(
      this.id,
    );
  }
}

// ============================================================
// HEALTH
// ============================================================

app.get(
  '/health',
  (_req, res) => {
    res.json({
      ok: true,
      rooms: rooms.size,
      peers: peerSockets.size,
    });
  },
);

// ============================================================
// ROOM LOOKUP
// ============================================================

app.get(
  '/room/:id',
  (req, res) => {
    const room =
      rooms.get(
        req.params.id,
      );

    if (!room) {
      return res.status(404).json({
        error:
          'Room not found',
      });
    }

    return res.json(
      room.publicInfo(),
    );
  },
);

// ============================================================
// CLEANUP
// ============================================================

setInterval(() => {
  const now = Date.now();

  for (
    const [roomId, room]
    of rooms
  ) {
    const host =
      room.peers.get(
        room.hostId,
      );

    if (!host) {
      room.destroy();
      continue;
    }

    if (
      now - host.lastSeen >
      HOST_IDLE_TTL_MS
    ) {
      room.destroy();
      continue;
    }

    if (
      now - room.lastActivity >
      ROOM_TTL_MS
    ) {
      room.destroy();
      continue;
    }

    for (
      const [peerId, peer]
      of room.peers
    ) {
      if (
        peerId ===
        room.hostId
      ) {
        continue;
      }

      if (
        now - peer.lastSeen >
        PEER_IDLE_TTL_MS
      ) {
        peer.socket.emit(
          'peer-timeout',
          { peerId },
        );

        peer.socket.leave(
          roomId,
        );

        room.peers.delete(
          peerId,
        );

        io.to(roomId).emit(
          'peer-left',
          { peerId },
        );
      }
    }
  }
}, 30_000);

// ============================================================
// SOCKET CONNECTION
// ============================================================

io.on(
  'connection',
  (socket) => {
    console.log(
      `🔌 Socket connected: ${socket.id}`,
    );

    let peer = null;

    // ========================================================
    // REGISTER
    // ========================================================

    socket.on(
      'register',
      ({ role } = {}, ack) => {
        /*
         * SERVER GENERATES PEER ID.
         */

        const peerId =
          randomId(16);

        peer = {
          id: peerId,

          role:
            role || 'peer',

          socket,

          lastSeen:
            Date.now(),
        };

        peerSockets.set(
          peerId,
          peer,
        );

        socketToPeer.set(
          socket.id,
          peer,
        );

        console.log(
          `👤 Registered peer: ${peerId}`,
        );

        socket.emit(
          'registered',
          {
            peerId,
          },
        );

        ack?.({
          ok: true,
          peerId,
        });
      },
    );

    // ========================================================
    // HEARTBEAT
    // ========================================================

    socket.on(
      'heartbeat',
      (ack) => {
        if (!peer) {
          return;
        }

        peer.lastSeen =
          Date.now();

        ack?.({
          ok: true,
          timestamp:
            Date.now(),
        });
      },
    );

    // ========================================================
    // CREATE ROOM
    // ========================================================

    socket.on(
      'create-room',
      (
        {
          password,
          metadata,
        } = {},
        ack,
      ) => {
        if (!peer) {
          return ack?.({
            error:
              'Not registered',
          });
        }

        /*
         * Prevent duplicate rooms
         * from the same host.
         */

        for (
          const room
          of rooms.values()
        ) {
          if (
            room.hostId ===
            peer.id
          ) {
            return ack?.({
              ok: true,
              roomId:
                room.id,
              info:
                room.publicInfo(),
            });
          }
        }

        /*
         * ONLY HERE IS THE ROOM ID GENERATED.
         */

        const roomId =
          randomId(10);

        const passwordHash =
          hashPassword(
            password,
          );

        const room =
          new Room(
            roomId,
            peer.id,
            passwordHash,
          );

        room.metadata =
          metadata || null;

        room.peers.set(
          peer.id,
          peer,
        );

        peer.role = 'host';

        socket.join(
          roomId,
        );

        rooms.set(
          roomId,
          room,
        );

        console.log(
          '=================================',
        );

        console.log(
          '🏠 ROOM CREATED',
        );

        console.log(
          'Room ID:',
          roomId,
        );

        console.log(
          'Host:',
          peer.id,
        );

        console.log(
          'Rooms:',
          [...rooms.keys()],
        );

        console.log(
          '=================================',
        );

        ack?.({
          ok: true,

          roomId,

          info:
            room.publicInfo(),
        });
      },
    );

    // ========================================================
    // JOIN ROOM
    // ========================================================

    socket.on(
      'join-room',
      (
        {
          roomId,
          password,
        } = {},
        ack,
      ) => {
        if (!peer) {
          return ack?.({
            error:
              'Not registered',
          });
        }

        if (!roomId) {
          return ack?.({
            error:
              'Room ID is required',
          });
        }

        console.log(
          '=================================',
        );

        console.log(
          '🔍 JOIN ROOM',
        );

        console.log(
          'Room:',
          roomId,
        );

        console.log(
          'Peer:',
          peer.id,
        );

        console.log(
          'Existing rooms:',
          [...rooms.keys()],
        );

        console.log(
          '=================================',
        );

        const room =
          rooms.get(
            roomId,
          );

        if (!room) {
          console.log(
            `❌ Room not found: ${roomId}`,
          );

          return ack?.({
            error:
              'Room not found or expired',
          });
        }

        // Password

        if (
          room.passwordHash
        ) {
          const providedHash =
            hashPassword(
              password,
            );

          if (
            providedHash !==
            room.passwordHash
          ) {
            return ack?.({
              error:
                'Invalid password',
            });
          }
        }

        // Already joined

        if (
          room.peers.has(
            peer.id,
          )
        ) {
          return ack?.({
            ok: true,

            alreadyJoined:
              true,

            roomId,

            info:
              room.publicInfo(),

            hostId:
              room.hostId,

            metadata:
              room.metadata,
          });
        }

        // Maximum peers

        if (
          room.peers.size >=
          MAX_PEERS
        ) {
          return ack?.({
            error:
              'Room is full',
          });
        }

        // Add peer

        room.peers.set(
          peer.id,
          peer,
        );

        peer.role = 'peer';

        room.touch();

        socket.join(
          roomId,
        );

        console.log(
          `✅ Peer ${peer.id} joined ${roomId}`,
        );

        // Tell receiver

        ack?.({
          ok: true,

          roomId,

          info:
            room.publicInfo(),

          hostId:
            room.hostId,

          metadata:
            room.metadata,
        });

        // Tell host

        socket
          .to(roomId)
          .emit(
            'peer-joined',
            {
              peerId:
                peer.id,

              role:
                peer.role,
            },
          );

        // Tell receiver host info

        socket.emit(
          'host-info',
          {
            peerId:
              room.hostId,

            metadata:
              room.metadata,
          },
        );
      },
    );

    // ========================================================
    // LEAVE ROOM
    // ========================================================

    socket.on(
      'leave-room',
      (
        { roomId } = {},
        ack,
      ) => {
        handleLeave(
          roomId,
        );

        ack?.({
          ok: true,
        });
      },
    );

    // ========================================================
    // OFFER
    // ========================================================

    socket.on(
      'offer',
      ({
        roomId,
        target,
        sdp,
      } = {}) => {
        if (!peer) return;

        const room =
          rooms.get(
            roomId,
          );

        if (!room) return;

        const targetPeer =
          room.peers.get(
            target,
          );

        if (!targetPeer) {
          return;
        }

        room.touch();

        targetPeer.socket.emit(
          'offer',
          {
            from:
              peer.id,

            sdp,
          },
        );
      },
    );

    // ========================================================
    // ANSWER
    // ========================================================

    socket.on(
      'answer',
      ({
        roomId,
        target,
        sdp,
      } = {}) => {
        if (!peer) return;

        const room =
          rooms.get(
            roomId,
          );

        if (!room) return;

        const targetPeer =
          room.peers.get(
            target,
          );

        if (!targetPeer) {
          return;
        }

        room.touch();

        targetPeer.socket.emit(
          'answer',
          {
            from:
              peer.id,

            sdp,
          },
        );
      },
    );

    // ========================================================
    // ICE
    // ========================================================

    socket.on(
      'ice-candidate',
      ({
        roomId,
        target,
        candidate,
      } = {}) => {
        if (!peer) return;

        const room =
          rooms.get(
            roomId,
          );

        if (!room) return;

        const targetPeer =
          room.peers.get(
            target,
          );

        if (!targetPeer) {
          return;
        }

        room.touch();

        targetPeer.socket.emit(
          'ice-candidate',
          {
            from:
              peer.id,

            candidate,
          },
        );
      },
    );

    // ========================================================
    // PEER MESSAGE
    // ========================================================

    socket.on(
      'peer-message',
      ({
        roomId,
        target,
        payload,
      } = {}) => {
        if (!peer) return;

        const room =
          rooms.get(
            roomId,
          );

        if (!room) return;

        const targetPeer =
          room.peers.get(
            target,
          );

        if (!targetPeer) {
          return;
        }

        room.touch();

        targetPeer.socket.emit(
          'peer-message',
          {
            from:
              peer.id,

            payload,
          },
        );
      },
    );

    // ========================================================
    // BROADCAST
    // ========================================================

    socket.on(
      'broadcast',
      ({
        roomId,
        payload,
      } = {}) => {
        if (!peer) return;

        const room =
          rooms.get(
            roomId,
          );

        if (!room) return;

        room.touch();

        socket
          .to(roomId)
          .emit(
            'peer-message',
            {
              from:
                peer.id,

              payload,
            },
          );
      },
    );

    // ========================================================
    // HOST METADATA
    // ========================================================

    socket.on(
      'host-metadata',
      ({
        roomId,
        metadata,
      } = {}) => {
        if (!peer) return;

        const room =
          rooms.get(
            roomId,
          );

        if (!room) return;

        if (
          peer.id !==
          room.hostId
        ) {
          return;
        }

        room.metadata =
          metadata;

        room.touch();

        io.to(roomId).emit(
          'host-metadata',
          {
            metadata,
          },
        );
      },
    );

    // ========================================================
    // PING
    // ========================================================

    socket.on(
      'ping-host',
      (ack) => {
        if (!peer) {
          return ack?.({
            ok: false,
          });
        }

        peer.lastSeen =
          Date.now();

        ack?.({
          ok: true,
          ts: Date.now(),
        });
      },
    );

    // ========================================================
    // LEAVE HANDLER
    // ========================================================

    function handleLeave(
      roomId,
    ) {
      if (!peer) {
        return;
      }

      const room =
        rooms.get(
          roomId,
        );

      if (!room) {
        return;
      }

      if (
        !room.peers.has(
          peer.id,
        )
      ) {
        return;
      }

      room.peers.delete(
        peer.id,
      );

      socket.leave(
        roomId,
      );

      socket
        .to(roomId)
        .emit(
          'peer-left',
          {
            peerId:
              peer.id,
          },
        );

      // Host leaves

      if (
        peer.id ===
        room.hostId
      ) {
        room.destroy();
        return;
      }

      // Room empty

      if (
        room.peers.size === 0
      ) {
        room.destroy();
        return;
      }

      room.touch();
    }

    // ========================================================
    // DISCONNECT
    // ========================================================

    socket.on(
      'disconnect',
      (reason) => {
        console.log(
          `🔌 Socket disconnected: ${socket.id}`,
          reason,
        );

        if (!peer) {
          return;
        }

        peerSockets.delete(
          peer.id,
        );

        socketToPeer.delete(
          socket.id,
        );

        for (
          const roomId
          of [...rooms.keys()]
        ) {
          const room =
            rooms.get(
              roomId,
            );

          if (!room) continue;

          if (
            room.peers.has(
              peer.id,
            )
          ) {
            handleLeave(
              roomId,
            );
          }
        }
      },
    );
  },
);

// ============================================================
// START
// ============================================================

server.listen(
  PORT,
  () => {
    console.log('');
    console.log(
      '=================================',
    );
    console.log(
      '🚀 DropBeam Signaling Server',
    );
    console.log(
      `🌐 http://localhost:${PORT}`,
    );
    console.log(
      `❤️ http://localhost:${PORT}/health`,
    );
    console.log(
      '=================================',
    );
    console.log('');
  },
);