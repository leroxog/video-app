/* NSTL core: the functions of the agent page that do not touch the page or the network -- building the Wikipedia search address,
   turning its answer into candidates, scoring what makes a candidate a good answer to the question (the numbers the swarm argues
   about), and picking a grid size for a wanted number of agents.  They run in the browser and in Node (tests/nstl_core.test.js). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NstlCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LANGUAGES = ["de", "en"];
  const PER_LANGUAGE = 5;
  const MAX_CANDIDATES = 8;

  /* The address that asks a language's Wikipedia for pages matching `query` (its own search and relevance order, not ours).
     `origin=*` is Wikipedia's own way of allowing a page on another site to read the answer (no key, no login, nothing of ours is sent
     besides the question itself and the usual request headers of a fetch). */
  function searchUrl(lang, query) {
    const params = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", origin: "*",
      generator: "search", gsrsearch: query, gsrlimit: String(PER_LANGUAGE), gsrnamespace: "0",
      prop: "extracts|info", exintro: "1", explaintext: "1", exsentences: "6", inprop: "url",
    });
    return `https://${lang}.wikipedia.org/w/api.php?${params.toString()}`;
  }

  /* The pages of one answer from the Wikipedia API (formatversion=2: `query.pages`, already in its own search order), as
     {lang, title, url, extract, rank (0 = the search's own top hit)}.  A page without a usable extract (a disambiguation stub, for
     example) is left out. */
  function pagesOf(lang, json) {
    const pages = (json && json.query && json.query.pages) || [];
    const out = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const extract = (p.extract || "").trim();
      if (extract.length < 40) continue;
      out.push({ lang, title: p.title || "", url: p.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent((p.title || "").replace(/ /g, "_"))}`, extract, rank: i });
    }
    return out;
  }

  /* The words of `query` worth matching on (lower-case, at least 4 letters: short words like "der", "wie" or "ein" match everywhere
     and say nothing about which candidate is the better one). */
  function keywords(query) {
    return Array.from(new Set((String(query).toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || [])));
  }

  /* How well `text` covers `words`: the share of them it contains (0 when there are none to look for). */
  function coverage(text, words) {
    if (!words.length) return 0;
    const low = text.toLowerCase();
    let hit = 0;
    for (const w of words) if (low.includes(w)) hit++;
    return hit / words.length;
  }

  /* A triangular 0..1 score that peaks at `peak` and reaches 0 at `peak - left` and `peak + right`: neither a one-line stub nor a wall
     of text makes the clearer answer, so a middling length scores best. */
  function sweetSpot(value, peak, left, right) {
    if (value <= peak) return Math.max(0, 1 - (peak - value) / left);
    return Math.max(0, 1 - (value - peak) / right);
  }

  /* The candidates for `query`: Wikipedia pages (already fetched by the caller, `pages`: an array of raw API JSON per language, see
     searchUrl) turned into up to MAX_CANDIDATES {title, url, lang, extract} with a `features` vector (each 0..1) the swarm's agents
     weigh differently:
       0 keyword coverage (does the extract mention what was asked),
       1 title match (does the title itself mention it: the strongest sign of a good answer),
       2 Wikipedia's own search rank (its relevance order, not invented by us),
       3 how densely the extract uses the asked-for words (not just once in passing),
       4 a sweet-spot length (long enough to say something, short enough to read).
     Candidates from several languages compete side by side; a query matching nothing anywhere returns []. */
  function candidatesFor(query, rawByLanguage) {
    const words = keywords(query);
    let all = [];
    for (const lang of Object.keys(rawByLanguage)) all = all.concat(pagesOf(lang, rawByLanguage[lang]));
    all.sort((a, b) => a.rank - b.rank);
    const seen = new Set();
    const picked = [];
    for (const page of all) {
      const key = page.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(page);
      if (picked.length >= MAX_CANDIDATES) break;
    }
    const maxRank = Math.max(1, ...picked.map((p) => p.rank));
    return picked.map((page) => {
      const titleCoverage = coverage(page.title, words);
      const bodyCoverage = coverage(page.extract, words);
      const bodyWords = (page.extract.match(/[\p{L}\p{N}]+/gu) || []).length || 1;
      const hits = words.reduce((sum, w) => sum + (page.extract.toLowerCase().split(w).length - 1), 0);
      const density = Math.min(1, hits / Math.sqrt(bodyWords));
      const length = sweetSpot(page.extract.length, 420, 380, 900);
      return {
        title: page.title, url: page.url, lang: page.lang, extract: page.extract,
        features: [bodyCoverage, titleCoverage, 1 - page.rank / (maxRank + 1), density, length],
      };
    });
  }

  /* A grid close to `target` agents, wide enough that the map reads well (roughly 8 : 5) and exact in its area (width * height). */
  function gridFor(target) {
    const height = Math.max(1, Math.round(Math.sqrt((target * 5) / 8)));
    const width = Math.max(1, Math.round(target / height));
    return { width, height, agents: width * height };
  }

  const COUNT_FORMAT = (() => { try { return new Intl.NumberFormat("de-DE"); } catch (e) { return null; } })();
  function formatCount(n) {
    return COUNT_FORMAT ? COUNT_FORMAT.format(Math.round(n)) : String(Math.round(n));
  }
  function formatPercent(fraction) {
    return `${(fraction * 100).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  }

  return { LANGUAGES, MAX_CANDIDATES, searchUrl, pagesOf, keywords, coverage, sweetSpot, candidatesFor, gridFor, formatCount, formatPercent };
});
