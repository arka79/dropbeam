'use client';

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import { useRouter } from 'next/navigation';

import { formatBytes } from '@/lib/utils/format';

import {
  PasswordDialog,
} from '@/components/PasswordDialog';

import {
  ReceiverProgressView,
} from '@/components/TransferProgress';

import {
  SignalingClient,
  type TransferMetadata,
} from '@/lib/webrtc/signaling';

import {
  RoomManager,
  type PeerSlot,
  type RoomState,
} from '@/lib/webrtc/peer';

import {
  createFileStorage,
  type FileStorage,
} from '@/lib/storage';

import type {
  ReceiverProgress,
} from '@/lib/transfer/receiver';

import { getSignalingUrl } from '@/lib/utils/signaling-url';

export default function SharePage({
  params,
}: {
  params: {
    roomId: string;
  };
}) {
  const router =
    useRouter();

  const roomId =
    params.roomId;

  const [
    phase,
    setPhase,
  ] = useState<
    | 'loading'
    | 'info'
    | 'password'
    | 'downloading'
    | 'done'
    | 'error'
  >('loading');

  const [
    info,
    setInfo,
  ] =
    useState<TransferMetadata | null>(
      null,
    );

  const [
    hasPassword,
    setHasPassword,
  ] = useState(false);

  const [
    hostOnline,
    setHostOnline,
  ] = useState(false);

  const [
    peers,
    setPeers,
  ] = useState<PeerSlot[]>(
    [],
  );

  const [
    progress,
    setProgress,
  ] =
    useState<ReceiverProgress[]>(
      [],
    );

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  const [
    downloading,
    setDownloading,
  ] = useState(false);

  const managerRef =
    useRef<RoomManager | null>(
      null,
    );

  const signalingRef =
    useRef<SignalingClient | null>(
      null,
    );

  const storageRef =
    useRef<FileStorage | null>(
      null,
    );

  // ==========================================================
  // LOAD ROOM
  // ==========================================================

  useEffect(() => {
    let cancelled = false;

    async function loadRoom() {
      try {
        console.log(
          '🔍 Loading room:',
          roomId,
        );

        const response =
          await fetch(
            `/api/room/${encodeURIComponent(
              roomId,
            )}`,
            {
              cache:
                'no-store',
            },
          );

        if (!response.ok) {
          const data =
            await response
              .json()
              .catch(
                () => null,
              );

          throw new Error(
            data?.error ||
              'Room not found or expired',
          );
        }

        const room =
          await response.json();

        console.log(
          '✅ Room found:',
          room,
        );

        if (cancelled) {
          return;
        }

        setInfo(
          room.metadata ??
            null,
        );

        setHasPassword(
          Boolean(
            room.hasPassword,
          ),
        );

        setHostOnline(
          Boolean(
            room.hostOnline,
          ),
        );

        setPhase(
          room.hasPassword
            ? 'password'
            : 'info',
        );
      } catch (err) {
        if (cancelled) {
          return;
        }

        console.error(
          '❌ Room lookup failed:',
          err,
        );

        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load room',
        );

        setPhase('error');
      }
    }

    loadRoom();

    return () => {
      cancelled = true;
    };
  }, [roomId]);

  // ==========================================================
  // DOWNLOAD
  // ==========================================================

  const startDownload =
    async (
      password: string | null,
    ) => {
      if (downloading) {
        return;
      }

      try {
        setError(null);
        setDownloading(true);
        setPhase(
          'downloading',
        );

        console.log(
          '⬇️ Joining room:',
          roomId,
        );

        // ----------------------------------------------------
        // STORAGE
        // ----------------------------------------------------

        const storage =
          await createFileStorage();

        storageRef.current =
          storage;

        // ----------------------------------------------------
        // SIGNALING
        // ----------------------------------------------------

        const signalingUrl = getSignalingUrl();

        const signaling =
          new SignalingClient(
            signalingUrl,
          );

        signalingRef.current =
          signaling;

        // ----------------------------------------------------
        // CONNECT
        // ----------------------------------------------------

        /*
         * SERVER generates peer ID.
         */

        const localPeerId =
          await signaling.connect(
            'peer',
          );

        console.log(
          '✅ Receiver peer:',
          localPeerId,
        );

        // ----------------------------------------------------
        // JOIN
        // ----------------------------------------------------

        const join =
          await signaling.joinRoom(
            roomId,
            password,
          );

        console.log(
          'Join response:',
          join,
        );

        if (!join.ok) {
          throw new Error(
            join.error ||
              'Failed to join room',
          );
        }

        const actualRoomId =
          join.roomId ||
          roomId;

        console.log(
          '✅ Joined:',
          actualRoomId,
        );

        // ----------------------------------------------------
        // ROOM INFO
        // ----------------------------------------------------

        const metadata =
          join.info?.metadata ??
          join.metadata ??
          info ??
          null;

        if (metadata) {
          setInfo(
            metadata,
          );
        }

        setHostOnline(
          Boolean(
            join.info?.hostOnline,
          ),
        );

        // ----------------------------------------------------
        // ROOM STATE
        // ----------------------------------------------------

        const state: RoomState = {
          roomId:
            actualRoomId,

          password,

          metadata,

          localRole:
            'peer',

          localPeerId,

          hostPeerId:
            join.hostId ??
            null,

          peers:
            new Map(),
        };

        // ----------------------------------------------------
        // MANAGER
        // ----------------------------------------------------

        const manager =
          new RoomManager({
            signaling,

            initial:
              state,

            chunkSize:
              metadata
                ?.chunkSize ??
              1024 * 1024,

            storageFactory:
              async () =>
                storage,

            getFileBlobs:
              () =>
                new Map(),

            getFileMeta:
              () => [],

            onPeersChange:
              (list) => {
                setPeers(
                  list,
                );

                const all: ReceiverProgress[] =
                  [];

                for (
                  const peer
                  of list
                ) {
                  for (
                    const progress
                    of peer.receiverProgress
                  ) {
                    all.push(
                      progress,
                    );
                  }
                }

                setProgress(
                  all,
                );
              },

            onMetadata:
              (metadata) => {
                setInfo(
                  metadata,
                );
              },

            onLog:
              (message) => {
                console.debug(
                  '[receiver]',
                  message,
                );
              },
          });

        managerRef.current =
          manager;

        manager.attach();

        console.log(
          '✅ RoomManager attached',
        );
      } catch (err) {
        console.error(
          '❌ Download failed:',
          err,
        );

        setError(
          err instanceof Error
            ? err.message
            : 'Failed to start download',
        );

        setPhase('error');

        setDownloading(
          false,
        );
      }
    };

  // ==========================================================
  // CLEANUP
  // ==========================================================

  useEffect(() => {
    return () => {
      managerRef.current?.detach();

      signalingRef.current?.disconnect();

      managerRef.current =
        null;

      signalingRef.current =
        null;
    };
  }, []);

  // ==========================================================
  // PROGRESS
  // ==========================================================

  const totalBytes =
    info?.totalBytes ??
    0;

  const receivedBytes =
    progress.reduce(
      (
        total,
        item,
      ) =>
        total +
        item.receivedBytes,
      0,
    );

  const overallPercent =
    totalBytes > 0
      ? Math.min(
          100,
          Math.round(
            (receivedBytes /
              totalBytes) *
              100,
          ),
        )
      : 0;

  const allDone =
    progress.length >
      0 &&
    progress.every(
      (item) =>
        item.state ===
          'done' ||
        item.totalBytes ===
          0,
    );

  useEffect(() => {
    if (allDone) {
      setPhase('done');
      setDownloading(false);
    }
  }, [allDone]);

  // ==========================================================
  // UI
  // ==========================================================

  if (phase === 'loading') {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-4">
        <div className="text-white/60">
          Loading room...
        </div>
      </main>
    );
  }

  if (phase === 'error') {
    return (
      <main className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-4">
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

  if (
    phase === 'password'
  ) {
    return (
      <PasswordDialog
        open
        mode="enter"
        onSubmit={(
          password,
        ) =>
          startDownload(
            password,
          )
        }
        onCancel={() =>
          router.push('/')
        }
      />
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8 sm:py-10">
      <header className="mb-6">
        <button
          onClick={() =>
            router.push('/')
          }
          className="text-sm text-white/60 hover:text-white"
        >
          ← DropBeam
        </button>
      </header>

      {info && (
        <div className="space-y-6">

          <section className="card">

            <div className="mb-2 flex items-center justify-between">

              <h1 className="truncate text-xl font-semibold">
                {info.files.length ===
                1
                  ? info.files[0]
                      .name
                  : `${info.files.length} files`}
              </h1>

              <span className="font-mono text-sm text-white/60">
                {formatBytes(
                  totalBytes,
                )}
              </span>

            </div>

            <p className="text-sm text-white/50">
              Host is{' '}
              {hostOnline
                ? 'online'
                : 'offline'}
              {' · '}
              Transfer is direct between browsers
            </p>

            {phase === 'info' && (
              <button
                onClick={() =>
                  startDownload(
                    null,
                  )
                }
                disabled={
                  downloading
                }
                className="btn-primary mt-4 px-6 py-3"
              >
                {downloading
                  ? 'Connecting...'
                  : 'Download'}
              </button>
            )}

          </section>

          {phase !== 'info' && (
            <section className="card">

              <div className="mb-2 flex justify-between">

                <span className="text-sm text-white/60">
                  Overall
                </span>

                <span className="font-mono text-sm">
                  {overallPercent}%
                </span>

              </div>

              <div className="h-2 overflow-hidden rounded-full bg-white/5">

                <div
                  className="h-full bg-gradient-to-r from-beam-500 to-beam-300"
                  style={{
                    width:
                      `${overallPercent}%`,
                  }}
                />

              </div>

              <div className="mt-2 text-xs text-white/40">
                {formatBytes(
                  receivedBytes,
                )}{' '}
                /{' '}
                {formatBytes(
                  totalBytes,
                )}
              </div>

            </section>
          )}

          {phase !== 'info' && (
            <section className="card">
              <ReceiverProgressView
                progress={
                  progress
                }
              />
            </section>
          )}

          {allDone && (
            <section className="card text-center">
              <div className="mb-2 text-2xl">
                ✅
              </div>

              <h2 className="text-lg font-semibold">
                Transfer complete
              </h2>
            </section>
          )}

        </div>
      )}
    </main>
  );
}