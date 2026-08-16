'use client';

import { useCallback, useState, useRef } from 'react';
import { formatBytes } from '@/lib/utils/format';

export interface DropZoneProps {
  onFiles: (files: FileWithPath[]) => void;
  accept?: string;
  disabled?: boolean;
}

export interface FileWithPath {
  file: File;
  path?: string;
}

export function DropZone({ onFiles, disabled }: DropZoneProps) {
  const [active, setActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null, basePath?: string) => {
      if (!fileList) return;
      const out: FileWithPath[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const f = fileList[i] as File & { webkitRelativePath?: string };
        const rel =
          f.webkitRelativePath ||
          ((f as unknown as { relativePath?: string }).relativePath) ||
          basePath;
        out.push({ file: f, path: rel || undefined });
      }
      if (out.length) onFiles(out);
    },
    [onFiles],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setActive(false);
      if (disabled) return;
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles, disabled],
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!active) setActive(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setActive(false);
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      className={`group relative flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-10 text-center transition-all ${
        active
          ? 'border-beam-400 bg-beam-500/10'
          : 'border-white/10 bg-ink-800/40 hover:border-beam-500/40 hover:bg-ink-700/30'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <div className="pointer-events-none flex flex-col items-center gap-3">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-beam-500/15 text-beam-300 ring-1 ring-beam-500/20 transition-transform group-hover:scale-110">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 21h14" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-base font-medium text-white">
          Drop files here <span className="text-white/40">or click to browse</span>
        </p>
        <p className="text-xs text-white/40">Folders and multiple files supported · No size limit</p>
      </div>
    </div>
  );
}

export { formatBytes };
