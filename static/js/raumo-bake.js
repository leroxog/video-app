/* raumo bake: turns the photos of a scan into the pictures that cover the walls, the floor and the ceiling (see Core.bakeRows for the
   method), keeps them in the store so that they have to be made only once, and loads them again for the viewer. */
(function () {
  "use strict";

  const Core = window.RaumoCore;
  const Store = window.RaumoStore;
  const R = (window.Raumo = window.Raumo || {});

  const round = (x) => Math.round(x * 1000) / 1000;

  /* What the pictures were made from: when this changes (the room was corrected, the angle of view was changed, new photos), the
     old pictures are not used any more. */
  function bakeKey(stored) {
    if (stored.source === "demo") return "demo-1";
    return JSON.stringify([stored.polygon.map((p) => [round(p[0]), round(p[1])]), round(stored.height), round(stored.phoneHeight), round(stored.fov), stored.photoCount, stored.photoStamp || 0]);
  }

  const surfaceIds = (room) => Core.buildRoomSurfaces(room).filter((s) => s.kind === "wall" || s.kind === "floor" || s.kind === "ceiling").map((s) => s.id);

  async function decode(blob) {
    if (typeof createImageBitmap === "function") return createImageBitmap(blob);
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
    } finally { URL.revokeObjectURL(url); }
  }

  const toBlob = (canvas, type = "image/jpeg", quality = 0.86) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

  /* Bakes the pictures of a room from its photos.  Returns {textures: {surfaceId: canvas}, coverage: {surfaceId: share}}. */
  async function bake(stored, photos, options = {}) {
    const room = Store.roomOf(stored);
    const progress = options.onProgress || (() => {});
    const cameras = [];
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      const bitmap = await decode(p.blob);
      const canvas = document.createElement("canvas");
      canvas.width = p.width || bitmap.width;
      canvas.height = p.height || bitmap.height;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      const data = g.getImageData(0, 0, canvas.width, canvas.height);
      cameras.push(Core.makeCamera({ position: [0, room.phoneHeight, 0], forward: p.forward, up: p.up, width: canvas.width, height: canvas.height, pixels: data.data }, stored.fov));
      progress((i + 1) / photos.length * 0.2);
    }
    const planes = [];
    Core.wallsOf(room.polygon).forEach((w) => planes.push([`wall:${w.index}`, Core.wallPlane(room, w.index)]));
    planes.push(["floor", Core.floorPlane(room)], ["ceiling", Core.ceilingPlane(room)]);
    const textures = {}, coverage = {};
    let done = 0;
    for (const [id, plane] of planes) {
      const [w, h] = Core.textureSize(plane.size, options.pxPerMeter || 150, options.maxSize || 1536);
      const job = Core.newBake(plane, cameras, w, h);
      let last = performance.now();
      for (let y = 0; y < h; y += 8) {
        Core.bakeRows(job, y, Math.min(h, y + 8));
        if (performance.now() - last > 30) { await R.nextFrame(); last = performance.now(); }
      }
      coverage[id] = Core.fillGaps(job);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").putImageData(new ImageData(job.rgba, w, h), 0, 0);
      textures[id] = canvas;
      done += 1;
      progress(0.2 + 0.8 * done / planes.length);
      await R.nextFrame();
    }
    // the floor and the ceiling are only kept when the photos really showed them (otherwise a smear of the walls' edges)
    for (const id of ["floor", "ceiling"]) if (coverage[id] < 0.45) delete textures[id];
    return { textures, coverage };
  }

  /* The pictures of a room for the viewer: from the store if they are current, otherwise baked now (and kept).  Returns
     {surfaceId: picture} (possibly empty). */
  async function roomTextures(store, stored, options = {}) {
    const want = bakeKey(stored);
    const found = {};
    let current = true, any = false;
    for (const id of surfaceIds(Store.roomOf(stored))) {
      const entry = await store.getTexture(stored.id, id);
      if (!entry) continue;
      any = true;
      if (entry.version !== want) { current = false; break; }
      found[id] = entry.blob;
    }
    if (any && current) {
      const out = {};
      for (const [id, blob] of Object.entries(found)) out[id] = await decode(blob);
      return out;
    }
    if (!stored.photoCount || options.noBake) return {};
    const photos = await store.getPhotos(stored.id);
    if (!photos.length) return {};
    const { textures } = await bake(stored, photos, options);
    await store.clearTextures(stored.id);
    for (const [id, canvas] of Object.entries(textures)) await store.putTexture(stored.id, id, await toBlob(canvas), want);
    return textures;
  }

  /* Pictures drawn by the practice room, kept like baked ones. */
  async function keepPictures(store, stored, canvases) {
    await store.clearTextures(stored.id);
    for (const [id, canvas] of Object.entries(canvases)) await store.putTexture(stored.id, id, await toBlob(canvas), bakeKey(stored));
  }

  Object.assign(R, { bakeKey, bakeRoom: bake, roomTextures, keepPictures, decodeImage: decode, canvasToBlob: toBlob });
})();
