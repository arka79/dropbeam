# DropBeam

**Private peer-to-peer file sharing, right from your browser.**

Live at **[dropbeam-six.vercel.app](https://dropbeam-six.vercel.app/)**

DropBeam lets you send files directly between devices using WebRTC — no uploads to a server, no size limits imposed by storage quotas, and no waiting around for a slow cloud transfer. Files travel straight from sender to receiver over an encrypted peer-to-peer connection.

---

## Features

- **Direct P2P transfer** — files go browser-to-browser using WebRTC data channels
- **End-to-end encrypted** — WebRTC's built-in DTLS/SRTP encryption secures every transfer
- **No file size limits** — since files never touch a server, you're only limited by device memory/disk
- **No sign-up required** — just open a link and start sharing
- **Cross-platform** — works in any modern browser, desktop or mobile
- **Real-time progress** — live transfer speed, ETA, and progress bar
- **Multi-file support** — share multiple files at once
- **Password protection** — optionally password-protect your share rooms
- **SHA-256 integrity** — verified file integrity on every transfer

---

## How It Works

1. **Sender** opens DropBeam and selects files to share.
2. A unique room code/link is generated and the **WebSocket signaling server** helps the two browsers discover each other.
3. The sender and receiver exchange **SDP offers/answers** and **ICE candidates** to negotiate a direct WebRTC connection.
4. Once the peer connection is established, files are streamed directly over a **WebRTC DataChannel** in chunks.
5. The receiver reassembles the chunks and saves the files locally.

```
┌──────────┐        Signaling (WebSocket)        ┌──────────┐
│  Sender  │ ───────────────────────────────────▶ │ Receiver │
│ Browser  │ ◀─────────────────────────────────── │ Browser  │
└────┬─────┘        SDP / ICE exchange            └────┬─────┘
     │                                                   │
     │            Direct P2P (WebRTC DataChannel)        │
     └───────────────────────────────────────────────────┘
                   Encrypted file transfer
```

> The signaling server only helps two peers find each other — it never sees your file data.

---

## Tech Stack

| Layer                | Technology                          |
|-----------------------|--------------------------------------|
| Frontend              | Next.js 14 + React 18 + TypeScript  |
| Styling               | Tailwind CSS                        |
| Signaling server      | Node.js + Express + Socket.IO       |
| Peer connection       | WebRTC (`RTCPeerConnection`)        |
| Data transfer         | WebRTC `RTCDataChannel`             |
| NAT traversal         | STUN / TURN servers                 |
| Validation            | Zod                                 |

---

## Project Structure

```
dropbeam/
├── frontend/               # Next.js frontend
│   ├── app/                # App router pages
│   │   ├── host/           # Host (sender) page
│   │   └── share/          # Receiver page
│   ├── components/         # UI components
│   ├── lib/                # Utilities, WebRTC logic, storage
│   ├── package.json
│   └── vercel.json
├── signaling/              # WebSocket signaling server
│   ├── index.js            # Express + Socket.IO server
│   └── package.json
├── render.yaml             # Render deployment config
└── README.md
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- npm

### 1. Clone the repository

```bash
git clone https://github.com/arka79/dropbeam.git
cd dropbeam
```

### 2. Install dependencies

```bash
cd frontend && npm install
cd ../signaling && npm install
```

### 3. Configure environment variables

Create a `.env` file in `frontend/`:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SIGNALING_URL=http://localhost:4000
NEXT_PUBLIC_STUN_SERVER=stun:stun.l.google.com:19302
```

Create a `.env` file in `signaling/`:

```env
PORT=4000
```

### 4. Run the app

Start the signaling server:

```bash
cd signaling && npm run dev
```

Start the frontend:

```bash
cd frontend && npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Deployment

**Frontend:** Deployed on [Vercel](https://dropbeam-six.vercel.app/)

**Signaling Server:** Deployed on [Render](https://render.com) using the `render.yaml` blueprint.

---

## Scripts

| Command                          | Description                          |
|----------------------------------|--------------------------------------|
| `cd frontend && npm run dev`     | Start frontend dev server            |
| `cd frontend && npm run build`   | Build frontend for production        |
| `cd frontend && npm run lint`    | Run linter                           |
| `cd frontend && npm run typecheck` | Run TypeScript type checking       |
| `cd signaling && npm run dev`    | Start signaling server in dev mode   |
| `cd signaling && npm start`      | Start signaling server in production |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

MIT
