/* KI-Regal download: puts the files of a model straight into a folder on the computer (Chrome and Edge on a computer can do that: the
   person picks a folder, the page writes the files into it while they arrive, with a progress bar).  The files come from Hugging Face to
   the browser; our server is not part of it.  Other browsers get the normal download of the browser (links), which this file does not
   need.  A file that is already in the folder with the right size is not fetched again. */
(function () {
  "use strict";

  const Core = window.RegalCore;
  const T = (window.Regal = window.Regal || {});

  const supported = () => typeof window.showDirectoryPicker === "function" && window.isSecureContext !== false;

  /* The person picks a folder (null when they changed their mind). */
  async function pickFolder() {
    try { return await window.showDirectoryPicker({ id: "regal-models", mode: "readwrite", startIn: "downloads" }); } catch (error) {
      if (error && error.name === "AbortError") return null;
      if (error && error.name === "SecurityError") throw new Error("Diesen Ordner erlaubt der Browser nicht. Lege einen neuen Ordner an (zum Beispiel „KI-Modelle“) und wähle den.");
      throw error;
    }
  }

  async function subfolder(root, segments) {
    let dir = root;
    for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create: true });
    return dir;
  }

  /* The files to fetch: [{id, path, size}] (every piece of a split model one by one). */
  function expand(model, chosen) {
    const out = [];
    for (const f of chosen) for (const path of f.paths) out.push({ id: model.id, path, size: f.parts > 1 ? Math.round(f.size / f.parts) : f.size });
    return out;
  }

  /* Downloads `items` into `root`.  options: {flat: no subfolders, signal, onProgress({index, count, path, loaded, total, speed, overallLoaded, overallTotal})}.
     Resolves to the number of files that were written (the ones that were there already do not count). */
  async function save(root, model, items, options = {}) {
    const { flat = false, signal, onProgress } = options;
    const total = items.reduce((s, i) => s + i.size, 0);
    let before = 0, written = 0;
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const segments = item.path.split("/");
      const name = segments.pop();
      const dir = flat ? root : await subfolder(root, [...model.id.split("/"), ...segments]);
      const report = (loaded, totalFile, speed) => onProgress && onProgress({ index, count: items.length, path: item.path, loaded, total: totalFile, speed, overallLoaded: before + loaded, overallTotal: total });
      try {
        const existing = await (await dir.getFileHandle(name)).getFile();
        if (item.size && existing.size === item.size) { before += item.size; report(item.size, item.size, 0); continue; }      // it is there
      } catch (error) { /* not there yet */ }
      const response = await fetch(Core.fileUrl(model.id, item.path, false), { signal });
      if (!response.ok || !response.body) throw new Error(`Die Datei „${name}“ konnte nicht geladen werden (Fehler ${response.status}).`);
      const size = Number(response.headers.get("Content-Length")) || item.size;
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      const reader = response.body.getReader();
      let loaded = 0, last = performance.now(), lastLoaded = 0, speed = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await writable.write(value);
          loaded += value.length;
          const now = performance.now();
          if (now - last > 400) { speed = (loaded - lastLoaded) / ((now - last) / 1000); last = now; lastLoaded = loaded; report(loaded, size, speed); }
        }
        await writable.close();
      } catch (error) {
        try { await writable.abort(); } catch (inner) { /* nothing left to undo */ }
        throw error;
      }
      before += loaded;
      written += 1;
      report(loaded, size, speed);
    }
    return written;
  }

  /* The normal download of the browser: one file after the other (a short pause between them, or the browser drops some). */
  async function viaBrowser(model, items, pause = 900) {
    for (const item of items) {
      const a = document.createElement("a");
      a.href = Core.fileUrl(model.id, item.path, true);
      a.rel = "noopener noreferrer";
      a.className = "offscreen";
      document.body.append(a);
      a.click();
      a.remove();
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
  }

  Object.assign(T, { Downloader: { supported, pickFolder, expand, save, viaBrowser } });
})();
