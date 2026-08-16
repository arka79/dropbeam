import type { FileStorage } from './index';

const ROOT_DIR = 'dropbeam-v1';
const META_FILE = '__meta.json';

interface OpfsRoot {
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<FileSystemDirectoryHandle>;
}

interface SyncAccessHandleLike {
  write: (buf: ArrayBuffer, opts?: { at?: number }) => number;
  read: (buf: ArrayBuffer, opts?: { at?: number }) => number;
  truncate: (size: number) => void;
  getSize: () => number;
  flush: () => void;
  close: () => void;
}

interface OpfsFileHandle {
  createSyncAccessHandle?: () => Promise<SyncAccessHandleLike>;
  getFile: () => Promise<File>;
  remove: (options?: { recursive?: boolean }) => Promise<void>;
}

export class OpfsStorage implements FileStorage {
  private root: FileSystemDirectoryHandle | null = null;
  private asyncLocks = new Map<string, Promise<void>>();

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.asyncLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((res) => (release = res));
    this.asyncLocks.set(key, prev.then(() => next));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.asyncLocks.get(key) === next) this.asyncLocks.delete(key);
    }
  }

  private async getRoot(): Promise<FileSystemDirectoryHandle> {
    if (this.root) return this.root;
    const root = await (navigator as Navigator & {
      storage: { getDirectory: () => Promise<FileSystemDirectoryHandle> };
    }).storage.getDirectory();
    this.root = await root.getDirectoryHandle(ROOT_DIR, { create: true });
    return this.root;
  }

  private async getFileDir(fileId: string): Promise<FileSystemDirectoryHandle> {
    const root = await this.getRoot();
    return root.getDirectoryHandle(`f-${fileId}`, { create: true });
  }

  private async getDataFile(fileId: string, create = false): Promise<OpfsFileHandle> {
    const dir = await this.getFileDir(fileId);
    return (await dir.getFileHandle('data.bin', { create })) as unknown as OpfsFileHandle;
  }

  private chunkName(index: number): string {
    return `${index.toString(36).padStart(8, '0')}.part`;
  }

  private async getChunksDir(fileId: string) {
    const dir = await this.getFileDir(fileId);
    return dir.getDirectoryHandle('chunks', { create: true });
  }

  async writeChunk(fileId: string, index: number, data: ArrayBuffer): Promise<void> {
    return this.withLock(`${fileId}::chunk::${index}`, async () => {
      const dir = await this.getChunksDir(fileId);
      const handle = (await dir.getFileHandle(this.chunkName(index), { create: true })) as unknown as OpfsFileHandle;
      const sync = await handle.createSyncAccessHandle?.();
      if (sync) {
        sync.truncate(0);
        sync.write(data, { at: 0 });
        sync.flush();
        sync.close();
      } else {
        const w = await (handle as unknown as {
          createWritable: () => Promise<{
            write: (b: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }).createWritable();
        await w.write(new Blob([data]));
        await w.close();
      }
    });
  }

  async hasChunk(fileId: string, index: number): Promise<boolean> {
    try {
      const dir = await this.getChunksDir(fileId);
      await dir.getFileHandle(this.chunkName(index));
      return true;
    } catch {
      return false;
    }
  }

  async missingChunks(fileId: string, total: number): Promise<number[]> {
    const missing: number[] = [];
    for (let i = 0; i < total; i++) {
      if (!(await this.hasChunk(fileId, i))) missing.push(i);
    }
    return missing;
  }

  async receivedChunks(fileId: string): Promise<Set<number>> {
    const dir = await this.getChunksDir(fileId);
    const received = new Set<number>();
    for await (const entry of (dir as unknown as AsyncIterable<{ name: string }>)) {
      const m = entry.name.match(/^([0-9a-z]+)\.part$/);
      if (m) received.add(parseInt(m[1], 36));
    }
    return received;
  }

  async assemble(fileId: string, mime: string): Promise<Blob> {
    const dir = await this.getChunksDir(fileId);
    const parts: BlobPart[] = [];
    const sorted = (await this.receivedChunks(fileId)).values();
    const indexes: number[] = [];
    for (const v of sorted) indexes.push(v);
    indexes.sort((a, b) => a - b);
    for (const i of indexes) {
      const handle = (await dir.getFileHandle(this.chunkName(i))) as unknown as OpfsFileHandle;
      const file = await handle.getFile();
      parts.push(await file.arrayBuffer());
    }
    return new Blob(parts, { type: mime || 'application/octet-stream' });
  }

  async clear(fileId: string): Promise<void> {
    const root = await this.getRoot();
    try {
      await root.removeEntry(`f-${fileId}`, { recursive: true });
    } catch {
      // already gone
    }
  }

  async setMetadata(fileId: string, meta: Record<string, unknown>): Promise<void> {
    const dir = await this.getFileDir(fileId);
    const handle = (await dir.getFileHandle(META_FILE, { create: true })) as unknown as OpfsFileHandle;
    const w = await (handle as unknown as {
      createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }>;
    }).createWritable();
    await w.write(new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    await w.close();
  }

  async getMetadata<T>(fileId: string): Promise<T | null> {
    try {
      const dir = await this.getFileDir(fileId);
      const handle = (await dir.getFileHandle(META_FILE)) as unknown as OpfsFileHandle;
      const file = await handle.getFile();
      const text = await file.text();
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async listAllMetadata(): Promise<{ key: string; value: unknown }[]> {
    const root = await this.getRoot();
    const out: { key: string; value: unknown }[] = [];
    for await (const entry of (root as unknown as AsyncIterable<{ name: string }>)) {
      if (!entry.name.startsWith('f-')) continue;
      const fileId = entry.name.slice(2);
      const value = await this.getMetadata(fileId);
      if (value) out.push({ key: fileId, value });
    }
    return out;
  }
}
