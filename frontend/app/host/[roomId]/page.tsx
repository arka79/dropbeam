'use client';

import {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';

import { useRouter } from 'next/navigation';

import { formatBytes } from '@/lib/utils/format';
import { loadHostFile } from '@/lib/storage/host-store';

import { QRCodeImage } from '@/components/QRCode';
import { ShareLink } from '@/components/ShareLink';
import {
  PeerList,
  TransferProgressList,
} from '@/components/PeerList';
import { PasswordDialog } from '@/components/PasswordDialog';

import {
  SignalingClient,
  type FileMetadata,
  type TransferMetadata,
} from '@/lib/webrtc/signaling';

import {
  RoomManager,
  type PeerSlot,
  type RoomState,
} from '@/lib/webrtc/peer';

import { getSignalingUrl } from '@/lib/utils/signaling-url';

interface ManifestFile {
  id: string;
  name: string;
  size: number;
  mime: string;
  path?: string;
  blobIndex: string;
}

interface Manifest {
  roomId: string;
  files: ManifestFile[];
  chunkSize: number;
  hasPassword: boolean;
  iceServers: RTCIceServer[];
}

export default function HostRoomPage({
  params,
}: {
  params: { roomId: string };
}) {
  const router = useRouter();

  const [manifest, setManifest] =
    useState<Manifest | null>(null);

  const [password, setPassword] =
    useState<string | null>(null);

  const [peers, setPeers] =
    useState<PeerSlot[]>([]);

  const [status, setStatus] =
    useState<
      | 'loading'
      | 'password'
      | 'connecting'
      | 'live'
      | 'error'
    >('loading');

  const [error, setError] =
    useState<string | null>(null);

  const [showQR, setShowQR] =
    useState(false);

  /*
   * This is the IMPORTANT value.
   *
   * It comes from the signaling server.
   */
  const [serverRoomId, setServerRoomId] =
    useState<string | null>(null);

  const managerRef =
    useRef<RoomManager | null>(null);

  const signalingRef =
    useRef<SignalingClient | null>(null);

  // =========================================================
  // LOAD MANIFEST
  // =========================================================

  useEffect(() => {
    const raw = sessionStorage.getItem(
      `host::${params.roomId}`,
    );

    if (!raw) {
      setStatus('error');

      setError(
        'Session lost. Please recreate the room.',
      );

      return;
    }

    try {
      const m: Manifest =
        JSON.parse(raw);

      setManifest(m);

      if (m.hasPassword) {
        setStatus('password');
      } else {
        initRoom(m, null);
      }
    } catch (err) {
      console.error(
        'Invalid manifest:',
        err,
      );

      setStatus('error');

      setError(
        'Invalid manifest',
      );
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.roomId]);

  // =========================================================
  // INITIALIZE HOST ROOM
  // =========================================================

  const initRoom = useCallback(
    async (
      m: Manifest,
      pw: string | null,
    ) => {
      setStatus('connecting');

      setError(null);

      try {
        console.log(
          '====================================',
        );

        console.log(
          '🚀 Initializing host',
        );

        const signalingUrl = getSignalingUrl();

        console.log(
          'Signaling server:',
          signalingUrl,
        );

        console.log(
          'Original URL room:',
          params.roomId,
        );

        console.log(
          '====================================',
        );

        // ---------------------------------------------------
        // LOAD FILES
        // ---------------------------------------------------

        const blobMap =
          new Map<string, File>();

        for (const file of m.files) {
          const blob =
            await loadHostFile(
              file.blobIndex,
            );

          if (!blob) {
            throw new Error(
              `Missing file in storage: ${file.name}`,
            );
          }

          blobMap.set(
            file.id,
            blob,
          );
        }

        console.log(
          '✅ Files loaded:',
          blobMap.size,
        );

        // ---------------------------------------------------
        // CREATE SIGNALING CLIENT
        // ---------------------------------------------------

        const signaling =
          new SignalingClient(
            signalingUrl,
          );

        signalingRef.current =
          signaling;

        // ---------------------------------------------------
        // CONNECT TO SIGNALING SERVER
        // ---------------------------------------------------

        /*
         * IMPORTANT:
         *
         * DO NOT use:
         *
         * randomPeerId()
         *
         * The signaling server generates
         * the peer ID.
         */

        const localPeerId =
          await signaling.connect(
            'host',
          );

        console.log(
          '✅ Host registered',
        );

        console.log(
          'Host peer ID:',
          localPeerId,
        );

        // ---------------------------------------------------
        // BUILD INITIAL METADATA
        // ---------------------------------------------------

        const metadata =
          buildMetadata(
            m,
            '',
          );

        // ---------------------------------------------------
        // CREATE ROOM ON SIGNALING SERVER
        // ---------------------------------------------------

        console.log(
          '🏠 Creating room on signaling server...',
        );

        const res =
          await signaling.createRoom(
            pw,
            metadata,
          );

        console.log(
          'Create room response:',
          res,
        );

        if (
          !res.ok ||
          !res.roomId
        ) {
          throw new Error(
            res.error ||
              'Failed to create room',
          );
        }

        /*
         * THIS IS THE REAL ROOM ID.
         *
         * Never use params.roomId after
         * this point.
         */

        const realRoomId =
          res.roomId;

        console.log(
          '====================================',
        );

        console.log(
          '✅ SERVER CREATED ROOM',
        );

        console.log(
          'REAL ROOM ID:',
          realRoomId,
        );

        console.log(
          '====================================',
        );

        setServerRoomId(
          realRoomId,
        );

        // ---------------------------------------------------
        // BUILD FINAL METADATA
        // ---------------------------------------------------

        const finalMetadata =
          buildMetadata(
            m,
            realRoomId,
          );

        // ---------------------------------------------------
        // UPDATE HOST METADATA
        // ---------------------------------------------------

        signaling.setHostMetadata(
          realRoomId,
          finalMetadata,
        );

        console.log(
          '✅ Host metadata sent',
        );

        // ---------------------------------------------------
        // ROOM STATE
        // ---------------------------------------------------

        const state: RoomState = {
          /*
           * IMPORTANT:
           *
           * Use SERVER room ID.
           */
          roomId:
            realRoomId,

          password: pw,

          metadata:
            finalMetadata,

          localRole: 'host',

          localPeerId:
            localPeerId,

          hostPeerId:
            localPeerId,

          peers: new Map(),
        };

        // ---------------------------------------------------
        // ROOM MANAGER
        // ---------------------------------------------------

        const manager =
          new RoomManager({
            signaling,

            initial: state,

            chunkSize:
              m.chunkSize,

            storageFactory:
              async () => {
                throw new Error(
                  'Host does not use storage',
                );
              },

            getFileBlobs:
              () => blobMap,

            getFileMeta:
              () =>
                m.files.map<FileMetadata>(
                  (file) => ({
                    id: file.id,

                    name: file.name,

                    size: file.size,

                    mime: file.mime,

                    totalChunks:
                      Math.max(
                        1,
                        Math.ceil(
                          file.size /
                            m.chunkSize,
                        ),
                      ),

                    path:
                      file.path,
                  }),
                ),

            onPeersChange:
              (list) => {
                console.log(
                  '👥 Peers:',
                  list,
                );

                setPeers(list);
              },

            onMetadata:
              () => {},

            onLog:
              (msg) => {
                console.debug(
                  '[host]',
                  msg,
                );
              },
          });

        managerRef.current =
          manager;

        manager.attach();

        console.log(
          '✅ RoomManager attached',
        );

        setStatus('live');

      } catch (err) {
        console.error(
          '❌ Host initialization failed:',
          err,
        );

        setStatus('error');

        setError(
          err instanceof Error
            ? err.message
            : 'Failed to initialize room',
        );
      }
    },
    [params.roomId],
  );

  // =========================================================
  // CLEANUP
  // =========================================================

  useEffect(() => {
    return () => {
      console.log(
        '🧹 Cleaning host room',
      );

      managerRef.current?.detach();

      signalingRef.current?.disconnect();

      managerRef.current =
        null;

      signalingRef.current =
        null;
    };
  }, []);

  // =========================================================
  // SHARE URL
  // =========================================================

  /*
   * IMPORTANT:
   *
   * Use serverRoomId.
   *
   * NOT params.roomId.
   */

  const shareUrl =
    typeof window !== 'undefined' &&
    serverRoomId
      ? `${window.location.origin}/share/${serverRoomId}`
      : '';

  // =========================================================
  // FILE STATISTICS
  // =========================================================

  const totalBytes =
    manifest?.files.reduce(
      (total, file) =>
        total + file.size,
      0,
    ) ?? 0;

  const totalPeers =
    peers.length;

  const activePeers =
    peers.filter(
      (peer) =>
        peer.state === 'connected' &&
        peer.senderProgress.length >
          0 &&
        peer.senderProgress.some(
          (progress) =>
            progress.state !==
            'done',
        ),
    ).length;

  // =========================================================
  // LOADING
  // =========================================================

  if (
    status === 'loading' ||
    status === 'connecting'
  ) {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-4">
        <div className="text-center">

          <div className="mb-3 text-2xl">
            🔄
          </div>

          <div className="text-white/60">
            {status === 'loading'
              ? 'Loading room…'
              : 'Creating secure room…'}
          </div>

        </div>
      </main>
    );
  }

  // =========================================================
  // PASSWORD
  // =========================================================

  if (status === 'password') {
    return (
      <PasswordDialog
        open
        mode="set"
        onSubmit={(pw) => {
          if (!manifest) {
            return;
          }

          setPassword(pw);

          initRoom(
            manifest,
            pw,
          );
        }}
        onCancel={() =>
          router.push('/')
        }
      />
    );
  }

  // =========================================================
  // ERROR
  // =========================================================

  if (status === 'error') {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-4">

        <div className="card max-w-md text-center">

          <h1 className="mb-2 text-lg font-semibold text-red-300">
            Error
          </h1>

          <p className="mb-4 text-sm text-white/60">
            {error}
          </p>

          <button
            onClick={() =>
              router.push('/')
            }
            className="btn-primary"
          >
            Back to home
          </button>

        </div>

      </main>
    );
  }

  // =========================================================
  // LIVE ROOM
  // =========================================================

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-8 sm:py-10">

      {/* HEADER */}

      <header className="mb-6 flex items-center justify-between">

        <button
          onClick={() =>
            router.push('/')
          }
          className="flex items-center gap-2 text-sm text-white/60 hover:text-white"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path
              d="M19 12H5M12 5l-7 7 7 7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          New share
        </button>

        <div className="flex items-center gap-3">

          <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">

            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />

            Live

          </div>

          <div className="text-xs text-white/40">
            {totalPeers} connected
          </div>

        </div>

      </header>

      {/* MAIN GRID */}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        <div className="space-y-6 lg:col-span-2">

          {/* SHARE CODE */}

          <section className="card">

            <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-white/50">
              Share code
            </h2>

            {serverRoomId ? (
              <ShareCode code={serverRoomId} />
            ) : (
              <div className="text-sm text-white/50">
                Generating code…
              </div>
            )}

          </section>

          {/* SHARE LINK */}

          <section className="card">

            <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-white/50">
              Or share this link
            </h2>

            {shareUrl ? (
              <>
                <ShareLink
                  url={shareUrl}
                />

                <button
                  onClick={() =>
                    setShowQR(
                      (value) =>
                        !value,
                    )
                  }
                  className="mt-3 text-xs text-beam-300 hover:underline"
                >
                  {showQR
                    ? 'Hide QR'
                    : 'Show QR code'}
                </button>

                {showQR && (
                  <div className="mt-4 flex justify-center">

                    <QRCodeImage
                      value={shareUrl}
                      size={192}
                    />

                  </div>
                )}

              </>
            ) : (
              <div className="text-sm text-white/50">
                Creating share link…
              </div>
            )}

          </section>

          {/* FILES */}

          <section className="card">

            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-white/50">
              Files ({manifest?.files.length ?? 0})
            </h2>

            <ul className="space-y-1.5 text-sm">

              {manifest?.files.map(
                (file) => (
                  <li
                    key={file.id}
                    className="flex items-center justify-between text-white/80"
                  >

                    <span className="truncate">
                      {file.path ||
                        file.name}
                    </span>

                    <span className="ml-3 shrink-0 font-mono text-xs text-white/50">
                      {formatBytes(
                        file.size,
                      )}
                    </span>

                  </li>
                ),
              )}

            </ul>

            <div className="mt-3 border-t border-white/5 pt-3 text-xs text-white/40">

              Total{' '}
              {formatBytes(
                totalBytes,
              )}

              {' · '}

              {activePeers}{' '}
              active transfers

            </div>

          </section>

          {/* TRANSFER PROGRESS */}

          {peers.length > 0 && (
            <section className="card">

              <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-white/50">
                Transfer progress
              </h2>

              <TransferProgressList
                peers={peers}
              />

            </section>
          )}

        </div>

        {/* SIDEBAR */}

        <aside className="space-y-6">

          <section className="card">

            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-white/50">
              Connected peers
            </h2>

            <PeerList
              peers={peers}
            />

          </section>

          {password && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
              🔒 Room is password protected
            </div>
          )}

        </aside>

      </div>

    </main>
  );
}

// ===========================================================
// SHARE CODE COMPONENT
// ===========================================================

function ShareCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <div className="flex-1 rounded-xl border border-white/10 bg-ink-900/60 px-4 py-3 font-mono text-2xl font-bold tracking-[0.3em] text-white">
          {code}
        </div>
        <button onClick={copyCode} className="btn-primary px-4 py-3">
          {copied ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15V5a2 2 0 012-2h10" />
            </svg>
          )}
        </button>
      </div>
      <p className="mt-2 text-xs text-white/40">
        Share this code. Others can enter it on DropBeam to download your files.
      </p>
    </div>
  );
}

// ===========================================================
// BUILD METADATA
// ===========================================================

function buildMetadata(
  m: Manifest,
  roomId: string,
): TransferMetadata {
  return {
    files:
      m.files.map<FileMetadata>(
        (file) => ({
          id: file.id,

          name: file.name,

          size: file.size,

          mime: file.mime,

          totalChunks:
            Math.max(
              1,
              Math.ceil(
                file.size /
                  m.chunkSize,
              ),
            ),

          path: file.path,
        }),
      ),

    totalBytes:
      m.files.reduce(
        (total, file) =>
          total + file.size,
        0,
      ),

    chunkSize:
      m.chunkSize,

    roomId,

    createdAt:
      Date.now(),
  };
}