'use client';

import type { ReceiverProgress } from '@/lib/transfer/receiver';
import { formatBytes, formatSpeed, formatDuration } from '@/lib/utils/format';

export function ReceiverProgressView({ progress }: { progress: ReceiverProgress[] }) {
  if (progress.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-white/40">
        Connecting…
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {progress.map((p) => {
        const percent = p.totalBytes > 0 ? Math.round((p.receivedBytes / p.totalBytes) * 100) : 0;
        return (
          <div key={p.fileId} className="rounded-xl border border-white/5 bg-ink-800/40 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{p.fileName}</div>
                {p.path && p.path !== p.fileName && (
                  <div className="truncate text-[11px] text-white/40">{p.path}</div>
                )}
              </div>
              <div className="ml-3 shrink-0 text-right">
                <div className="font-mono text-sm text-white/80">{percent}%</div>
                <div className="text-[10px] text-white/40">{p.state}</div>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/5">
              <div
                className={`h-full transition-all ${
                  p.state === 'done' && p.hashResult === 'ok'
                    ? 'bg-gradient-to-r from-emerald-500 to-emerald-300'
                    : p.state === 'error' || p.hashResult === 'mismatch'
                    ? 'bg-gradient-to-r from-red-500 to-red-300'
                    : 'bg-gradient-to-r from-beam-500 to-beam-300'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-white/50">
              <div>
                <div className="text-white/30">Size</div>
                <div className="font-mono text-white/70">
                  {formatBytes(p.receivedBytes)} / {formatBytes(p.totalBytes)}
                </div>
              </div>
              <div>
                <div className="text-white/30">Speed</div>
                <div className="font-mono text-white/70">{formatSpeed(p.speed)}</div>
              </div>
              <div>
                <div className="text-white/30">ETA</div>
                <div className="font-mono text-white/70">{formatDuration(p.eta)}</div>
              </div>
            </div>
            {p.hashResult && (
              <div className={`mt-2 text-[11px] ${
                p.hashResult === 'ok' ? 'text-emerald-300' : 'text-red-300'
              }`}>
                {p.hashResult === 'ok' ? '✓ Integrity verified (SHA-256)' : '✗ Integrity check failed'}
                {p.expectedHash && (
                  <span className="ml-2 font-mono text-white/30">
                    {p.expectedHash.slice(0, 12)}…
                  </span>
                )}
              </div>
            )}
            {p.error && (
              <div className="mt-2 text-[11px] text-red-300">{p.error}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
