'use client';

import { formatBytes } from '@/lib/utils/format';
import type { FileWithPath } from './DropZone';

export interface FileListItem {
  id: string;
  name: string;
  size: number;
  mime: string;
  path?: string;
  file: File;
}

export function FileList({
  files,
  onRemove,
  savedIds,
}: {
  files: FileListItem[];
  onRemove: (id: string) => void;
  savedIds: Set<string>;
}) {
  if (files.length === 0) return null;
  const total = files.reduce((a, f) => a + f.size, 0);
  return (
    <div className="card animate-fade-in">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-white/60">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <span className="font-mono text-white/80">{formatBytes(total)}</span>
      </div>
      <ul className="scrollbar-thin max-h-72 space-y-1 overflow-auto pr-1">
        {files.map((f) => {
          const saved = savedIds.has(f.id);
          return (
            <li
              key={f.id}
              className="group flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/[0.03] animate-slide-in"
            >
              <div className="relative h-8 w-8 shrink-0">
                <div className="absolute inset-0 grid place-items-center rounded-lg bg-ink-700 text-beam-300">
                  <FileIcon name={f.name} />
                </div>
                {!saved ? (
                  <svg className="absolute inset-0 h-8 w-8 -rotate-90 animate-[spin_1.5s_linear_infinite]" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="16" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2.5" />
                    <circle cx="18" cy="18" r="16" fill="none" stroke="url(#uploadGrad)" strokeWidth="2.5" strokeDasharray="80 200" strokeLinecap="round" />
                    <defs>
                      <linearGradient id="uploadGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#00d489" />
                        <stop offset="100%" stopColor="#3effbf" />
                      </linearGradient>
                    </defs>
                  </svg>
                ) : (
                  <div className="absolute inset-0 grid place-items-center rounded-lg bg-emerald-500/15 animate-check-in">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-white">{f.name}</div>
                {f.path && f.path !== f.name && (
                  <div className="truncate text-xs text-white/40">{f.path}</div>
                )}
              </div>
              <div className="shrink-0 text-xs text-white/50">{formatBytes(f.size)}</div>
              <button
                onClick={() => onRemove(f.id)}
                className="rounded-md p-1 text-white/30 opacity-0 transition-opacity hover:bg-white/5 hover:text-white group-hover:opacity-100"
                aria-label="Remove"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M6 18L18 6" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const colorMap: Record<string, string> = {
    mp4: 'text-pink-300',
    mov: 'text-pink-300',
    webm: 'text-pink-300',
    mp3: 'text-amber-300',
    wav: 'text-amber-300',
    flac: 'text-amber-300',
    jpg: 'text-emerald-300',
    jpeg: 'text-emerald-300',
    png: 'text-emerald-300',
    gif: 'text-emerald-300',
    webp: 'text-emerald-300',
    pdf: 'text-rose-300',
    doc: 'text-sky-300',
    docx: 'text-sky-300',
    zip: 'text-yellow-300',
    rar: 'text-yellow-300',
    '7z': 'text-yellow-300',
  };
  return (
    <span className={`text-[10px] font-bold uppercase ${colorMap[ext] ?? 'text-beam-300'}`}>
      {ext.slice(0, 3) || 'FILE'}
    </span>
  );
}
