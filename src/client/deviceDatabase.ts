let database: Promise<IDBDatabase | null> | undefined;
export function openDeviceDatabase() {
  return database ??= new Promise<IDBDatabase | null>((resolve) => {
    let finished = false;
    const finish = (db: IDBDatabase | null) => { if (finished) { db?.close(); return; } finished = true; clearTimeout(timer); resolve(db); };
    const timer = setTimeout(() => finish(null), 1500);
    try {
      if (typeof indexedDB === 'undefined') { finish(null); return; }
      const request = indexedDB.open('sfeed-reader-cache', 2);
      request.onupgradeneeded = () => {
        for (const name of ['snapshots', 'content']) {
          if (request.result.objectStoreNames.contains(name)) continue;
          const store = request.result.createObjectStore(name, { keyPath: ['account', 'key'] });
          store.createIndex('account', 'account'); store.createIndex('age-size', ['savedAt', 'size']);
        }
      };
      request.onerror = request.onblocked = () => finish(null);
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; finish(request.result); };
    } catch { finish(null); }
  });
}
