/* Satürn history (yipi-history.js): every clip and photo that the camera has finished is kept on THIS device for three days (IndexedDB, nothing goes to the server), so that nothing is lost when a
   clip is not posted. Settings > Verlauf lists them, only for the person who holds the device: nobody else can see them. `Y.history.add(blob, {name, photo, title})`, `list()`, `remove(id)`. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const DAYS = 3;
  const MAX_ITEMS = 60;
  const DB = "saturn-history";
  const STORE = "clips";

  let opened = null;
  function open() {
    if (opened) return opened;
    opened = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("no storage")); return; }
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true }); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    opened.catch(() => { opened = null; });
    return opened;
  }
  const run = (mode, work) => open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const result = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));

  async function list() {
    const all = (await run("readonly", (store) => store.getAll())) || [];
    const limit = Date.now() - DAYS * 86400000;
    return all.filter((item) => item.createdAt >= limit).sort((a, b) => b.createdAt - a.createdAt);
  }
  async function prune() {
    const all = (await run("readonly", (store) => store.getAll())) || [];
    const limit = Date.now() - DAYS * 86400000;
    const sorted = all.sort((a, b) => b.createdAt - a.createdAt);
    const drop = sorted.filter((item, index) => item.createdAt < limit || index >= MAX_ITEMS);
    for (const item of drop) await run("readwrite", (store) => store.delete(item.id));
  }
  async function add(blob, meta = {}) {
    if (!blob) return;
    await run("readwrite", (store) => store.add({ blob, name: meta.name || "satuern", photo: !!meta.photo, title: meta.title || "", createdAt: Date.now() }));
    prune().catch(() => {});
  }
  const remove = (id) => run("readwrite", (store) => store.delete(id));

  Y.history = { add, list, remove, prune, DAYS };
})();
