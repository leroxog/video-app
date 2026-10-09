/* raumo demo: a furnished practice room.  It is used in two places: to try the scan on a computer (or anywhere without a camera) --
   the virtual camera looks at this room and you aim at its corners just like at a real room -- and as the example building that shows
   what a finished scan looks like.  The room data are what a perfect scan would deliver (in the phone's own coordinates, the phone is
   at the origin); the pictures on the walls are drawn here. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./raumo-core.js"));
  else root.RaumoDemo = factory(root.RaumoCore);
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";

  const LIVING = {
    name: "Wohnzimmer", phoneHeight: 1.4, height: 2.6,
    polygon: [[-2.0, -1.7], [2.6, -1.7], [2.6, 2.0], [-2.0, 2.0]],
    openings: [
      { wall: 0, u0: 2.4, u1: 3.3, v0: 0, v1: 2.05, kind: "door" },
      { wall: 1, u0: 0.8, u1: 2.6, v0: 0.9, v1: 2.1, kind: "window" },
      { wall: 3, u0: 0.9, u1: 2.7, v0: 0.9, v1: 2.1, kind: "window" },
    ],
  };
  const HALL = {
    name: "Flur", phoneHeight: 1.4, height: 2.6,
    polygon: [[-0.8, -1.6], [0.8, -1.6], [0.8, 1.6], [-0.8, 1.6]],
    openings: [
      { wall: 2, u0: 0.3, u1: 1.2, v0: 0, v1: 2.05, kind: "door" },
      { wall: 0, u0: 0.35, u1: 1.25, v0: 0, v1: 2.05, kind: "door" },
    ],
  };
  const WALLS = ["#e9dfcf", "#d6e2e8", "#ecd7da", "#dde8d4"];

  /* The practice rooms as ready rooms: [{name, room}] (the first one is the one to scan). */
  function rooms() {
    return [LIVING, HALL].map((r) => ({ name: r.name, room: Core.makeRoom({ polygon: r.polygon, height: r.height, phoneHeight: r.phoneHeight, openings: r.openings }) }));
  }

  /* What the walls of the practice room look like: a picture for every surface, drawn on canvases of about 100 pixels to the metre. */
  function textures(room, document) {
    const make = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(32, Math.round(w)); c.height = Math.max(32, Math.round(h)); return c; };
    const out = {};
    Core.wallsOf(room.polygon).forEach((wall) => {
      const c = make(wall.len * 100, room.height * 100);
      const g = c.getContext("2d");
      const W = c.width, H = c.height;
      g.fillStyle = WALLS[wall.index % WALLS.length];
      g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(0,0,0,0.045)";
      for (let x = 0; x < W; x += 24) g.fillRect(x, 0, 10, H);                         // wallpaper stripes
      g.fillStyle = "#f4f1ea"; g.fillRect(0, H - 10, W, 10);                           // skirting board
      g.fillStyle = "rgba(0,0,0,0.12)"; g.fillRect(0, 0, W, 5);                        // shadow under the ceiling
      // a framed picture at a fixed place, so that you can tell where a wall's picture sits
      const fw = Math.min(110, W * 0.3), fh = fw * 0.72, fx = W * (0.18 + 0.13 * wall.index), fy = H * 0.24;
      g.fillStyle = "#3a2c22"; g.fillRect(fx - 7, fy - 7, fw + 14, fh + 14);
      const sky = g.createLinearGradient(0, fy, 0, fy + fh);
      sky.addColorStop(0, ["#4d8fd1", "#e8a45a", "#7ab07a", "#b46a9a"][wall.index % 4]); sky.addColorStop(1, "#f6e9c8");
      g.fillStyle = sky; g.fillRect(fx, fy, fw, fh);
      g.fillStyle = "rgba(255,255,255,0.65)"; g.beginPath(); g.arc(fx + fw * 0.7, fy + fh * 0.3, fh * 0.14, 0, Math.PI * 2); g.fill();
      g.fillStyle = "rgba(0,0,0,0.22)"; g.beginPath(); g.moveTo(fx, fy + fh); g.lineTo(fx + fw * 0.4, fy + fh * 0.45); g.lineTo(fx + fw * 0.7, fy + fh * 0.8); g.lineTo(fx + fw, fy + fh * 0.55); g.lineTo(fx + fw, fy + fh); g.fill();
      // a number so that the walls can be told apart, and a socket
      g.fillStyle = "rgba(0,0,0,0.18)"; g.font = `bold ${Math.round(H * 0.2)}px sans-serif`; g.textAlign = "center"; g.fillText(String(wall.index + 1), W * 0.62, H * 0.62);
      g.fillStyle = "#fbfaf6"; g.fillRect(W * 0.9, H * 0.85, 16, 16); g.fillStyle = "#555"; g.fillRect(W * 0.9 + 4, H * 0.85 + 4, 3, 5); g.fillRect(W * 0.9 + 9, H * 0.85 + 4, 3, 5);
      out[`wall:${wall.index}`] = c;
    });
    const b = Core.bounds(room.polygon);
    const f = make(b.width * 100, b.depth * 100);
    const g = f.getContext("2d");
    for (let y = 0; y < f.height; y += 14) {
      g.fillStyle = (Math.floor(y / 14) % 2) ? "#b88a5b" : "#c39665";
      g.fillRect(0, y, f.width, 14);
      g.fillStyle = "rgba(60,30,10,0.35)"; g.fillRect(0, y, f.width, 1);
      for (let x = (Math.floor(y / 14) % 3) * 70; x < f.width; x += 210) g.fillRect(x, y, 1, 14);
    }
    g.fillStyle = "rgba(150,60,60,0.55)"; g.fillRect(f.width * 0.25, f.height * 0.35, f.width * 0.4, f.height * 0.3);   // a rug
    g.strokeStyle = "rgba(255,255,255,0.6)"; g.lineWidth = 3; g.strokeRect(f.width * 0.25 + 6, f.height * 0.35 + 6, f.width * 0.4 - 12, f.height * 0.3 - 12);
    out.floor = f;
    return out;
  }

  /* Things behind the openings, so that the practice room does not look like it floats: a sky behind the windows, a dim passage behind
     the doors.  Returns surfaces for the viewer (`props`). */
  function props(room) {
    const walls = Core.wallsOf(room.polygon);
    const list = [];
    for (const o of room.openings) {
      const w = walls[o.wall];
      const out3 = [-w.inward[0], 0, -w.inward[1]];
      const d3 = [w.dir[0], 0, w.dir[1]];
      const depth = o.kind === "window" ? room.thickness + 0.03 : room.thickness + 1.2;
      const grow = o.kind === "window" ? 0 : 0.25;
      const p = (u, v, d) => [w.a[0] + w.dir[0] * u + out3[0] * d, v, w.a[1] + w.dir[1] * u + out3[2] * d];
      const surface = Core.newSurface("prop", "prop");
      Core.pushQuad(surface, [p(o.u0 - grow, o.v0, depth), p(o.u1 + grow, o.v0, depth), p(o.u1 + grow, o.v1 + grow, depth), p(o.u0 - grow, o.v1 + grow, depth)], [[0, 0], [1, 0], [1, 1], [0, 1]], [-out3[0], 0, -out3[2]]);
      list.push({ ...surface, color: o.kind === "window" ? [0.66, 0.8, 0.95, 1] : [0.3, 0.29, 0.28, 1] });
      if (o.kind === "window") {                                                         // the bars of the window frame
        const bar = Core.newSurface("prop", "prop");
        const mid = (o.u0 + o.u1) / 2, vm = (o.v0 + o.v1) / 2, d = room.thickness + 0.01;
        const nrm = [-out3[0], 0, -out3[2]];
        Core.pushQuad(bar, [p(mid - 0.025, o.v0, d), p(mid + 0.025, o.v0, d), p(mid + 0.025, o.v1, d), p(mid - 0.025, o.v1, d)], [[0, 0], [1, 0], [1, 1], [0, 1]], nrm);
        Core.pushQuad(bar, [p(o.u0, vm - 0.025, d), p(o.u1, vm - 0.025, d), p(o.u1, vm + 0.025, d), p(o.u0, vm + 0.025, d)], [[0, 0], [1, 0], [1, 1], [0, 1]], nrm);
        list.push({ ...bar, color: [0.97, 0.97, 0.95, 1] });
      }
    }
    return list;
  }

  return { LIVING, HALL, rooms, textures, props };
});
