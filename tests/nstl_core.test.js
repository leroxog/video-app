const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../static/js/nstl-core.js");

test("the Wikipedia address asks only for what is needed, with origin=* so the browser may read it", () => {
  const url = C.searchUrl("de", "Kühlschrank");
  assert.match(url, /^https:\/\/de\.wikipedia\.org\/w\/api\.php\?/);
  assert.match(url, /generator=search/);
  assert.match(url, /gsrsearch=K%C3%BChlschrank/);
  assert.match(url, /origin=\*/);
  assert.match(url, /explaintext=1/);
});

test("keywords ignores short filler words and is case-insensitive", () => {
  assert.deepEqual(C.keywords("Wie funktioniert ein Kühlschrank?"), ["funktioniert", "kühlschrank"]);
  assert.deepEqual(C.keywords("wie, WAS, IST das"), []);
});

test("pagesOf keeps Wikipedia's own search order and drops pages without a real extract", () => {
  const json = { query: { pages: [
    { title: "Kühlschrank", extract: "Ein Kühlschrank ist ein Gerät zur Kühlung von Lebensmitteln auf eine Temperatur unter der Umgebungstemperatur.", fullurl: "https://de.wikipedia.org/wiki/K%C3%BChlschrank" },
    { title: "K (Begriffsklärung)", extract: "K." },
    { title: "Kühlkette", extract: "Die Kühlkette beschreibt die ununterbrochene Kühlung verderblicher Waren vom Erzeuger bis zum Verbraucher." },
  ] } };
  const pages = C.pagesOf("de", json);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].title, "Kühlschrank");
  assert.equal(pages[0].rank, 0);
  assert.equal(pages[1].rank, 2, "the dropped page keeps its place in Wikipedia's own order");
});

test("candidatesFor turns two languages of raw results into scored, de-duplicated candidates", () => {
  const de = { query: { pages: [
    { title: "Kühlschrank", extract: "Ein Kühlschrank kühlt Lebensmittel. ".repeat(10), fullurl: "https://de.wikipedia.org/wiki/K%C3%BChlschrank" },
    { title: "Gefrierschrank", extract: "Ein Gefrierschrank friert Lebensmittel ein. ".repeat(10) },
  ] } };
  const en = { query: { pages: [
    { title: "Refrigerator", extract: "A refrigerator is a kitchen appliance. ".repeat(10) },
    { title: "Kühlschrank", extract: "Duplicate of the German page, same title." },   // same title as a German hit: must not appear twice
  ] } };
  const candidates = C.candidatesFor("Kühlschrank", { de, en });
  assert.equal(candidates.length, 3, "the duplicate title was dropped");
  assert.equal(candidates[0].title, "Kühlschrank", "Wikipedia's own top hit leads");
  for (const c of candidates) {
    assert.equal(c.features.length, 5);
    for (const f of c.features) assert.ok(f >= 0 && f <= 1, `feature out of range: ${f}`);
  }
  const kuehl = candidates.find((c) => c.title === "Kühlschrank");
  const gefrier = candidates.find((c) => c.title === "Gefrierschrank");
  assert.ok(kuehl.features[1] > gefrier.features[1], "the title that actually names the question scores higher on title match");
});

test("candidatesFor returns nothing for results with no usable extract", () => {
  assert.deepEqual(C.candidatesFor("?", { de: {}, en: {} }), []);
});

test("gridFor is exact in area and close to the target", () => {
  const g = C.gridFor(10000000);
  assert.equal(g.width * g.height, g.agents);
  assert.ok(Math.abs(g.agents - 10000000) / 10000000 < 0.001);
  assert.ok(g.width > g.height, "wider than tall, so the map reads well");
});

test("numbers are said the German way", () => {
  assert.equal(C.formatCount(1234567), "1.234.567");
  assert.equal(C.formatPercent(0.9034), "90,3 %");
});
