const DB_NAME = 'dropbeam-host';
const DB_VERSION = 1;
const FILES_STORE = 'host-files';

interface StoredFile {
  id: string;
  file: File;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveHostFile(id: string, file: File): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(FILES_STORE, 'readwrite');
    t.objectStore(FILES_STORE).put({ id, file } as StoredFile);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function loadHostFile(id: string): Promise<File | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(FILES_STORE, 'readonly');
    const req = t.objectStore(FILES_STORE).get(id);
    req.onsuccess = () => {
      const v = req.result as StoredFile | undefined;
      resolve(v?.file ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearHostFile(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(FILES_STORE, 'readwrite');
    t.objectStore(FILES_STORE).delete(id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
