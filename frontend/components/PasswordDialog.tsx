'use client';

import { useState } from 'react';

export function PasswordDialog({
  open,
  onSubmit,
  onCancel,
  mode,
}: {
  open: boolean;
  onSubmit: (password: string | null) => void;
  onCancel: () => void;
  mode: 'set' | 'enter';
}) {
  const [pw, setPw] = useState('');
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-sm">
      <div className="card w-full max-w-sm animate-fade-in">
        <h2 className="mb-1 text-lg font-semibold text-white">
          {mode === 'set' ? 'Protect with a password' : 'Enter room password'}
        </h2>
        <p className="mb-4 text-sm text-white/50">
          {mode === 'set'
            ? 'Recipients will need this password to connect.'
            : 'This room is protected.'}
        </p>
        <input
          autoFocus
          type="password"
          className="input mb-4"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSubmit(pw || null);
            if (e.key === 'Escape') onCancel();
          }}
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost">
            Cancel
          </button>
          <button onClick={() => onSubmit(pw || null)} className="btn-primary">
            {mode === 'set' ? 'Create room' : 'Join room'}
          </button>
        </div>
      </div>
    </div>
  );
}
