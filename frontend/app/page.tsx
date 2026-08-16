'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DropZone, type FileWithPath } from '@/components/DropZone';
import { FileList, type FileListItem } from '@/components/FileList';
import { formatBytes } from '@/lib/utils/format';

export default function HomePage() {
  const router = useRouter();
  const [files, setFiles] = useState<FileListItem[]>([]);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = async (incoming: FileWithPath[]) => {
    const { saveHostFile } = await import('@/lib/storage/host-store');
    setFiles((prev) => {
      const out = [...prev];
      for (const { file, path } of incoming) {
        const id = `${file.name}-${file.size}-${file.lastModified || 0}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        out.push({
          id,
          file,
          name: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
          path: path && path !== file.name ? path : undefined,
        });
        void saveHostFile(id, file);
      }
      return out;
    });
  };

  const total = files.reduce((a, f) => a + f.size, 0);

  const create = async () => {
    if (files.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const tempId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const manifest = {
        roomId: tempId,
        files: files.map((f) => ({
          id: f.id,
          name: f.name,
          size: f.size,
          mime: f.mime,
          path: f.path,
          blobIndex: f.id,
        })),
        chunkSize: 1024 * 1024,
        hasPassword: usePassword && !!password,
        iceServers: [],
      };
      sessionStorage.setItem(`host::${tempId}`, JSON.stringify(manifest));
      router.push(`/host/${tempId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-10 sm:py-16">
      <header className="mb-10 flex items-center justify-between">
        <Logo />
        <a
          href="https://github.com"
          className="text-xs text-white/40 hover:text-white/70"
          target="_blank"
          rel="noopener"
        >
          v1.0
        </a>
      </header>

      <section className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Private P2P File Sharing
        </h1>
        <p className="mt-2 text-white/50">
          Send huge files directly between browsers. No server storage, end-to-end peer transfer.
        </p>
      </section>

      <section className="space-y-4">
        <DropZone onFiles={addFiles} />
        <FileList
          files={files}
          onRemove={(id) => setFiles((prev) => prev.filter((f) => f.id !== id))}
        />

        <div className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm text-white/80">
              Total: <span className="font-mono">{formatBytes(total)}</span> ·{' '}
              <span className="text-white/50">{files.length} files</span>
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-white/60">
              <input
                type="checkbox"
                checked={usePassword}
                onChange={(e) => setUsePassword(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-ink-800 accent-beam-500"
              />
              Password protect
            </label>
            {usePassword && (
              <input
                type="password"
                placeholder="Room password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input mt-2 max-w-xs"
              />
            )}
          </div>
          <button
            onClick={create}
            disabled={files.length === 0 || creating || (usePassword && !password)}
            className="btn-primary px-6 py-3 text-base"
          >
            {creating ? 'Creating…' : 'Create Share'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M13 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {error && <div className="text-sm text-red-300">{error}</div>}

        <div className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-3">
          <FeatureChip
            title="Direct P2P"
            desc="Browser to browser over WebRTC"
          />
          <FeatureChip
            title="Multi-GB"
            desc="Chunked, resumable, no RAM bloat"
          />
          <FeatureChip
            title="Verified"
            desc="SHA-256 integrity on every file"
          />
        </div>
      </section>
    </main>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-beam-400 to-beam-600 text-ink-950 shadow-lg shadow-beam-500/20">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 12h18M12 3v18" strokeLinecap="round" />
          <circle cx="12" cy="12" r="3" fill="currentColor" />
        </svg>
      </div>
      <span className="text-lg font-semibold tracking-tight text-white">DropBeam</span>
    </div>
  );
}

function FeatureChip({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-ink-800/30 p-3">
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="text-xs text-white/40">{desc}</div>
    </div>
  );
}
