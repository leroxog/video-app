const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../static/js/treff-core.js");

const types = (text) => T.parseMessage(text).map((p) => p.type);
const find = (text, type) => T.parseMessage(text).filter((p) => p.type === type);

test("links are found, with their punctuation left outside", () => {
  const parts = T.parseMessage("Schau mal: https://example.com/wiki/Seite_(Test), ok? Und (https://example.org/a).");
  const links = parts.filter((p) => p.type === "link");
  assert.deepEqual(links.map((l) => l.value), ["https://example.com/wiki/Seite_(Test)", "https://example.org/a"]);
  assert.equal(links[0].href, "https://example.com/wiki/Seite_(Test)");
  assert.ok(parts.some((p) => p.type === "text" && p.value.startsWith(", ok?")));
  assert.equal(find("www.beispiel.de/seite", "link")[0].href, "https://www.beispiel.de/seite");
});

test("only web addresses become links: nothing that runs a script, nothing else", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "ftp://example.com/x", "file:///etc/passwd", "vbscript:x"]) {
    assert.equal(find(bad, "link").length, 0, bad);
    assert.equal(T.safeUrl(bad), null, bad);
  }
  assert.equal(T.safeUrl("https://ex ample.com"), null);
  assert.equal(T.safeUrl("http://example.com").startsWith("http://"), true);
  assert.equal(find("https://example.com/\"onmouseover=\"x", "link")[0].value, "https://example.com/");
});

test("addresses of servers are found, so that they can be copied: with a port, as an IP, or with a well-known ending", () => {
  const addresses = (text) => find(text, "address").map((a) => a.value);
  assert.deepEqual(addresses("Der Server ist play.example.net:25565 und der alte 192.168.0.12:25565."), ["play.example.net:25565", "192.168.0.12:25565"]);
  assert.deepEqual(addresses("Join mc.hypixel.net oder 10.0.0.1!"), ["mc.hypixel.net", "10.0.0.1"]);
  assert.deepEqual(addresses("Schreib an kontakt@example.com"), [], "an e-mail address is no server");
  for (const notAnAddress of ["Ende.Dann geht es los", "z.B. so", "e.g. this", "Datei: notizen.txt", "Version 1.2.3", "Ich war um 12.30 da", "999.1.1.1.1x"]) {
    assert.deepEqual(addresses(notAnAddress).filter((a) => !/^\d+\.\d+\.\d+\.\d+/.test(a)), [], notAnAddress);
  }
});

test("bold, italic and code, and the numbers of other people", () => {
  assert.deepEqual(find("das ist **wichtig** und *schräg* und `code`", "bold").map((p) => p.value), ["wichtig"]);
  assert.deepEqual(find("das ist **wichtig** und *schräg* und `code`", "italic").map((p) => p.value), ["schräg"]);
  assert.deepEqual(find("das ist **wichtig** und *schräg* und `code`", "code").map((p) => p.value), ["code"]);
  assert.deepEqual(find("danke user 482913 und user123456!", "user").map((p) => p.number), [482913, 123456]);
  assert.equal(find("2*3*4", "italic").length, 0, "a sum is no italic text");
  assert.equal(find("user 12345", "user").length, 0, "six digits");
  assert.equal(T.userName(482913), "user 482913");
  assert.equal(T.userNumber("user 482913"), 482913);
  assert.equal(T.userNumber("@482913"), 482913);
  assert.equal(T.userNumber("12345"), null);
});

test("code blocks, quotes and line breaks", () => {
  const parts = T.parseMessage("Vorher\n```\nline 1\nline 2\n```\nDanach\n> ein Zitat");
  assert.deepEqual(parts.map((p) => p.type), ["text", "codeblock", "text", "quote"]);
  assert.equal(parts.find((p) => p.type === "codeblock").value, "line 1\nline 2");
  assert.deepEqual(types("a\nb"), ["text", "break", "text"]);
  assert.deepEqual(types("```\nnie beendet"), ["codeblock"]);
  assert.deepEqual(T.parseMessage(""), []);
});

test("nothing the person writes is ever turned into HTML: the parts only hold text", () => {
  const parts = T.parseMessage("<img src=x onerror=alert(1)> <script>alert(2)</script> **<b>x</b>**");
  const flat = JSON.stringify(parts);
  assert.ok(flat.includes("<img src=x onerror=alert(1)>"), "the text is kept as it is: the page shows it as text");
  assert.ok(parts.every((p) => ["text", "bold", "italic", "code", "link", "address", "user", "break", "quote", "codeblock"].includes(p.type)));
});

test("what a fact is: a link, an address to copy, or plain text", () => {
  assert.equal(T.factKind("https://example.com/regeln"), "link");
  assert.equal(T.factKind("play.example.net:25565"), "address");
  assert.equal(T.factKind("192.168.1.5"), "address");
  assert.equal(T.factKind("Version 1.20.4, Java Edition"), "text");
  assert.equal(T.factKind("javascript:alert(1)"), "text");
  assert.equal(T.factKind("https://example.com mit Text dahinter"), "text");
});

test("times are said the way people say them", () => {
  const now = new Date(2026, 9, 10, 15, 30);
  const at = (d, h, m) => new Date(2026, 9, d, h, m);
  assert.equal(T.listTime(at(10, 15, 30), now), "jetzt");
  assert.equal(T.listTime(at(10, 15, 20), now), "vor 10 Min.");
  assert.equal(T.listTime(at(10, 9, 5), now), "09:05");
  assert.equal(T.listTime(at(9, 22, 0), now), "Gestern");
  assert.equal(T.listTime(at(7, 8, 0), now), "Mi.");
  assert.equal(T.listTime(at(1, 8, 0), now), "1. Okt.");
  assert.equal(T.listTime(new Date(2025, 11, 24, 8, 0), now), "24. Dez. 2025");
  assert.equal(T.listTime(null, now), "");
  assert.equal(T.dayLabel(at(10, 1, 0), now), "Heute");
  assert.equal(T.dayLabel(at(9, 23, 59), now), "Gestern");
  assert.equal(T.dayLabel(at(3, 12, 0), now), "Sa., 3. Okt.");
  assert.equal(T.clock(at(10, 7, 4)), "07:04");
});

test("addresses of the page", () => {
  assert.deepEqual(T.parsePath("/"), { name: "home" });
  assert.deepEqual(T.parsePath("/g/12"), { name: "group", id: 12 });
  assert.deepEqual(T.parsePath("/g/12/minecraft-server"), { name: "group", id: 12 });
  assert.deepEqual(T.parsePath("/treff-admin"), { name: "admin" });
  assert.equal(T.parsePath("/g/abc").name, "notfound");
  assert.equal(T.parsePath("/irgendwas").name, "notfound");
  assert.equal(T.groupPath({ id: 5, name: "Minecraft Server" }), "/g/5/minecraft-server");
  assert.equal(T.slugify("Über Äpfel & Öl – groß!"), "ueber-aepfel-oel-gross");
  assert.equal(T.slugify("???"), "gruppe");
});

test("colours and letters for the pictures stay the same for the same name", () => {
  assert.deepEqual(T.colorFor("user 482913"), T.colorFor("user 482913"));
  assert.notEqual(T.colorFor("a").hue, T.colorFor("b").hue);
  assert.ok(T.colorFor("x").hue >= 0 && T.colorFor("x").hue < 360);
  assert.equal(T.initials("Minecraft Server"), "MS");
  assert.equal(T.initials("Fußball"), "F");
  assert.equal(T.initials("🎮 Spiele"), "S");
  assert.equal(T.initials("???"), "?");
});
