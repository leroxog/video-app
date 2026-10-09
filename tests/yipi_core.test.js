// Tests for static/js/yipi-core.js: text pieces, counting, German times and counts, addresses, notifications, pictures.
// Run with: node --test tests/yipi_core.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../static/js/yipi-core.js");

const kinds = (text) => core.tokenize(text).map((t) => `${t.type}:${t.type === "url" ? t.href : t.text}`);

// ------------------------------------------------------------------------------------------------ text
test("a plain text is one piece", () => {
  assert.deepEqual(core.tokenize("Hallo Welt"), [{ type: "text", text: "Hallo Welt" }]);
  assert.deepEqual(core.tokenize(""), []);
  assert.deepEqual(core.tokenize(null), []);
});

test("mentions are found only where they stand alone", () => {
  assert.deepEqual(kinds("Hi @mia und @Tom_1!"), ["text:Hi ", "mention:@mia", "text: und ", "mention:@Tom_1", "text:!"]);
  assert.deepEqual(kinds("mail@example.com"), ["text:mail@example.com"]);
  assert.deepEqual(kinds("@ab zu kurz"), ["text:@ab zu kurz"]);
  assert.deepEqual(kinds("@aaaaaaaaaaaaaaaa zu lang"), ["text:@aaaaaaaaaaaaaaaa zu lang"]);
  assert.deepEqual(kinds("@@mia"), ["text:@@mia"]);
  assert.equal(core.tokenize("@mia")[0].handle, "mia");
});

test("hashtags need a letter and two characters, and understand umlauts", () => {
  assert.deepEqual(kinds("#Mathe ist #cool, #2026 nicht, #a auch nicht"), ["hashtag:#Mathe", "text: ist ", "hashtag:#cool", "text:, #2026 nicht, #a auch nicht"]);
  assert.deepEqual(kinds("#Müll und #grün_1"), ["hashtag:#Müll", "text: und ", "hashtag:#grün_1"]);
  assert.deepEqual(kinds("a#b"), ["text:a#b"]);
  assert.deepEqual(kinds("&#39;"), ["text:&#39;"]);
  assert.equal(core.tokenize("#Mathe")[0].tag, "Mathe");
});

test("addresses become links and the punctuation around them stays text", () => {
  assert.deepEqual(kinds("Schau https://example.com/a?b=1#c."), ["text:Schau ", "url:https://example.com/a?b=1#c", "text:."]);
  assert.deepEqual(kinds("(siehe https://example.com/x)"), ["text:(siehe ", "url:https://example.com/x", "text:)"]);
  assert.deepEqual(kinds("https://de.wikipedia.org/wiki/Test_(Begriff) ok"), ["url:https://de.wikipedia.org/wiki/Test_(Begriff)", "text: ok"]);
  assert.deepEqual(kinds("Frage: https://example.com?!"), ["text:Frage: ", "url:https://example.com", "text:?!"]);
  assert.deepEqual(kinds("http://a"), ["text:http://a"]);
  assert.deepEqual(kinds("javascript:alert(1)"), ["text:javascript:alert(1)"]);
  assert.deepEqual(kinds("ftp://example.com/x"), ["text:ftp://example.com/x"]);
});

test("a hashtag or a mention inside an address is part of the address", () => {
  assert.deepEqual(kinds("https://example.com/#top und https://example.com/@mia"), ["url:https://example.com/#top", "text: und ", "url:https://example.com/@mia"]);
});

test("links are shown short and complete", () => {
  const [link] = core.tokenize("https://www.example.com/ein/sehr/langer/pfad/der/nicht/passt?x=1");
  assert.equal(link.type, "url");
  assert.ok(link.text.length <= 30 && link.text.endsWith("…") && link.text.startsWith("example.com/"), link.text);
  assert.equal(link.href, "https://www.example.com/ein/sehr/langer/pfad/der/nicht/passt?x=1");
  assert.equal(core.tokenize("https://example.com")[0].text, "example.com");
});

test("markup in a text stays text", () => {
  const pieces = core.tokenize("<script>alert(1)</script> <img src=x onerror=alert(1)> @mia");
  assert.equal(pieces[0].type, "text");
  assert.ok(pieces[0].text.includes("<script>"));
  assert.deepEqual(pieces.map((p) => p.type), ["text", "mention"]);
});

test("everything cut apart can be put together again", () => {
  for (const text of ["", "a", "Hi @mia, #tag und https://example.com/x). Ende", "@@x #1 #a1 https://a.b https://example.org/(a)(b)))"]) {
    const back = core.tokenize(text).map((t) => (t.type === "url" ? t.href : t.text)).join("");
    assert.equal(back.replace(/https?:\/\//g, ""), text.replace(/https?:\/\//g, ""));
  }
});

// ------------------------------------------------------------------------------------------ counting
test("characters are counted like the server does", () => {
  assert.equal(core.charCount("abc"), 3);
  assert.equal(core.charCount("😀😀"), 2);
  assert.equal(core.charCount("ä"), 1);
  assert.equal(core.charCount("é"), 1);
  assert.equal(core.charCount("  hallo  "), 5);
  assert.equal(core.charCount("a\n\n\n\n\nb"), 4);
  assert.equal(core.charCount("a‮b​c\u0000"), 3);
  assert.equal(core.charCount("👨‍👩‍👧"), 5);
  assert.equal(core.charCount(null), 0);
  assert.equal(core.cleanText("a\r\nb\rc"), "a\nb\nc");
});

test("the counter ring has three states", () => {
  assert.equal(core.counterState("x".repeat(100)), "ok");
  assert.equal(core.counterState("x".repeat(259)), "ok");
  assert.equal(core.counterState("x".repeat(260)), "warn");
  assert.equal(core.counterState("x".repeat(280)), "warn");
  assert.equal(core.counterState("x".repeat(281)), "over");
  assert.equal(core.counterState("😀".repeat(280)), "warn");
});

// ------------------------------------------------------------------------------------- numbers, times
test("counts are written the German way", () => {
  const cases = [[0, "0"], [999, "999"], [1000, "1 Tsd."], [1234, "1,2 Tsd."], [9999, "9,9 Tsd."], [10000, "10 Tsd."], [12345, "12 Tsd."], [999999, "999 Tsd."],
    [1000000, "1 Mio."], [2500000, "2,5 Mio."], [12000000, "12 Mio."], [-5, "0"], [NaN, "0"], [3.9, "3"], ["x", "0"]];
  for (const [n, text] of cases) assert.equal(core.formatCount(n), text, String(n));
});

test("times are short and German", () => {
  const now = new Date(2026, 9, 12, 12, 0, 0).getTime();
  const at = (seconds) => new Date(now - seconds * 1000).toISOString();
  assert.equal(core.relativeTime(at(0), now), "Jetzt");
  assert.equal(core.relativeTime(at(4), now), "Jetzt");
  assert.equal(core.relativeTime(at(30), now), "30 Sek.");
  assert.equal(core.relativeTime(at(60), now), "1 Min.");
  assert.equal(core.relativeTime(at(59 * 60), now), "59 Min.");
  assert.equal(core.relativeTime(at(3600), now), "1 Std.");
  assert.equal(core.relativeTime(at(23 * 3600), now), "23 Std.");
  assert.equal(core.relativeTime(new Date(2026, 9, 10, 8, 0).toISOString(), now), "10. Okt.");
  assert.equal(core.relativeTime(new Date(2025, 2, 3, 8, 0).toISOString(), now), "3. März 2025");
  assert.equal(core.relativeTime(at(-120), now), "Jetzt");
  assert.equal(core.relativeTime("kaputt", now), "");
});

test("the full time and the join date", () => {
  assert.equal(core.fullTime(new Date(2026, 9, 12, 14, 5).toISOString()), "14:05 · 12. Okt. 2026");
  assert.equal(core.fullTime("x"), "");
  assert.equal(core.joinedLabel(new Date(2026, 9, 12).toISOString()), "Beigetreten Oktober 2026");
  assert.equal(core.joinedLabel(new Date(2026, 2, 1).toISOString()), "Beigetreten März 2026");
  assert.equal(core.joinedLabel("x"), "");
});

// ----------------------------------------------------------------------------------------- addresses
test("every address of the page is read and built the same way", () => {
  const cases = [
    ["/yipi-archiv", "", { name: "home" }], ["/", "", { name: "notfound" }], ["/explore", "", { name: "explore" }], ["/notifications", "", { name: "notifications" }], ["/messages", "", { name: "messages" }],
    ["/messages/mia", "", { name: "thread", handle: "mia" }], ["/bookmarks", "", { name: "bookmarks" }], ["/settings", "", { name: "settings", section: "" }],
    ["/settings/account", "", { name: "settings", section: "account" }], ["/moderation", "", { name: "moderation" }], ["/i/login", "", { name: "login" }], ["/i/signup", "", { name: "signup" }],
    ["/search", "?q=hallo%20welt", { name: "search", q: "hallo welt", type: "posts" }], ["/search", "?q=%23tag&type=people", { name: "search", q: "#tag", type: "people" }],
    ["/mia", "", { name: "profile", handle: "mia" }], ["/Mia_1", "", { name: "profile", handle: "Mia_1" }], ["/mia/status/42", "", { name: "post", handle: "mia", id: 42 }],
    ["/mia/followers", "", { name: "followers", handle: "mia" }], ["/mia/following", "", { name: "following", handle: "mia" }],
  ];
  for (const [path, search, route] of cases) {
    assert.deepEqual(core.parsePath(path, search), route, path);
    if (route.name === "notfound") continue;
    const [built, query] = core.buildPath(route).split("?");
    assert.deepEqual(core.parsePath(built, query ? `?${query}` : ""), route, `${path} (built again)`);
  }
  assert.deepEqual(core.parsePath("/explore/"), { name: "explore" });
  for (const path of ["/ab", "/mia/status/x", "/mia/status/1/2", "/mia/other", "/a b", "/mia/followers/x", "/a".repeat(20), "/settings/Konto", "/mía"]) assert.equal(core.parsePath(path).name, "notfound", path);
  assert.equal(core.buildPath({ name: "nonsense" }), "/yipi-archiv");
  assert.equal(core.HOME, "/yipi-archiv");
});

test("handles are checked the way the server checks them", () => {
  for (const ok of ["mia", "Mia_1", "a_b", "x".repeat(15), "123"]) assert.equal(core.isHandle(ok), true, ok);
  for (const bad of ["", "ab", "x".repeat(16), "mia maus", "mía", "@mia", "mia-1", null, 5]) assert.equal(core.isHandle(bad), false, String(bad));
});

// ----------------------------------------------------------------------------------- notifications
test("likes of the same Yip and new followers are put together", () => {
  const actor = (handle) => ({ handle, name: handle });
  const items = [
    { id: 9, kind: "like", actor: actor("a"), post: { id: 1 }, createdAt: "t9", read: false },
    { id: 8, kind: "like", actor: actor("b"), post: { id: 1 }, createdAt: "t8", read: true },
    { id: 7, kind: "like", actor: actor("a"), post: { id: 1 }, createdAt: "t7", read: true },
    { id: 6, kind: "like", actor: actor("c"), post: { id: 2 }, createdAt: "t6", read: true },
    { id: 5, kind: "reply", actor: actor("d"), post: { id: 3 }, createdAt: "t5", read: true },
    { id: 4, kind: "reply", actor: actor("e"), post: { id: 3 }, createdAt: "t4", read: true },
    { id: 3, kind: "follow", actor: actor("f"), createdAt: "t3", read: false },
    { id: 2, kind: "follow", actor: actor("g"), createdAt: "t2", read: false },
    { id: 1, kind: "repost", actor: actor("h"), post: { id: 3 }, createdAt: "t1", read: true },
  ];
  const groups = core.groupNotifications(items);
  assert.deepEqual(groups.map((g) => [g.kind, g.actors.map((a) => a.handle).join(""), g.ids.join(",")]), [
    ["like", "ab", "9,8,7"], ["like", "c", "6"], ["reply", "d", "5"], ["reply", "e", "4"], ["follow", "fg", "3,2"], ["repost", "h", "1"]]);
  assert.equal(groups[0].read, false);
  assert.equal(groups[0].createdAt, "t9");
  assert.deepEqual(core.groupNotifications([]), []);
});

// ----------------------------------------------------------------------------------------- pictures
test("pictures are scaled down, never up", () => {
  assert.deepEqual(core.fitSize(4000, 3000, 1600), { width: 1600, height: 1200 });
  assert.deepEqual(core.fitSize(3000, 4000, 1600), { width: 1200, height: 1600 });
  assert.deepEqual(core.fitSize(800, 600, 1600), { width: 800, height: 600 });
  assert.deepEqual(core.fitSize(1, 5000, 1600), { width: 1, height: 1600 });
});

test("the part cut out of a picture is centered and has the wanted shape", () => {
  assert.deepEqual(core.coverCrop(1000, 500, 100, 100), { x: 250, y: 0, width: 500, height: 500 });
  assert.deepEqual(core.coverCrop(500, 1000, 100, 100), { x: 0, y: 250, width: 500, height: 500 });
  assert.deepEqual(core.coverCrop(1500, 1500, 1500, 500), { x: 0, y: 500, width: 1500, height: 500 });
  assert.deepEqual(core.coverCrop(300, 300, 100, 100), { x: 0, y: 0, width: 300, height: 300 });
});

// ------------------------------------------------------------------------------------------- people
test("somebody without a picture gets the same colour and letters every time", () => {
  assert.equal(core.avatarHue("mia"), core.avatarHue("MIA"));
  assert.ok(core.avatarHue("mia") >= 0 && core.avatarHue("mia") < 360);
  assert.notEqual(core.avatarHue("mia"), core.avatarHue("tom"));
  assert.equal(core.initials("Mia Maus", "mia"), "MM");
  assert.equal(core.initials("mia", "mia"), "M");
  assert.equal(core.initials("", "tom"), "T");
  assert.equal(core.initials("  ", "tom"), "T");
  assert.equal(core.initials("😀 Party", "x"), "😀P");
});
