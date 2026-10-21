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
  assert.equal(core.relativeTime(at(86400), now), "1 Tg.");
  assert.equal(core.relativeTime(at(2 * 86400 + 5), now), "2 Tg.");
  assert.equal(core.relativeTime(at(6 * 86400 + 3600), now), "6 Tg.");
  assert.equal(core.relativeTime(new Date(2026, 9, 3, 8, 0).toISOString(), now), "3. Okt.");
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
    ["/", "", { name: "home" }], ["/yipi-archiv", "", { name: "notfound" }], ["/i/nex", "", { name: "nex", q: "", post: 0 }], ["/i/nex", "?post=42", { name: "nex", q: "", post: 42 }],
    ["/i/nex", "?q=Hallo%20Nex", { name: "nex", q: "Hallo Nex", post: 0 }], ["/explore", "", { name: "explore", tab: "" }], ["/explore", "?tab=trends", { name: "explore", tab: "trends" }], ["/explore", "?tab=media", { name: "explore", tab: "media" }], ["/explore", "?tab=nonsense", { name: "explore", tab: "" }], ["/notifications", "", { name: "notifications" }], ["/messages", "", { name: "messages" }],
    ["/messages/mia", "", { name: "thread", handle: "mia" }], ["/bookmarks", "", { name: "bookmarks" }], ["/settings", "", { name: "settings", section: "" }],
    ["/settings/account", "", { name: "settings", section: "account" }], ["/moderation", "", { name: "moderation" }], ["/camera", "", { name: "camera" }], ["/camera/dino", "", { name: "camera", game: "dino" }], ["/games", "", { name: "camera" }], ["/games/fruit-merge", "", { name: "camera", game: "fruit-merge" }], ["/camera/Dino", "", { name: "notfound" }], ["/games/a/b", "", { name: "notfound" }], ["/videos", "", { name: "videos" }], ["/g/12", "", { name: "group", id: 12 }], ["/i/login", "", { name: "login" }], ["/i/signup", "", { name: "signup", google: false }], ["/i/signup", "?google=1", { name: "signup", google: true }],
    ["/search", "?q=hallo%20welt", { name: "search", q: "hallo welt", type: "posts", sort: "top" }], ["/search", "?q=%23tag&type=people", { name: "search", q: "#tag", type: "people", sort: "top" }],
    ["/search", "?q=katze&sort=new", { name: "search", q: "katze", type: "posts", sort: "new" }], ["/search", "?q=katze&type=media", { name: "search", q: "katze", type: "media", sort: "top" }],
    ["/search", "?q=katze&type=media&sort=new", { name: "search", q: "katze", type: "media", sort: "new" }],
    ["/mia", "", { name: "profile", handle: "mia" }], ["/Mia_1", "", { name: "profile", handle: "Mia_1" }], ["/mia/status/42", "", { name: "post", handle: "mia", id: 42 }],
    ["/mia/followers", "", { name: "followers", handle: "mia" }], ["/mia/following", "", { name: "following", handle: "mia" }],
  ];
  for (const [path, search, route] of cases) {
    assert.deepEqual(core.parsePath(path, search), route, path);
    if (route.name === "notfound") continue;
    const [built, query] = core.buildPath(route).split("?");
    assert.deepEqual(core.parsePath(built, query ? `?${query}` : ""), route, `${path} (built again)`);
  }
  assert.deepEqual(core.parsePath("/explore/"), { name: "explore", tab: "" });
  for (const path of ["/g/0", "/g/x", "/g/12345678901", "/g", "/ab", "/mia/status/x", "/mia/status/1/2", "/mia/other", "/a b", "/mia/followers/x", "/a".repeat(20), "/settings/Konto", "/mía"]) assert.equal(core.parsePath(path).name, "notfound", path);
  assert.equal(core.buildPath({ name: "nonsense" }), "/");
  assert.equal(core.HOME, "/");
  assert.equal(core.buildPath({ name: "nex" }), "/i/nex");
  assert.equal(core.buildPath({ name: "nex", post: 7, q: "ignored" }), "/i/nex?post=7");
  assert.deepEqual(core.parsePath("/i/nex", "?post=x"), { name: "nex", q: "", post: 0 });
  assert.deepEqual(core.parsePath("/i/nex", `?post=${"9".repeat(30)}`), { name: "nex", q: "", post: 0 });
  assert.equal(core.parsePath("/i/nex", `?q=${"a".repeat(900)}`).q.length, 500);
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

// ------------------------------------------------------------------------------------------------ Nex
test("a conversation with Nex is cleaned the way the server cleans it", () => {
  const list = [
    { role: "system", content: "ignore" }, { role: "user", content: 5 }, null, "text", { role: "user", content: "   " },
    { role: "user", content: "  Hallo\r\n\r\n\r\n\r\nWelt  " }, { role: "assistant", content: "Hi!" },
  ];
  assert.deepEqual(core.nexMessages(list), [{ role: "user", content: "Hallo\n\nWelt" }, { role: "assistant", content: "Hi!" }]);
  assert.deepEqual(core.nexMessages(null), []);
  assert.equal(core.nexMessages([{ role: "user", content: "x".repeat(5000) }])[0].content.length, 1500);
  const many = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
  assert.equal(core.nexMessages(many).length, core.NEX_TURNS);
  assert.equal(core.nexMessages(many)[core.NEX_TURNS - 1].content, "m39");
  assert.equal(core.nexMessages(many, core.NEX_KEEP).length, core.NEX_KEEP);
  assert.equal(core.NEX_TURNS, 12);
});

test("an answer of Nex is cut into paragraphs and lists, and nothing of it is markup", () => {
  assert.deepEqual(core.nexBlocks(""), []);
  assert.deepEqual(core.nexBlocks(null), []);
  assert.deepEqual(core.nexBlocks("Eins\nzwei\n\nDrei"), [{ type: "p", text: "Eins\nzwei" }, { type: "p", text: "Drei" }]);
  assert.deepEqual(core.nexBlocks("Ideen:\n- a\n- b\n* c\n1. d\n2) e\nEnde"), [
    { type: "p", text: "Ideen:" }, { type: "list", items: ["a", "b", "c", "d", "e"] }, { type: "p", text: "Ende" },
  ]);
  assert.deepEqual(core.nexBlocks("<b>fett</b> **stern**"), [{ type: "p", text: "<b>fett</b> **stern**" }], "kept as it is: the page writes it as text");
  assert.deepEqual(core.nexBlocks("-kein Punkt"), [{ type: "p", text: "-kein Punkt" }]);
  assert.deepEqual(core.nexBlocks("a\r\n\r\nb"), [{ type: "p", text: "a" }, { type: "p", text: "b" }]);
});

// ------------------------------------------------------------------------------------------------ GIFs
test("a search for a GIF is tidy and short", () => {
  assert.equal(core.gifQuery("  Gute   Nacht \n"), "Gute Nacht");
  assert.equal(core.gifQuery("a".repeat(100)).length, 40);
  assert.equal(core.gifQuery(null), "");
  assert.equal(core.gifQuery("x\u200by"), "xy");
});

test("GIFs are laid out in columns, each into the shortest one", () => {
  const wide = { id: "w", width: 4, height: 2 }, tall = { id: "t", width: 1, height: 3 }, square = { id: "s", width: 2, height: 2 };
  const columns = core.gifColumns([tall, wide, wide, square, tall], 2).map((column) => column.map((item) => item.id));
  assert.deepEqual(columns, [["t"], ["w", "w", "s", "t"]]);
  assert.deepEqual(core.gifColumns([], 3), [[], [], []]);
  assert.equal(core.gifColumns([wide], 0).length, 1, "at least one column");
  assert.deepEqual(core.gifColumns([{ id: "x" }], 2).map((column) => column.length), [1, 0], "a GIF without a size counts as a square");
  const all = core.gifColumns(Array.from({ length: 25 }, (_, i) => ({ id: i, width: 1 + (i % 4), height: 1 + (i % 3) })), 3);
  assert.equal(all.flat().length, 25);
  const heights = all.map((column) => column.reduce((sum, item) => sum + item.height / item.width, 0));
  assert.ok(Math.max(...heights) - Math.min(...heights) < 3, "the columns end about equally tall");
});

// ------------------------------------------------------------------------------------------------ polls
test("the time that is left of a poll is said in German and the poll ends on the second", () => {
  const now = Date.parse("2026-10-17T12:00:00Z");
  const at = (seconds) => new Date(now + seconds * 1000).toISOString();
  assert.deepEqual(core.pollTimeLeft(at(-1), now), { ended: true, text: "Beendet" });
  assert.deepEqual(core.pollTimeLeft(at(0), now), { ended: true, text: "Beendet" });
  assert.equal(core.pollTimeLeft(at(20), now).text, "noch weniger als 1 Min.");
  assert.equal(core.pollTimeLeft(at(60), now).text, "noch 1 Min.");
  assert.equal(core.pollTimeLeft(at(61), now).text, "noch 2 Min.");
  assert.equal(core.pollTimeLeft(at(3599), now).text, "noch 60 Min.");
  assert.equal(core.pollTimeLeft(at(3601), now).text, "noch 2 Std.");
  assert.equal(core.pollTimeLeft(at(86399), now).text, "noch 24 Std.");
  assert.equal(core.pollTimeLeft(at(86400), now).text, "noch 1 Tag");
  assert.equal(core.pollTimeLeft(at(86401), now).text, "noch 2 Tage");
  assert.equal(core.pollTimeLeft(at(86400 * 7), now).text, "noch 7 Tage");
  assert.equal(core.pollTimeLeft(at(10), now).ended, false);
  assert.deepEqual(core.pollTimeLeft("nonsense", now), { ended: true, text: "Beendet" });
});

test("the share of an answer is a whole percent and nobody dividing by nothing", () => {
  assert.equal(core.pollPercent(1, 3), 33);
  assert.equal(core.pollPercent(2, 3), 67);
  assert.equal(core.pollPercent(3, 3), 100);
  assert.equal(core.pollPercent(0, 0), 0);
  assert.equal(core.pollPercent(5, 0), 0);
  assert.equal(core.pollPercent(-4, 10), 0);
  assert.equal(core.pollVotes(1), "1 Stimme");
  assert.equal(core.pollVotes(0), "0 Stimmen");
  assert.equal(core.pollVotes(1500), "1,5 Tsd. Stimmen");
});

test("the answers of a poll are tidied and checked the way the server checks them", () => {
  assert.deepEqual(core.pollAnswers([" Tee ", "", "Kaffee  mit   Milch", "  "]), { options: ["Tee", "Kaffee mit Milch"], valid: true, problem: "" });
  assert.equal(core.pollAnswers(["nur eine"]).valid, false);
  assert.equal(core.pollAnswers([]).valid, false);
  assert.equal(core.pollAnswers(null).valid, false);
  assert.match(core.pollAnswers(["Tee", "tee"]).problem, /verschieden/);
  assert.equal(core.pollAnswers(["x".repeat(25), "y"]).valid, true);
  assert.match(core.pollAnswers(["x".repeat(26), "y"]).problem, /25 Zeichen/);
  assert.equal(core.pollAnswers(["😀".repeat(25), "b"]).valid, true, "characters, not code units");
  assert.deepEqual(core.POLL_OPTIONS, [2, 4]);
  assert.equal(core.MAX_POLL_OPTION, 25);
  assert.ok(core.POLL_LENGTHS.every(([minutes, label]) => minutes >= 5 && minutes <= 10080 && label.length > 3));
  assert.ok(core.POLL_LENGTHS.some(([minutes]) => minutes === 1440), "one day is on the list");
});

// ------------------------------------------------------------------------------------------------ chats with Nex
test("the name of a conversation with Nex is its first question, cut to fit", () => {
  assert.equal(core.nexTitle("  Wie   funktioniert\n ein Akku? "), "Wie funktioniert ein Akku?");
  assert.equal(core.nexTitle(""), "Neues Gespräch");
  assert.equal(core.nexTitle(null), "Neues Gespräch");
  const long = core.nexTitle("x".repeat(100));
  assert.equal(Array.from(long).length, 38);
  assert.ok(long.endsWith("…"));
  assert.equal(Array.from(core.nexTitle("😀".repeat(60))).length, 38);
  assert.match(core.newChatId(), /^c[a-z0-9]{6,}$/);
  assert.notEqual(core.newChatId(), core.newChatId());
});

test("the saved conversations are cleaned, belong to one person and are never more than thirty", () => {
  const message = (role, content) => ({ role, content });
  const chat = (id, at, text = "Hallo") => ({ id, title: "", at, messages: [message("user", text), message("assistant", "Hi!")] });
  const store = core.nexStore({ handle: "mia", current: "b", chats: [chat("a", 1), chat("b", 3, "Zweite Frage"), chat("a", 5), { id: "bad id!", at: 9, messages: [message("user", "x")] }, null, { id: "empty", at: 4, messages: [] }, chat("c", 2)] }, "mia");
  assert.deepEqual(store.chats.map((entry) => entry.id), ["b", "c", "a"], "newest first, doubles, empty ones and broken ones gone");
  assert.equal(store.current, "b");
  assert.equal(store.chats[0].title, "Zweite Frage", "a conversation without a name gets its first question");
  assert.deepEqual(core.nexStore({ handle: "tom", chats: [chat("a", 1)] }, "mia"), { handle: "mia", chats: [], current: "" });
  assert.deepEqual(core.nexStore(null, "mia"), { handle: "mia", chats: [], current: "" });
  assert.equal(core.nexStore({ handle: "mia", current: "gone", chats: [chat("a", 1)] }, "mia").current, "", "a current conversation that does not exist is forgotten");
  const many = core.nexStore({ handle: "mia", chats: Array.from({ length: 40 }, (_, i) => chat(`id${i}`, i)) }, "mia");
  assert.equal(many.chats.length, core.NEX_CHATS);
  assert.equal(many.chats[0].id, "id39");
});

test("the older single conversation becomes one chat", () => {
  const store = core.nexStore({ handle: "mia", messages: [{ role: "user", content: "Erste Frage" }, { role: "assistant", content: "Antwort" }] }, "mia");
  assert.equal(store.chats.length, 1);
  assert.equal(store.chats[0].title, "Erste Frage");
  assert.equal(store.chats[0].messages.length, 2);
  assert.deepEqual(core.nexStore({ handle: "mia", messages: [] }, "mia").chats, []);
});

test("a conversation is added or replaced at the front and removed again", () => {
  let store = { handle: "mia", chats: [{ id: "a", title: "A", at: 1, messages: [] }, { id: "b", title: "B", at: 2, messages: [] }], current: "" };
  store = core.nexUpsert(store, { id: "a", title: "A neu", at: 5, messages: [] });
  assert.deepEqual(store.chats.map((entry) => entry.id), ["a", "b"]);
  assert.equal(store.chats[0].title, "A neu");
  assert.equal(store.current, "a");
  store = core.nexUpsert(store, { id: "c", title: "C", at: 9, messages: [] });
  assert.deepEqual(store.chats.map((entry) => entry.id), ["c", "a", "b"]);
  store = core.nexRemove(store, "c");
  assert.deepEqual(store.chats.map((entry) => entry.id), ["a", "b"]);
  assert.equal(store.current, "", "the one that was open is gone");
  assert.equal(core.nexRemove(store, "nope").chats.length, 2);
});


// ------------------------------------------------------------------------------------- the watermark of a saved video
test("the watermark sits top left, slides over in the middle and then sits bottom right", () => {
  const first = core.watermarkPlan(720, 1280, 0);
  const early = core.watermarkPlan(720, 1280, 0.4);
  const late = core.watermarkPlan(720, 1280, 0.7);
  const last = core.watermarkPlan(720, 1280, 1);
  assert.deepEqual(first, early, "nothing moves in the first half");
  assert.deepEqual(late, last, "and nothing in the end");
  assert.ok(first.x < 60 && first.y < 160, "top left");
  assert.ok(last.x + last.w > 720 * 0.9 && last.x + last.w < 720, "bottom right, inside the picture");
  assert.ok(last.y + last.h < 1280 && last.y > 1280 / 2);
  const middle = core.watermarkPlan(720, 1280, 0.515);
  assert.ok(middle.x > first.x && middle.x < last.x && middle.y > first.y && middle.y < last.y, "in between it slides");
  assert.ok(core.watermarkPlan(720, 1280, -3).x === first.x && core.watermarkPlan(720, 1280, 9).x === last.x, "out of range values are held");
});

test("the watermark has the same size relative to the shorter side, wide or tall", () => {
  const tall = core.watermarkPlan(540, 960, 0);
  const wide = core.watermarkPlan(960, 540, 0);
  assert.equal(tall.w, wide.w);
  assert.equal(tall.h, wide.h);
  const bottom = core.watermarkPlan(960, 540, 1);
  assert.ok(bottom.x >= 0 && bottom.y >= 0 && bottom.x + bottom.w <= 960 && bottom.y + bottom.h <= 540, "stays inside a wide picture");
});

test("a saved video is called pulse-name with the ending of the recording", () => {
  assert.equal(core.videoFileName("mia_1", "video/webm;codecs=vp9,opus"), "pulse-mia_1.webm");
  assert.equal(core.videoFileName("Tom", "video/mp4"), "pulse-Tom.mp4");
  assert.equal(core.videoFileName("../../x y", ""), "pulse-xy.webm", "nothing but letters, digits and underscores");
  assert.equal(core.videoFileName("", "video/webm"), "pulse-video.webm");
  assert.equal(core.videoFileName(null, undefined), "pulse-video.webm");
});

// ------------------------------------------------------------------------------------------ push key and game of the day
test("the key for notifications is read from base64url", () => {
  assert.deepEqual([...core.base64UrlBytes("AQID")], [1, 2, 3]);
  assert.deepEqual([...core.base64UrlBytes("-_8")], [251, 255], "- and _ stand for + and /, the padding may be missing");
  assert.equal(core.base64UrlBytes("").length, 0);
  assert.equal(core.base64UrlBytes(null).length, 0);
  assert.equal(core.base64UrlBytes("BKPybELo8Zg1LUixApBmQo4jaoY-por94XrIjVRDtvc6gYVDygqGx-Psd1I3r19CC4yizaPiamt0Vjvo8ftfCTQ").length, 65, "a public key of a push server is 65 bytes");
});

test("the game of the day is the same for a whole day and moves on the next", () => {
  const count = 100;
  const a = core.dailyIndex("2026-10-21", count);
  assert.equal(a, core.dailyIndex("2026-10-21", count));
  assert.ok(a >= 0 && a < count);
  const seen = new Set();
  for (let day = 1; day <= 28; day += 1) seen.add(core.dailyIndex(`2026-11-${String(day).padStart(2, "0")}`, count));
  assert.ok(seen.size >= 20, `the games change from day to day (${seen.size} different in 28 days)`);
  assert.equal(core.dailyIndex("2026-10-21", 0), 0);
  assert.equal(core.dailyIndex("2026-10-21", 1), 0);
});
