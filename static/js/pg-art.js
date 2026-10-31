/* Nex game art (pg-art.js): the pieces the games use to look good and not like boxes -- skies with a sun and clouds, rolling hills, ground, soft shadows, little puffs and sparks when
   something happens, glass chips for the numbers. Everything is drawn with a few lines of canvas code (no pictures to load), is see-through where the camera should show, and
   works with the fake context of the tests. A scene is a set of colours (a "palette"); `Art.PALETTES` has a few. */
(function () {
  "use strict";

  const W = 360;
  const H = 640;
  const TAU = Math.PI * 2;
  const over = () => !!(window.PulseGames && window.PulseGames.cameraBackground);       // the camera is the background: no sky, no clouds, no hills

  const PALETTES = {
    day: { top: "#4fb4ff", bottom: "#d9f3ff", hill1: "#9bd8a5", hill2: "#6cc27c", sun: "#fff3a8", cloud: "rgba(255,255,255,0.95)", ground: "#7a5a3a", cap: "#58cf56", night: false },
    sunset: { top: "#ff7a59", bottom: "#ffd9a0", hill1: "#e0788f", hill2: "#b95d82", sun: "#fff0a8", cloud: "rgba(255,236,214,0.85)", ground: "#8a4d3a", cap: "#ffb347", night: false },
    desert: { top: "#ffb25c", bottom: "#ffe9b8", hill1: "#f2c27a", hill2: "#e0a35a", sun: "#fff6c9", cloud: "rgba(255,255,255,0.7)", ground: "#d49a55", cap: "#f0bb70", night: false },
    night: { top: "#080b2a", bottom: "#3b3d92", hill1: "#2c3070", hill2: "#232662", sun: "#f4f1c8", cloud: "rgba(150,160,255,0.28)", ground: "#363b78", cap: "#7fb0ff", night: true },
    neon: { top: "#12072e", bottom: "#4b1f8f", hill1: "#2a1060", hill2: "#1b0a45", sun: "#ff6ad5", cloud: "rgba(255,120,220,0.18)", ground: "#1b0a45", cap: "#37e6ff", night: true },
    space: { top: "#04050f", bottom: "#1a1450", hill1: "#16123e", hill2: "#0f0c2c", sun: "#cfd8ff", cloud: "rgba(150,160,255,0.2)", ground: "#222244", cap: "#9aa7ff", night: true },
    snow: { top: "#b7e4ff", bottom: "#ffffff", hill1: "#e8f4ff", hill2: "#d4e8f7", sun: "#fffbe0", cloud: "rgba(255,255,255,0.95)", ground: "#ffffff", cap: "#ffffff", night: false },
    cave: { top: "#17121f", bottom: "#41314d", hill1: "#2b2236", hill2: "#241c2d", sun: "#8e7bb5", cloud: "rgba(120,100,170,0.2)", ground: "#4d3b5c", cap: "#9a85c4", night: true },
  };

  const Art = {
    PALETTES,

    /* the sky of a palette over the whole field (a little see-through, so the camera shines through); with a sun and, at night, stars */
    sky(g, palette, t = 0, { alpha = 0.9, sun = true, sunX = 290, sunY = 120, stars = palette.night } = {}) {
      if (over()) return;
      const gradient = g.createLinearGradient(0, 0, 0, H);
      gradient.addColorStop(0, palette.top);
      gradient.addColorStop(1, palette.bottom);
      g.globalAlpha = alpha;
      g.fillStyle = gradient;
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
      if (stars) {
        g.fillStyle = "#fff";
        for (let i = 0; i < 34; i += 1) {
          g.globalAlpha = 0.35 + 0.55 * Math.abs(Math.sin(t * 1.6 + i * 1.7));
          g.beginPath();
          g.arc((i * 97) % W, 14 + ((i * 61) % 330), 0.7 + (i % 3) * 0.55, 0, TAU);
          g.fill();
        }
        g.globalAlpha = 1;
      }
      if (sun) {
        const glow = g.createRadialGradient(sunX, sunY, 4, sunX, sunY, 70);
        glow.addColorStop(0, palette.sun);
        glow.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = glow;
        g.fillRect(sunX - 80, sunY - 80, 160, 160);
        g.fillStyle = palette.sun;
        g.beginPath(); g.arc(sunX, sunY, 26, 0, TAU); g.fill();
      }
    },

    /* one soft cloud with its middle at (x, y) */
    cloud(g, x, y, size = 1, color = "rgba(255,255,255,0.95)") {
      if (over()) return;
      g.fillStyle = color;
      g.beginPath();
      g.arc(x, y, 18 * size, 0, TAU); g.arc(x + 22 * size, y - 9 * size, 24 * size, 0, TAU); g.arc(x + 50 * size, y, 17 * size, 0, TAU);
      g.rect(x, y, 50 * size, 17 * size);
      g.fill();
    },

    /* soft clouds that drift with `scroll` (in the pixels of the ground) at a slow pace */
    clouds(g, palette, scroll, { y = 60, rows = 3, speed = 0.18, size = 1 } = {}) {
      if (over()) return;
      for (let i = 0; i < rows * 2; i += 1) {
        const x = ((((i * 211) % 520) - scroll * speed * (0.7 + (i % 3) * 0.25)) % 560 + 560) % 560 - 100;
        Art.cloud(g, x, y + (i * 53) % 190, size, palette.cloud);
      }
    },

    /* a row of hills that moves slower than the ground in front of it */
    hills(g, color, base, scroll, { amp = 38, length = 70, phase = 0, speed = 0.3 } = {}) {
      if (over()) return;
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 10) g.lineTo(x, base - amp * (0.5 + 0.5 * Math.sin((x + scroll * speed) / length + phase)));
      g.lineTo(W, H);
      g.closePath();
      g.fill();
    },

    /* the ground: a strip with a bright edge and little marks that run past */
    ground(g, palette, y, scroll, { height = H - y, stripe = true } = {}) {
      g.fillStyle = palette.ground;
      g.fillRect(0, y, W, height);
      g.fillStyle = palette.cap;
      g.fillRect(0, y, W, 9);
      g.fillStyle = "rgba(0,0,0,0.16)";
      g.fillRect(0, y + 9, W, 4);
      if (stripe) {
        g.fillStyle = "rgba(0,0,0,0.13)";
        for (let x = -((scroll % 56) + 56); x < W + 56; x += 56) { g.beginPath(); g.moveTo(x, y + 16); g.lineTo(x + 24, y + 16); g.lineTo(x + 12, y + 34); g.closePath(); g.fill(); }
      }
    },

    shadow(g, x, y, w, alpha = 0.25) {
      g.fillStyle = `rgba(0,0,0,${alpha})`;
      g.beginPath(); g.ellipse(x, y, w / 2, Math.max(2, w / 7), 0, 0, TAU); g.fill();
    },

    /* an emoji as a figure: angle, mirror, a stretch (sx, sy) for squash and stretch */
    sprite(g, ch, x, y, size = 40, { angle = 0, flip = false, sx = 1, sy = 1, alpha = 1 } = {}) {
      g.save();
      g.translate(x, y);
      if (angle) g.rotate(angle);
      g.scale(flip ? -sx : sx, sy);
      g.globalAlpha = alpha;
      g.fillStyle = "#222";
      g.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(ch, 0, 0);
      g.restore();
    },

    /* a rounded block with a light top edge and a dark bottom edge (looks a little like a toy) */
    block(g, x, y, w, h, color, { radius = 8, light = "rgba(255,255,255,0.35)", dark = "rgba(0,0,0,0.22)" } = {}) {
      g.fillStyle = color;
      g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, radius); else g.rect(x, y, w, h); g.fill();
      g.fillStyle = light;
      g.beginPath(); if (g.roundRect) g.roundRect(x + 3, y + 3, Math.max(0, w - 6), Math.min(8, h / 3), radius / 2); else g.rect(x + 3, y + 3, w - 6, 6); g.fill();
      g.fillStyle = dark;
      g.beginPath(); if (g.roundRect) g.roundRect(x + 2, y + h - 7, Math.max(0, w - 4), 6, radius / 2); else g.rect(x + 2, y + h - 7, w - 4, 6); g.fill();
    },

    /* a glass chip with a text (for a number in a corner) */
    chip(g, text, x, y, { size = 20, align = "center", color = "#fff" } = {}) {
      g.font = `800 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      const w = g.measureText(String(text)).width + 26;
      const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
      g.fillStyle = "rgba(0,0,0,0.42)";
      g.beginPath(); if (g.roundRect) g.roundRect(left, y - size * 0.8, w, size * 1.6, size * 0.8); else g.rect(left, y - size * 0.8, w, size * 1.6); g.fill();
      g.fillStyle = color;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(text), left + w / 2, y + 1);
    },

    /* puffs and sparks: fx.burst(x, y, color, n, speed), fx.update(dt), fx.draw(g); fx.drift(dx, dy) moves them with a world that scrolls */
    fx() {
      let list = [];
      return {
        burst(x, y, color = "#fff", n = 8, speed = 120, life = 0.5, gravity = 400) {
          for (let i = 0; i < n; i += 1) { const a = Math.random() * TAU, s = speed * (0.4 + Math.random() * 0.8); list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - speed * 0.3, life, max: life, color, size: 2 + Math.random() * 3, gravity }); }
        },
        trail(x, y, color = "rgba(255,255,255,0.7)", size = 5, life = 0.35) { list.push({ x, y, vx: 0, vy: 0, life, max: life, color, size, gravity: 0 }); },
        update(dt) {
          for (const p of list) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.gravity * dt; p.life -= dt; }
          list = list.filter((p) => p.life > 0);
        },
        draw(g) {
          for (const p of list) { g.globalAlpha = Math.max(0, p.life / p.max); g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.size * (0.5 + 0.5 * p.life / p.max), 0, TAU); g.fill(); }
          g.globalAlpha = 1;
        },
        drift(dx, dy = 0) { for (const p of list) { p.x += dx; p.y += dy; } },
        clear() { list = []; },
      };
    },
  };

  window.PulseArt = Art;
})();
