/* Pulse games: Fruit Merge in the camera tab (pg-fruit.js). The game itself (fruit-merge.js and the physics library, loaded when it is chosen) draws into
   its own canvas, which stands in the lower part of the screen on top of the camera: there is no grey background, you see yourself behind the fruit.
   The three helpers of a round (shake, delete, bomb) are buttons under the field. */
(function () {
  "use strict";

  let assets = {};
  try { assets = JSON.parse(document.getElementById("yipiAssets").textContent) || {}; } catch (error) { assets = {}; }

  const loading = new Map();
  function loadScript(src) {
    if (!src) return Promise.reject(new Error("no address"));
    if (window.Matter && /matter/.test(src)) return Promise.resolve();
    if (window.FruitMerge && /fruit-merge/.test(src)) return Promise.resolve();
    if (!loading.has(src)) {
      loading.set(src, new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = src;
        tag.onload = () => resolve();
        tag.onerror = () => { loading.delete(src); tag.remove(); reject(new Error("could not load")); };
        document.head.append(tag);
      }));
    }
    return loading.get(src);
  }

  function element(tag, attributes, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes || {})) { if (key === "onclick") el.addEventListener("click", value); else el.setAttribute(key, String(value)); }
    for (const child of children) if (child) el.append(child);
    return el;
  }

  window.PulseGames.register({
    id: "fruit-merge", name: "Fruit Merge", emoji: "🍉", cat: "Beliebt", color: "#ff6b6b", hint: "Zielen und Früchte fallen lassen: zwei gleiche werden eine", external: true,
    prepare() { return loadScript(assets.matter).then(() => loadScript(assets.fruit)); },
    run(host, hooks) {
      const canvas = element("canvas", { class: "game-layer fm-canvas", "data-frame": "1", "aria-label": "Fruit Merge: Spielfeld" });
      const buttons = [];
      const power = (label, key, symbol) => {
        const count = element("span", { class: "fm-count" }, document.createTextNode("1"));
        const button = element("button", { class: "fm-power", type: "button", "aria-label": label, disabled: "" }, element("span", { class: "fm-power-ic" }, document.createTextNode(symbol)), element("span", { class: "fm-power-label" }, document.createTextNode(label)), count);
        button.addEventListener("click", () => player[key]());
        button.count = count;
        buttons.push([button, key]);
        return button;
      };
      const row = element("div", { class: "fm-powers" }, power("Schütteln", "shake", "↯"), power("Löschen", "toggleRemove", "✕"), power("Bombe", "toggleBomb", "💣"));
      const wrap = element("div", { class: "fm-wrap" }, canvas, row);
      host.append(wrap);
      const player = window.FruitMerge.create(canvas, {
        onScore: hooks.onScore,
        onOver: hooks.onOver,
        onPower(state) {
          for (const [button, key] of buttons) {
            const field = key === "toggleRemove" ? "remove" : key === "toggleBomb" ? "bomb" : "shake";
            button.count.textContent = String(state[field]);
            if (state.over || state[field] < 1) button.setAttribute("disabled", ""); else button.removeAttribute("disabled");
            button.classList.toggle("on", (key === "toggleRemove" && state.removing) || (key === "toggleBomb" && state.armed));
          }
        },
      });
      return { destroy() { player.destroy(); wrap.remove(); }, pause() {} };
    },
  });
})();
