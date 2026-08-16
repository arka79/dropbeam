import type { FileStorage } from '../storage';

export interface ResumeState {
  roomId: string;
  fileId: string;
  fileName: string;
  fileSize: number;
  mime: string;
  totalChunks: number;
  chunkSize: number;
  received: number[];
  expectedSha256?: string;
  updatedAt: number;
}

const RESUME_PREFIX = 'resume::';

export async function saveResumeState(storage: FileStorage, state: ResumeState) {
  await storage.setMetadata(RESUME_PREFIX + state.fileId, state as unknown as Record<string, unknown>);
}

export async function loadResumeState(storage: FileStorage, fileId: string): Promise<ResumeState | null> {
  return storage.getMetadata<ResumeState>(RESUME_PREFIX + fileId);
}

export async function listResumeStates(storage: FileStorage): Promise<ResumeState[]> {
  const found: ResumeState[] = [];
  const allFiles = await (storage as unknown as {
    listAllMetadata?: () => Promise<{ key: string; value: unknown }[]>;
  }).listAllMetadata?.();
  if (!allFiles) {
    return found;
  }
  for (const e of allFiles) {
    if (e.key.startsWith(RESUME_PREFIX)) {
      found.push(e.value as ResumeState);
    }
  }
  return found;
}

export async function clearResumeState(storage: FileStorage, fileId: string) {
  await storage.setMetadata(RESUME_PREFIX + fileId, { _deleted: true } as unknown as Record<string, unknown>);
}
