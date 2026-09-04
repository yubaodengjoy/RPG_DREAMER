(() => {
  const MAGIC = 'RPGPK001';
  const DB_NAME = 'rpg-dreamer-chapter-packs';
  const DB_VERSION = 1;
  const STORE_NAME = 'packs';
  const loadedPacks = new Map();
  const packPromises = new Map();
  const assetLocations = new Map();
  const objectUrls = new Map();
  let manifest = null;

  function report(progress, label) {
    window.__RPG_REPORT_PACK_PROGRESS__?.(progress, label);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function databaseRequest(mode, action) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = action(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  function getStoredPack(key) {
    return databaseRequest('readonly', (store) => store.get(key));
  }

  function storePack(record) {
    return databaseRequest('readwrite', (store) => store.put(record));
  }

  function downloadBlob(url, expectedSize, onProgress) {
    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('GET', url);
      request.responseType = 'blob';
      request.onprogress = (event) => {
        const total = event.lengthComputable ? event.total : expectedSize;
        onProgress(Math.min(event.loaded, total || event.loaded), total || expectedSize);
      };
      request.onload = () => {
        if (request.status < 200 || request.status >= 300) {
          reject(new Error(`Chapter pack request failed with ${request.status}.`));
          return;
        }
        onProgress(request.response.size, expectedSize || request.response.size);
        resolve(request.response);
      };
      request.onerror = () => reject(new Error('Chapter pack request failed.'));
      request.send();
    });
  }

  async function parsePack(packId, blob) {
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    if (new TextDecoder().decode(header.slice(0, 8)) !== MAGIC) {
      throw new Error(`${packId}: invalid RPG pack header.`);
    }
    const indexLength = new DataView(header.buffer).getUint32(8, true);
    const dataOffset = 12 + indexLength;
    const index = JSON.parse(
      new TextDecoder().decode(await blob.slice(12, dataOffset).arrayBuffer()),
    );
    const pack = { blob, dataOffset, entries: new Map() };
    for (const entry of index.entries) {
      pack.entries.set(entry.p, entry);
      assetLocations.set(entry.p, { packId, entry });
    }
    loadedPacks.set(packId, pack);
    return pack;
  }

  async function loadPack(packId, onProgress = () => {}) {
    if (!packId || loadedPacks.has(packId)) return loadedPacks.get(packId) ?? null;
    if (packPromises.has(packId)) return packPromises.get(packId);
    const details = manifest?.packs?.[packId];
    if (!details) return null;
    const promise = (async () => {
      const key = `${manifest.game}:${manifest.version}:${packId}:${details.sha256}`;
      let blob = null;
      try {
        const stored = await getStoredPack(key);
        if (stored?.blob?.size === details.size) {
          blob = stored.blob;
          onProgress(details.size, details.size);
        }
      } catch (error) {
        console.warn('Chapter pack cache could not be read.', error);
      }
      if (!blob) {
        blob = await downloadBlob(
          new URL(`./packs/${details.file}`, document.baseURI),
          details.size,
          onProgress,
        );
        if (blob.size !== details.size) {
          throw new Error(`${packId}: expected ${details.size} bytes, received ${blob.size}.`);
        }
        try {
          await storePack({
            key,
            blob,
            game: manifest.game,
            packId,
            savedAt: Date.now(),
            version: manifest.version,
          });
        } catch (error) {
          console.warn('Chapter pack will remain memory-only for this session.', error);
        }
      }
      return parsePack(packId, blob);
    })().catch((error) => {
      console.error(`Failed to prepare ${packId}; network asset fallback remains available.`, error);
      return null;
    });
    packPromises.set(packId, promise);
    return promise;
  }

  function normalizeAssetPath(value) {
    try {
      const pathname = new URL(value, document.baseURI).pathname;
      const marker = '/src/dist/';
      const markerIndex = pathname.lastIndexOf(marker);
      return markerIndex >= 0 ? pathname.slice(markerIndex + marker.length) : pathname.replace(/^\/+/, '');
    } catch {
      return String(value).replace(/^\.\//, '').replace(/^\/+/, '');
    }
  }

  function resolveAsset(value) {
    const assetPath = normalizeAssetPath(value);
    if (objectUrls.has(assetPath)) return objectUrls.get(assetPath);
    const location = assetLocations.get(assetPath);
    const pack = location ? loadedPacks.get(location.packId) : null;
    if (!pack) return value;
    const { entry } = location;
    const start = pack.dataOffset + entry.o;
    const url = URL.createObjectURL(pack.blob.slice(start, start + entry.l, entry.t));
    objectUrls.set(assetPath, url);
    return url;
  }

  function chapterForScene(sceneId) {
    return manifest?.sceneChapters?.[sceneId] ?? null;
  }

  async function ensureScene(sceneId) {
    return loadPack(chapterForScene(sceneId));
  }

  function enterScene(sceneId) {
    const chapter = chapterForScene(sceneId);
    if (!chapter) return;
    void loadPack(chapter);
    const index = manifest.order.indexOf(chapter);
    const nextChapter = index >= 0 ? manifest.order[index + 1] : null;
    if (nextChapter) void loadPack(nextChapter);
  }

  window.__RPG_PACK_RESOLVE__ = resolveAsset;
  window.__RPG_PACK_ENSURE_SCENE__ = ensureScene;
  window.__RPG_PACK_ENTER_SCENE__ = enterScene;
  window.__RPG_PACK_READY__ = (async () => {
    try {
      Promise.resolve(navigator.storage?.persist?.()).catch(() => {});
      const response = await fetch(new URL('./packs/manifest.json', document.baseURI), {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(`Pack manifest request failed with ${response.status}.`);
      manifest = await response.json();
      const initial = manifest.initial.filter((packId) => manifest.packs[packId]);
      const total = initial.reduce((sum, packId) => sum + manifest.packs[packId].size, 0);
      let completed = 0;
      for (const packId of initial) {
        const size = manifest.packs[packId].size;
        await loadPack(packId, (loaded) => {
          const progress = total > 0 ? (completed + Math.min(loaded, size)) / total : 1;
          report(progress, `Loading ${packId.replace('-', ' ')} ${Math.round(progress * 100)}%`);
        });
        completed += size;
      }
      report(1, 'Chapter ready');
      window.__RPG_REPORT_PACK_COMPLETE__?.();
    } catch (error) {
      console.error('Chapter package startup failed; using network assets.', error);
      report(1, 'Starting with network assets');
      window.__RPG_REPORT_PACK_COMPLETE__?.();
    }
  })();

  window.addEventListener('pagehide', () => {
    for (const url of objectUrls.values()) URL.revokeObjectURL(url);
    objectUrls.clear();
  });
})();
