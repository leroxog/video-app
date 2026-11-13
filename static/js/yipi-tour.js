/* Satürn tour (yipi-tour.js): the first time somebody is on Home (a new account or an old one: everybody sees it once) the page gets a little darker and a hand shows what to do, with no words,
   like on TikTok, Snapchat and Instagram: swipe up to scroll, tap the Videos tab, swipe up for the next video, tap twice to like, swipe to the side to see the person. The dark layer lets every touch
   through, so the person can really do it; a step is over when the gesture was made. Whoever wants to leave early taps the screen quickly six times after the step has been there for five seconds.
   Only on a phone held upright. It is remembered per account in this browser. */
(function () {
  "use strict";

  const Y = window.Yipi;
  const { h, icon } = Y;

  const narrow = () => !window.matchMedia || matchMedia("(max-width: 819px)").matches;
  const key = () => `saturn.tour.${Y.me ? Y.me.handle : ""}`;
  const seen = () => { try { return localStorage.getItem(key()) === "done"; } catch (error) { return true; } };         // (no storage: no tour, it would come back every time)
  let running = false;

  /* The steps: where the hand is, how it moves, and what the person has to do for the step to be over. */
  const STEPS = [
    { id: "scroll", page: "/", move: "up", done: (api) => api.scrolled(60) },
    { id: "videos", page: "/", move: "tap", at: () => document.querySelector('.tab-item[data-nav="videos"]'), done: (api) => api.path() === "/videos" },
    { id: "next", page: "/videos", move: "up", done: (api) => api.reelsScrolled() },
    { id: "like", page: "/videos", move: "double", done: (api) => api.doubleTapped() },
    { id: "side", page: "/videos", move: "right", done: (api) => api.path() !== "/videos" || api.swiped() },
  ];

  function start() {
    if (running || seen()) return;
    running = true;
    let index = 0;
    let shownAt = 0;
    let taps = [];
    let swipeStart = null;
    let lastTap = 0;
    let doubled = false;
    let swiped = false;
    const hand = h("span", { class: "tour-hand" }, icon("hand"));
    const ring = h("span", { class: "tour-ring" });
    const layer = h("div", { class: "tour", "aria-hidden": "true" }, ring, hand);
    document.body.append(layer);

    const api = {
      path: () => location.pathname,
      scrolled: (px) => window.scrollY > px,
      reelsScrolled: () => { const reels = document.querySelector(".reels"); return !!reels && reels.scrollTop > 120; },
      doubleTapped: () => doubled,
      swiped: () => swiped,
    };
    const finish = () => {
      clearInterval(timer);
      removeEventListener("pointerdown", onDown, true);
      removeEventListener("pointerup", onUp, true);
      layer.remove();
      running = false;
      try { localStorage.setItem(key(), "done"); } catch (error) { /* storage blocked */ }
    };
    function place() {
      const step = STEPS[index];
      layer.dataset.move = step.move;
      layer.dataset.step = step.id;
      const target = step.at ? step.at() : null;
      if (target) {
        const box = target.getBoundingClientRect();
        hand.style.left = `${box.left + box.width / 2}px`;
        hand.style.top = `${box.top + box.height / 2}px`;
        ring.style.left = hand.style.left;
        ring.style.top = hand.style.top;
      } else {
        hand.style.left = "50%";
        hand.style.top = step.move === "double" ? "46%" : "58%";
        ring.style.left = "50%";
        ring.style.top = "46%";
      }
      shownAt = performance.now();
      doubled = false;
      swiped = false;
      layer.hidden = false;
    }
    const next = () => { index += 1; if (index >= STEPS.length) { finish(); return; } place(); };
    function onDown(event) {
      const now = performance.now();
      taps = taps.filter((t) => now - t < 3000);
      taps.push(now);
      if (taps.length >= 6 && now - shownAt > 5000) { finish(); return; }        // six quick taps after five seconds: leave
      if (now - lastTap < 350) doubled = true;
      lastTap = now;
      swipeStart = { x: event.clientX, y: event.clientY };
    }
    function onUp(event) {
      if (swipeStart && Math.abs(event.clientX - swipeStart.x) > 90 && Math.abs(event.clientY - swipeStart.y) < 60) swiped = true;
      swipeStart = null;
    }
    addEventListener("pointerdown", onDown, true);
    addEventListener("pointerup", onUp, true);
    const timer = setInterval(() => {
      const step = STEPS[index];
      if (!step) return;
      if (location.pathname !== step.page && !(step.id === "side")) {
        // the person is on another page than the step needs: wait there (hide the hand) until it is the right one
        layer.hidden = true;
        if (step.id === "videos" && location.pathname === "/videos") next();
        else if (location.pathname === step.page) { layer.hidden = false; place(); }
        return;
      }
      if (layer.hidden) { layer.hidden = false; place(); }
      if (step.done(api)) next();
    }, 300);
    place();
  }

  /* Watch for the moment somebody is signed in and on Home on a phone: then the tour starts (once). */
  setInterval(() => {
    if (running || !Y.me || !narrow() || location.pathname !== "/" || document.querySelector(".dialog-back, .skz-sheet-back")) return;
    start();
  }, 1200);

  Y.tour = { start };
})();
