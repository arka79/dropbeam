import type { FileMetadata } from '../webrtc/signaling';

export const DEFAULT_CHUNK_SIZE = 1024 * 1024;

export interface ChunkPlan {
  fileId: string;
  totalChunks: number;
  chunkSize: number;
}

export function planChunks(file: { id: string; size: number }, chunkSize = DEFAULT_CHUNK_SIZE): ChunkPlan {
  return {
    fileId: file.id,
    chunkSize,
    totalChunks: Math.max(1, Math.ceil(file.size / chunkSize)),
  };
}

export function fileMetadataFromFile(
  file: File,
  id: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  path?: string,
): FileMetadata {
  return {
    id,
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream',
    totalChunks: Math.max(1, Math.ceil(file.size / chunkSize)),
    path,
  };
}

export interface ChunkRange {
  start: number;
  end: number;
}

export function chunkRangeFor(
  totalSize: number,
  chunkIndex: number,
  chunkSize: number,
): ChunkRange {
  const start = chunkIndex * chunkSize;
  const end = Math.min(start + chunkSize, totalSize);
  return { start, end };
}

export function missingChunkIndexes(
  totalChunks: number,
  received: Set<number>,
): number[] {
  const missing: number[] = [];
  for (let i = 0; i < totalChunks; i++) {
    if (!received.has(i)) missing.push(i);
  }
  return missing;
}
