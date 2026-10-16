/* NSTL swarm core: a swarm of simple agents that agree on a language and, with it, on an answer.  No page, no network: only numbers, so that it
   runs in a worker, in the page and in Node (that is how it is tested, tests/nstl_swarm.test.js).

   The agents sit on a grid (a torus) and are small programs, not language models.  Each one has
     - a taste (which of the candidate answers it likes best: it weighs the properties of the candidates differently),
     - an opinion (the candidate it favours now), and
     - a word for every candidate (the language: a word is one or two syllables; at the start every agent has its own random words).
   In a round every agent speaks once to a partner: mostly a neighbour nearby, now and then someone picked from the whole swarm (a
   "long-distance call"), which lets a word spread across the whole grid in a few rounds instead of having to cross it step by step.
     - If the partner has the same word for it, they understand each other: the partner may take over the opinion (when its own taste
       does not object too much).  Opinions spread only through a language that is shared.
     - If not, the partner usually adopts the word it just heard (a short word more readily than a long one): each agent keeps a small
       confidence counter per word, so a word it has heard several times already resists being overwritten by one that is no better.
     - Now and then an agent tries a shorter word for a concept.
   So words that are short and shared win, and the opinion that many tastes can live with wins.  Nothing in it is faked: the numbers that
   the page shows (understanding, word length, dialects, opinions) are counted in the simulation, not scripted. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NstlSwarm = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The syllables of the language of the swarm.  A word is one syllable (ids 0..11) or two (ids 12..155).
  const SYLLABLES = ["ka", "zu", "ri", "mo", "te", "lu", "xa", "vi", "no", "pe", "sa", "dy"];
  const SINGLE = SYLLABLES.length;
  const WORDS = SINGLE + SINGLE * SINGLE;
  const MAX_CONFIDENCE = 15;

  function wordText(id) {
    if (id < SINGLE) return SYLLABLES[id];
    const k = id - SINGLE;
    return SYLLABLES[Math.floor(k / SINGLE)] + SYLLABLES[k % SINGLE];
  }
  const wordLength = (id) => (id < SINGLE ? 1 : 2);

  /* A tiny seeded random generator (xorshift32), so that a run can be repeated. */
  function seeded(seed) {
    let x = (seed >>> 0) || 0x9e3779b9;
    return function next() { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
  }

  /* Weights of the tastes: `types` kinds of agents, each weighing the `features` properties of an answer differently.  From them and the
     properties of the candidates (features[candidate][feature], each 0..1) the score of every candidate for every kind of agent. */
  function tasteScores(features, types, seed) {
    const next = seeded(seed ^ 0x51ed270b);
    const candidates = features.length, count = features[0].length;
    const scores = new Float32Array(types * candidates);
    for (let t = 0; t < types; t++) {
      const weights = [];
      let sum = 0;
      for (let f = 0; f < count; f++) { const w = (next() % 1000) / 1000 + 0.05; weights.push(w * w); sum += w * w; }   // a few properties weigh a lot for one kind of agent
      for (let c = 0; c < candidates; c++) {
        let score = 0;
        for (let f = 0; f < count; f++) score += (weights[f] / sum) * features[c][f];
        scores[t * candidates + c] = score;
      }
    }
    return scores;
  }

  /* A new swarm of width * height agents that talk about `features.length` candidates.  `radius`: how far a nearby partner may be;
     `longDistance`: the share of talks (out of 256) that go to a random agent anywhere on the grid instead of a nearby one. */
  function create({ width, height, features, types = 256, radius = 48, longDistance = 64, seed = 1 }) {
    const n = width * height, K = features.length;
    if (K < 2 || K > 8) throw new Error("two to eight candidates");
    const next = seeded(seed);
    const scores = tasteScores(features, types, seed);
    const taste = new Uint8Array(n);
    const opinion = new Uint8Array(n);
    const words = new Uint8Array(n * K);
    const confidence = new Uint8Array(n * K).fill(1);
    for (let i = 0; i < n; i++) {
      const t = next() % types;
      taste[i] = t;
      let best = 0, top = -1;
      for (let c = 0; c < K; c++) { const s = scores[t * K + c]; if (s > top) { top = s; best = c; } }
      opinion[i] = best;
      for (let c = 0; c < K; c++) words[i * K + c] = SINGLE + (next() % (WORDS - SINGLE));
    }
    return { width, height, n, K, types, radius, longDistance, taste, opinion, words, confidence, scores, next, round: 0, features, last: null };
  }

  /* One round: every agent speaks once.  Returns what was counted, and an `events` list of a sample of the talks (for the chat window). */
  function step(swarm, { keep = 0, tolerance = 0.04 + 0.004 * swarm.round } = {}) {
    const { width, height, n, K, radius, longDistance, taste, opinion, words, confidence, scores } = swarm;
    let next = swarm.next;
    const span = 2 * radius + 1;
    let talks = 0, understood = 0, switched = 0, learned = 0, shortened = 0;
    const events = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const c = opinion[i];
        const s = words[i * K + c];
        const r = next();
        const r2 = next();
        let j;
        if ((r2 & 255) < longDistance) {
          j = next() % n;
        } else {
          let jx = x + (r % span) - radius;
          let jy = y + (((r >>> 11) % span) - radius);
          if (jx < 0) jx += width; else if (jx >= width) jx -= width;
          if (jy < 0) jy += height; else if (jy >= height) jy -= height;
          j = jy * width + jx;
        }
        if (j === i) continue;
        const h = words[j * K + c];
        talks++;
        const r3 = next();
        let ok = false, took = false;
        const a = i * K + c, b = j * K + c;
        if (h === s) {                                                            // understood: both are a little surer of this word now
          ok = true;
          understood++;
          if (confidence[a] < MAX_CONFIDENCE) confidence[a]++;
          if (confidence[b] < MAX_CONFIDENCE) confidence[b]++;
          const own = opinion[j];
          if (own !== c) {                                                        // the partner may take over the opinion
            const base = taste[j] * K;
            if (scores[base + c] + tolerance >= scores[base + own] && ((r3 >>> 8) & 255) < 140) { opinion[j] = c; switched++; took = true; }
          }
        } else {                                                                  // not understood: the shorter word is the easier one to settle on
          const bonus = (wordLength(s) === 1 ? 1 : 0) - (wordLength(h) === 1 ? 1 : 0);
          if (confidence[b] - bonus <= 1) { words[b] = s; confidence[b] = 1; learned++; } else confidence[b]--;
        }
        if (((r3 >>> 16) & 1023) === 0 && wordLength(s) === 2) {                  // now and then an agent tries a shorter word
          words[a] = next() % SINGLE;
          confidence[a] = 1;
          shortened++;
        }
        if (keep && events.length < keep && ((r3 >>> 26) & 31) === 0) events.push({ from: i, to: j, concept: c, word: s, heard: h, ok, took });
      }
    }
    swarm.next = next;
    swarm.round++;
    swarm.last = { talks, understood, switched, learned, shortened };
    return { talks, understood, switched, learned, shortened, events };
  }

  /* What the swarm looks like now: how many agents favour each candidate, the word that most agents use for each candidate, how many different
     words are in use for the favourite one (the dialects), the mean length of the words, and how well they understand each other.  Looks at
     `sample` agents spread over the grid (all of them when there are fewer). */
  function measure(swarm, sample = 200000) {
    const { n, K, opinion, words } = swarm;
    const stride = Math.max(1, Math.floor(n / sample));
    const shares = new Array(K).fill(0);
    const counts = [];
    for (let c = 0; c < K; c++) counts.push(new Uint32Array(WORDS));
    let seen = 0, length = 0, lengthCount = 0;
    for (let i = 0; i < n; i += stride) {
      seen++;
      shares[opinion[i]]++;
      for (let c = 0; c < K; c++) { const w = words[i * K + c]; counts[c][w]++; }
    }
    const lexicon = [];
    const dialects = [];
    for (let c = 0; c < K; c++) {
      let best = 0;
      let used = 0;
      for (let w = 0; w < WORDS; w++) { if (counts[c][w] > counts[c][best]) best = w; if (counts[c][w] > seen * 0.005) used++; }
      lexicon.push({ word: best, text: wordText(best), share: counts[c][best] / seen });
      dialects.push(used);
      length += wordLength(best) * shares[c];
      lengthCount += shares[c];
    }
    let top = 0;
    for (let c = 1; c < K; c++) if (shares[c] > shares[top]) top = c;
    const talks = swarm.last ? swarm.last.talks : 0;
    return {
      round: swarm.round, agents: n, shares: shares.map((v) => v / seen), top, lexicon, dialects: dialects[top],
      length: lengthCount ? length / lengthCount : 2, understanding: swarm.last && talks ? swarm.last.understood / talks : 0,
    };
  }

  /* Has the swarm agreed?  On an answer (nine of ten favour it) and on a language (nine of ten talks are understood). */
  function agreed(m, { opinion = 0.9, language = 0.9 } = {}) {
    return m.shares[m.top] >= opinion && m.understanding >= language;
  }

  /* The colours of the map: by the word that an agent uses for the candidate it favours (the dialect), or by the candidate itself. */
  function paint(swarm, image, columns, rows, mode) {
    const { width, height, K, opinion, words } = swarm;
    const data = image.data;
    for (let py = 0; py < rows; py++) {
      const y = Math.min(height - 1, Math.floor(((py + 0.5) * height) / rows));
      for (let px = 0; px < columns; px++) {
        const x = Math.min(width - 1, Math.floor(((px + 0.5) * width) / columns));
        const i = y * width + x;
        const c = opinion[i];
        let hue, light;
        if (mode === "opinion") { hue = (c * 360) / K + 8; light = 52; }
        else { const w = words[i * K + c]; hue = (w * 137.5) % 360; light = wordLength(w) === 1 ? 62 : 40; }
        const [r, g, b] = hsl(hue, 0.72, light / 100);
        const o = (py * columns + px) * 4;
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      }
    }
  }
  function hsl(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
    return [f(0), f(8), f(4)];
  }

  return { SYLLABLES, SINGLE, WORDS, wordText, wordLength, seeded, tasteScores, create, step, measure, agreed, paint };
});
