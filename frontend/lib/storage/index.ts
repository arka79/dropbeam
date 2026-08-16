export interface FileStorage {
  writeChunk(fileId: string, index: number, data: ArrayBuffer): Promise<void>;
  hasChunk(fileId: string, index: number): Promise<boolean>;
  missingChunks(fileId: string, total: number): Promise<number[]>;
  receivedChunks(fileId: string): Promise<Set<number>>;
  assemble(fileId: string, mime: string): Promise<Blob>;
  clear(fileId: string): Promise<void>;
  setMetadata(fileId: string, meta: Record<string, unknown>): Promise<void>;
  getMetadata<T = unknown>(fileId: string): Promise<T | null>;
  listAllMetadata?(): Promise<{ key: string; value: unknown }[]>;
}

export async function createFileStorage(): Promise<FileStorage> {
  if (await isOpfsSupported()) {
    const { OpfsStorage } = await import('./opfs');
    return new OpfsStorage();
  }
  const { IdbStorage } = await import('./indexed-db');
  return new IdbStorage();
}

export async function isOpfsSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const storage = (navigator as Navigator & { storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> } })
    .storage;
  if (!storage?.getDirectory) return false;
  try {
    await storage.getDirectory();
    if (typeof FileSystemFileHandle === 'undefined' || typeof FileSystemSyncAccessHandle === 'undefined') {
      return typeof (FileSystemFileHandle.prototype as { createSyncAccessHandle?: unknown })
        .createSyncAccessHandle === 'function';
    }
    return true;
  } catch {
    return false;
  }
}
