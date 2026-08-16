'use client';

import type { PeerSlot } from '@/lib/webrtc/peer';
import { formatBytes, formatSpeed, formatDuration } from '@/lib/utils/format';

const stateColor: Record<string, string> = {
  connected: 'bg-beam-400',
  connecting: 'bg-amber-400 animate-pulse',
  new: 'bg-white/30',
  failed: 'bg-red-400',
  disconnected: 'bg-white/20',
  closed: 'bg-white/20',
};

export function PeerList({ peers }: { peers: PeerSlot[] }) {
  if (peers.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-sm text-white/40">
        Waiting for someone to join…
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {peers.map((p) => (
        <li
          key={p.peerId}
          className="flex items-center gap-3 rounded-xl border border-white/5 bg-ink-800/40 px-3 py-2.5"
        >
          <span className={`h-2.5 w-2.5 rounded-full ${stateColor[p.state] ?? 'bg-white/20'}`} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-xs text-white/80">
              {p.peerId.slice(0, 8)}…
            </div>
            <div className="text-[10px] uppercase tracking-wider text-white/40">
              {p.state}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function TransferProgressList({ peers }: { peers: PeerSlot[] }) {
  return (
    <div className="space-y-3">
      {peers.map((p) => {
        const total = p.senderProgress.reduce((a, x) => a + x.totalBytes, 0);
        const sent = p.senderProgress.reduce((a, x) => a + x.sentBytes, 0);
        const speed =
          p.senderProgress.reduce((a, x) => a + x.speed, 0) ||
          p.receiverProgress.reduce((a, x) => a + x.speed, 0);
        const percent = total > 0 ? Math.round((sent / total) * 100) : 0;
        return (
          <div key={p.peerId} className="rounded-xl border border-white/5 bg-ink-800/40 p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-mono text-xs text-white/80">
                {p.peerId.slice(0, 8)}…
              </span>
              <div className="flex items-center gap-3 text-xs text-white/50">
                <span>{formatBytes(sent)} / {formatBytes(total)}</span>
                <span>{formatSpeed(speed)}</span>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full bg-gradient-to-r from-beam-500 to-beam-300 transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-white/40">
              <span>{percent}%</span>
              <span>ETA {formatDuration((total - sent) / (speed || 1))}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
