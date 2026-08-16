import type { FileStorage } from './index';

const DB_NAME = 'dropbeam';
const DB_VERSION = 1;
const META_STORE = 'metadata';
const CHUNKS_STORE = 'chunks';

interface StoredMetadata {
  fileId: string;
  meta: Record<string, unknown>;
}

interface StoredChunk {
  key: string;
  fileId: string;
  index: number;
  blob: Blob;
}

function chunkKey(fileId: string, index: number): string {
  return `${fileId}::${index}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'fileId' });
      }
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        const store = db.createObjectStore(CHUNKS_STORE, { keyPath: 'key' });
        store.createIndex('by-file', 'fileId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  store: string | string[],
  mode: IDBTransactionMode,
  fn: (stores: Record<string, IDBObjectStore>) => Promise<T> | T,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const stores: Record<string, IDBObjectStore> = {};
        const names = Array.isArray(store) ? store : [store];
        for (const n of names) stores[n] = t.objectStore(n);
        let result: T;
        Promise.resolve(fn(stores))
          .then((r) => (result = r))
          .catch(reject);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IdbStorage implements FileStorage {
  async writeChunk(fileId: string, index: number, data: ArrayBuffer): Promise<void> {
    const key = chunkKey(fileId, index);
    await tx(CHUNKS_STORE, 'readwrite', (s) =>
      reqAsPromise(
        s[CHUNKS_STORE].put({ key, fileId, index, blob: new Blob([data]) } as StoredChunk),
      ),
    );
  }

  async hasChunk(fileId: string, index: number): Promise<boolean> {
    return tx(CHUNKS_STORE, 'readonly', async (s) => {
      const got = await reqAsPromise(s[CHUNKS_STORE].get(chunkKey(fileId, index)));
      return Boolean(got);
    });
  }

  async missingChunks(fileId: string, total: number): Promise<number[]> {
    const received = await this.receivedChunks(fileId);
    const missing: number[] = [];
    for (let i = 0; i < total; i++) {
      if (!received.has(i)) missing.push(i);
    }
    return missing;
  }

  async receivedChunks(fileId: string): Promise<Set<number>> {
    return tx(CHUNKS_STORE, 'readonly', async (s) => {
      const index = s[CHUNKS_STORE].index('by-file');
      const set = new Set<number>();
      return new Promise<Set<number>>((resolve, reject) => {
        const cursorReq = index.openCursor(IDBKeyRange.only(fileId));
        cursorReq.onsuccess = () => {
          const cur = cursorReq.result;
          if (cur) {
            set.add((cur.value as StoredChunk).index);
            cur.continue();
          } else {
            resolve(set);
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
    });
  }

  async assemble(fileId: string, mime: string): Promise<Blob> {
    return tx(CHUNKS_STORE, 'readonly', async (s) => {
      const index = s[CHUNKS_STORE].index('by-file');
      const parts: BlobPart[] = [];
      await new Promise<void>((resolve, reject) => {
        const cursorReq = index.openCursor(IDBKeyRange.only(fileId));
        const collected: StoredChunk[] = [];
        cursorReq.onsuccess = () => {
          const cur = cursorReq.result;
          if (cur) {
            collected.push(cur.value as StoredChunk);
            cur.continue();
          } else {
            collected.sort((a, b) => a.index - b.index);
            for (const c of collected) parts.push(c.blob);
            resolve();
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
      return new Blob(parts, { type: mime || 'application/octet-stream' });
    });
  }

  async clear(fileId: string): Promise<void> {
    await tx([CHUNKS_STORE, META_STORE], 'readwrite', async (s) => {
      const index = s[CHUNKS_STORE].index('by-file');
      await new Promise<void>((resolve, reject) => {
        const cursorReq = index.openCursor(IDBKeyRange.only(fileId));
        cursorReq.onsuccess = () => {
          const cur = cursorReq.result;
          if (cur) {
            cur.delete();
            cur.continue();
          } else resolve();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
      await reqAsPromise(s[META_STORE].delete(fileId));
    });
  }

  async setMetadata(fileId: string, meta: Record<string, unknown>): Promise<void> {
    await tx(META_STORE, 'readwrite', (s) =>
      reqAsPromise(s[META_STORE].put({ fileId, meta } as StoredMetadata)),
    );
  }

  async getMetadata<T>(fileId: string): Promise<T | null> {
    return tx(META_STORE, 'readonly', async (s) => {
      const got = (await reqAsPromise(s[META_STORE].get(fileId))) as StoredMetadata | undefined;
      return (got?.meta as T) ?? null;
    });
  }

  async listAllMetadata(): Promise<{ key: string; value: unknown }[]> {
    return tx(META_STORE, 'readonly', async (s) => {
      const out: { key: string; value: unknown }[] = [];
      await new Promise<void>((resolve, reject) => {
        const cursorReq = s[META_STORE].openCursor();
        cursorReq.onsuccess = () => {
          const cur = cursorReq.result;
          if (cur) {
            const v = (cur.value as StoredMetadata).meta;
            out.push({ key: (cur.value as StoredMetadata).fileId, value: v });
            cur.continue();
          } else resolve();
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      });
      return out;
    });
  }
}
