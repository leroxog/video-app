/* Pulse games: numbers, knowledge and words (pg-numbers.js): Quick Maths, Number Sort, Mental Sum, Prime Tap, Compare, Count the Dots, Odd Emoji, Number Chain,
   Clock Quiz, General Knowledge, Flags, Capitals, Spelling and Number Sequences. Questions with four answers share one small helper. */
(function () {
  "use strict";
  const R = window.PulseGames.register;
  const W = 360;
  const H = 640;

  /* ------------------------------------------------------------------------------------------------ the helper for questions with answers */
  function lines(text, per) {
    const words = String(text).split(" "), out = [];
    let line = "";
    for (const word of words) { if ((line + " " + word).trim().length > per && line) { out.push(line); line = word; } else line = (line + " " + word).trim(); }
    if (line) out.push(line);
    return out;
  }
  const letters = ["A", "B", "C", "D"];
  /* def: {id, name, emoji, cat, color, hint, lives, time(level), make(e, level) -> {prompt (text) | draw(e, elapsed), options: [...], correct, long, delay}} */
  function ask(def) {
    R({ id: def.id, name: def.name, emoji: def.emoji, cat: def.cat || "Zahlen", color: def.color, hint: def.hint, create(e) {
      let level = 0, q = null, lives = def.lives || 3, time = 0, max = 0, shown = 0, wait = 0, picked = -1, good = false;
      const next = () => { q = def.make(e, level); max = def.time ? def.time(level) : 8; time = max; shown = 0; picked = -1; };
      next();
      const layout = () => {
        const n = q.options.length;
        if (q.long || n === 2 || n === 3) return q.options.map((_, k) => ({ x: 30, y: 350 + k * (n === 4 ? 66 : 82), w: W - 60, h: n === 4 ? 56 : 70 }));
        return q.options.map((_, k) => ({ x: 24 + (k % 2) * 160, y: 370 + Math.floor(k / 2) * 96, w: 152, h: 84 }));
      };
      function answer(k) { picked = k; good = k === q.correct; if (good) { level += 1; e.score(level); } else lives -= 1; wait = good ? 0.5 : 1.0; }
      return {
        update(dt) {
          const i = e.input;
          if (wait > 0) { wait -= dt; if (wait <= 0) { if (lives <= 0) { e.over(); return; } next(); } return; }
          shown += dt;
          const delay = q.delay || 0;
          if (shown < delay) return;
          time -= dt;
          if (time <= 0) { picked = -2; good = false; lives -= 1; wait = 1.0; return; }
          if (i.pressed) layout().forEach((r, k) => { if (e.inside(i.x, i.y, r.x, r.y, r.w, r.h)) answer(k); });
          ["1", "2", "3", "4"].forEach((key, k) => { if (k < q.options.length && i.keyPressed(key)) answer(k); });
        },
        draw() {
          e.text("♥".repeat(Math.max(0, lives)), 20, 60, { size: 22, align: "left", color: "#ff5d73" });
          e.text(String(level), W - 24, 60, { size: 24, align: "right" });
          e.panel(24, 100, W - 48, 230, 24, 0.5);
          if (q.draw) q.draw(e, shown, wait > 0); else lines(q.prompt, q.per || 22).forEach((l, k, all) => e.text(l, W / 2, 215 - (all.length - 1) * 18 + k * 36, { size: q.size || 28 }));
          if (q.delay && shown < q.delay) return;
          e.rect(40, 336, (W - 80) * Math.max(0, time / max), 6, time / max < 0.3 ? "#ff7a7a" : "#fff", 3);
          layout().forEach((r, k) => {
            const state = wait > 0 ? (k === q.correct ? "right" : k === picked ? "wrong" : "") : "";
            e.rect(r.x, r.y, r.w, r.h, state === "right" ? "#4cd964" : state === "wrong" ? "#ff5d73" : "rgba(255,255,255,0.9)", 18);
            const label = q.options[k];
            if (label.length > 22 && q.long) lines(label, 24).forEach((l, n, all) => e.text(l, r.x + r.w / 2, r.y + r.h / 2 + (n - (all.length - 1) / 2) * 20, { size: 17, color: state ? "#fff" : "#111", stroke: false }));
            else e.text(label, r.x + r.w / 2, r.y + r.h / 2, { size: label.length > 12 ? 18 : 26, color: state ? "#fff" : "#111", stroke: false });
          });
        },
      };
    } });
  }

  const options = (e, correct, spread, count = 3) => {
    const set = new Set([correct]);
    let guard = 0;
    while (set.size < count + 1 && guard++ < 100) { const v = correct + e.randInt(-spread, spread); if (v !== correct && v >= 0) set.add(v); }
    let fill = 1; while (set.size < count + 1) set.add(correct + fill++);
    return e.shuffle([...set]);
  };

  /* ------------------------------------------------------------------------------------------------ Quick Maths */
  ask({ id: "quick-math", name: "Kopfrechnen", emoji: "➗", color: "#4cc9ff", hint: "Rechne schnell: tippe das richtige Ergebnis", time: (l) => Math.max(2.5, 7 - l * 0.2), make(e, level) {
    const kind = e.randInt(0, level < 3 ? 1 : 2), top = 8 + level * 3;
    let a = e.randInt(2, top), b = e.randInt(2, top), text, answer;
    if (kind === 0) { text = `${a} + ${b}`; answer = a + b; } else if (kind === 1) { if (b > a) [a, b] = [b, a]; text = `${a} − ${b}`; answer = a - b; } else { a = e.randInt(2, 12); b = e.randInt(2, Math.min(12, 4 + level)); text = `${a} × ${b}`; answer = a * b; }
    const list = options(e, answer, Math.max(3, Math.floor(answer / 4) + 2));
    return { prompt: `${text} = ?`, size: 52, options: list.map(String), correct: list.indexOf(answer) };
  } });

  /* ------------------------------------------------------------------------------------------------ Mental Sum */
  ask({ id: "mental-sum", name: "Zahlen-Kette", emoji: "🧮", color: "#59c9ff", hint: "Merk dir die Zahlen, die nacheinander kommen, und rechne sie zusammen", time: () => 7, make(e, level) {
    const count = Math.min(6, 3 + Math.floor(level / 2)), steps = [];
    let total = e.randInt(3, 15);
    steps.push(total);
    for (let k = 1; k < count; k++) { const d = e.randInt(2, 9) * (e.rand() < 0.5 && total > 10 ? -1 : 1); steps.push(d); total += d; }
    const list = options(e, total, 5);
    const each = 0.9;
    return { delay: count * each + 0.3, options: list.map(String), correct: list.indexOf(total), draw(env, elapsed) {
      const k = Math.floor(elapsed / each);
      if (k < steps.length) { const v = steps[k]; env.text(k === 0 ? String(v) : (v > 0 ? `+ ${v}` : `− ${Math.abs(v)}`), W / 2, 215, { size: 80 }); env.text(`${k + 1} / ${steps.length}`, W / 2, 130, { size: 18 }); }
      else env.text("Wie viel ist es?", W / 2, 215, { size: 34 });
    } };
  } });

  /* ------------------------------------------------------------------------------------------------ Compare */
  ask({ id: "compare-numbers", name: "Größer oder kleiner", emoji: "⚖️", color: "#b46bff", hint: "Welche Rechnung hat das größere Ergebnis?", time: (l) => Math.max(2.5, 6 - l * 0.15), make(e, level) {
    const expr = () => { const k = e.randInt(0, 2); const a = e.randInt(2, 9 + level), b = e.randInt(2, 9 + level); return k === 0 ? [`${a} + ${b}`, a + b] : k === 1 ? [`${a + b} − ${b}`, a] : [`${a} × ${Math.min(b, 9)}`, a * Math.min(b, 9)]; };
    let left = expr(), right = expr();
    if (e.rand() < 0.15) right = [right[0], left[1]];
    const correct = left[1] > right[1] ? 0 : left[1] === right[1] ? 1 : 2;
    return { long: true, options: ["Links ist größer", "Beide gleich", "Rechts ist größer"], correct, draw(env) { env.text(left[0], 90, 215, { size: 34 }); env.text("?", W / 2, 215, { size: 40, color: "#ffe66d" }); env.text(right[0], 270, 215, { size: 34 }); } };
  } });

  /* ------------------------------------------------------------------------------------------------ Count the Dots */
  ask({ id: "count-dots", name: "Punkte zählen", emoji: "🔵", color: "#4d8dff", hint: "Die Punkte blitzen kurz auf: wie viele waren es?", time: () => 6, make(e, level) {
    const n = e.randInt(3, Math.min(14, 5 + level)), dots = [];
    while (dots.length < n) { const p = { x: e.rand(50, W - 50), y: e.rand(130, 300) }; if (dots.every((d) => e.dist(d.x, d.y, p.x, p.y) > 30)) dots.push(p); }
    const list = options(e, n, 3).filter((v) => v > 0);
    while (list.length < 4) list.push(n + list.length + 3);
    const show = Math.max(0.7, 1.6 - level * 0.05);
    return { options: list.slice(0, 4).map(String), correct: list.slice(0, 4).indexOf(n), draw(env, elapsed, done) { if (elapsed < show || done) for (const d of dots) env.circle(d.x, d.y, 11, "#ffe66d", "#fff", 2); else env.text("Wie viele?", W / 2, 215, { size: 34 }); } };
  } });

  /* ------------------------------------------------------------------------------------------------ Clock Quiz */
  ask({ id: "clock-quiz", name: "Uhr lesen", emoji: "🕒", cat: "Wissen", color: "#ffb347", hint: "Wie spät ist es? Lies die Uhr", time: () => 8, make(e, level) {
    const h = e.randInt(1, 12), m = e.randInt(0, level < 3 ? 3 : 11) * 5;
    const label = (hh, mm) => `${hh}:${String(mm).padStart(2, "0")}`;
    const set = new Set([label(h, m)]);
    while (set.size < 4) { const hh = e.rand() < 0.5 ? h : e.randInt(1, 12), mm = e.rand() < 0.5 ? m : e.randInt(0, 11) * 5; set.add(label(hh, mm)); }
    const list = e.shuffle([...set]);
    return { options: list, correct: list.indexOf(label(h, m)), draw(env) {
      const cx = W / 2, cy = 215, r = 100;
      env.circle(cx, cy, r, "#fff", "#111", 5);
      for (let k = 0; k < 12; k++) { const a = (k * Math.PI) / 6; env.line(cx + Math.sin(a) * (r - 12), cy - Math.cos(a) * (r - 12), cx + Math.sin(a) * (r - 4), cy - Math.cos(a) * (r - 4), "#111", k % 3 === 0 ? 4 : 2); }
      const am = (m * Math.PI) / 30, ah = (((h % 12) + m / 60) * Math.PI) / 6;
      env.line(cx, cy, cx + Math.sin(ah) * 52, cy - Math.cos(ah) * 52, "#111", 7); env.line(cx, cy, cx + Math.sin(am) * 78, cy - Math.cos(am) * 78, "#d62839", 4); env.circle(cx, cy, 6, "#111");
    } };
  } });

  /* ------------------------------------------------------------------------------------------------ General Knowledge */
  const QUIZ = [
    ["Wie viele Kontinente gibt es?", "7", "5", "6", "8"], ["Welcher Planet ist der Sonne am nächsten?", "Merkur", "Venus", "Mars", "Erde"], ["Wie heißt die Hauptstadt von Frankreich?", "Paris", "Lyon", "Nizza", "Marseille"],
    ["Wie viele Beine hat eine Spinne?", "8", "6", "10", "12"], ["Welches Tier ist das größte der Welt?", "Blauwal", "Elefant", "Giraffe", "Hai"], ["Wofür steht H2O?", "Wasser", "Sauerstoff", "Salz", "Wasserstoff"],
    ["Wie viele Minuten hat eine Stunde?", "60", "100", "50", "30"], ["Welche Farbe entsteht aus Blau und Gelb?", "Grün", "Orange", "Lila", "Braun"], ["Wer malte die Mona Lisa?", "Leonardo da Vinci", "Picasso", "Van Gogh", "Dalí"],
    ["Wie heißt der höchste Berg der Erde?", "Mount Everest", "K2", "Mont Blanc", "Zugspitze"], ["Welches ist das flächenmäßig größte Land?", "Russland", "China", "Kanada", "USA"], ["Wie viele Spieler hat ein Fußballteam auf dem Feld?", "11", "9", "10", "12"],
    ["Welches Gas atmen wir zum Leben ein?", "Sauerstoff", "Stickstoff", "Helium", "Kohlendioxid"], ["In welchem Land steht der Eiffelturm?", "Frankreich", "Italien", "Spanien", "Belgien"], ["Wie viele Tage hat ein Schaltjahr?", "366", "365", "364", "367"],
    ["Welches Säugetier legt Eier?", "Schnabeltier", "Delfin", "Fledermaus", "Känguru"], ["Wie heißt unser Stern?", "Sonne", "Mond", "Sirius", "Polarstern"], ["Wie heißt die Hauptstadt von Italien?", "Rom", "Mailand", "Venedig", "Neapel"],
    ["Wie viele Zähne hat ein Erwachsener normalerweise?", "32", "28", "36", "30"], ["Welcher Ozean ist der größte?", "Pazifik", "Atlantik", "Indischer Ozean", "Arktischer Ozean"], ["Wie heißt die Währung in Japan?", "Yen", "Won", "Yuan", "Dollar"],
    ["Welches Metall ist bei Raumtemperatur flüssig?", "Quecksilber", "Eisen", "Blei", "Zinn"], ["Wer schrieb das Drama „Faust“?", "Goethe", "Schiller", "Lessing", "Kafka"], ["Wie viele Saiten hat eine normale Gitarre?", "6", "4", "5", "7"],
    ["Welches ist das kleinste Land der Welt?", "Vatikanstadt", "Monaco", "Malta", "Liechtenstein"], ["Aus welchem Land kommt die Pizza?", "Italien", "Griechenland", "Spanien", "Frankreich"], ["Wie heißt ein Dreieck mit drei gleichen Seiten?", "Gleichseitig", "Rechtwinklig", "Gleichschenklig", "Stumpfwinklig"],
    ["Welcher Planet ist der größte unseres Sonnensystems?", "Jupiter", "Saturn", "Neptun", "Erde"], ["Welches Organ pumpt das Blut durch den Körper?", "Herz", "Lunge", "Leber", "Niere"], ["Wie viele Farben hat ein Regenbogen?", "7", "5", "6", "8"],
    ["Wie heißt die Hauptstadt von Spanien?", "Madrid", "Barcelona", "Sevilla", "Valencia"], ["In welchem Jahr fiel die Berliner Mauer?", "1989", "1961", "1990", "1979"], ["Wie viele Sekunden hat eine Minute?", "60", "100", "30", "90"],
    ["Welches Landtier ist am schnellsten?", "Gepard", "Löwe", "Pferd", "Antilope"], ["Wie heißt die Hauptstadt von Österreich?", "Wien", "Salzburg", "Graz", "Linz"], ["Was nehmen Pflanzen aus der Luft auf?", "Kohlendioxid", "Sauerstoff", "Stickstoff", "Helium"],
    ["Welcher Kontinent ist der kälteste?", "Antarktis", "Asien", "Europa", "Afrika"], ["Wie viele Ecken hat ein Würfel?", "8", "6", "12", "4"], ["Welches Instrument hat schwarze und weiße Tasten?", "Klavier", "Gitarre", "Geige", "Trompete"],
    ["Wie heißt die Hauptstadt der Schweiz?", "Bern", "Zürich", "Genf", "Basel"], ["Wer entdeckte 1492 Amerika für Europa?", "Christoph Kolumbus", "Marco Polo", "Magellan", "Vasco da Gama"], ["Wie heißt der Erdtrabant?", "Mond", "Mars", "Venus", "Phobos"],
    ["Wie viele Spieler hat ein Basketballteam auf dem Feld?", "5", "6", "7", "11"], ["Zu welchem Land gehört die Hauptstadt Kairo?", "Ägypten", "Marokko", "Libyen", "Türkei"], ["Wie nennt man Wasser im festen Zustand?", "Eis", "Dampf", "Nebel", "Tau"],
    ["Welche Farbe hat ein Smaragd?", "Grün", "Rot", "Blau", "Gelb"], ["Wie heißt die Hauptstadt von Deutschland?", "Berlin", "Hamburg", "München", "Bonn"], ["Wie nennt man ein junges Pferd?", "Fohlen", "Kalb", "Ferkel", "Lamm"],
    ["Was ist die Wurzel aus 81?", "9", "8", "7", "11"], ["Welcher Fluss fließt durch Paris?", "Seine", "Rhein", "Themse", "Donau"], ["Wie viele Planeten hat unser Sonnensystem?", "8", "7", "9", "10"],
    ["Welche Sprache spricht man in Brasilien?", "Portugiesisch", "Spanisch", "Brasilianisch", "Englisch"], ["Wie viele Stunden hat ein Tag?", "24", "12", "36", "48"],
  ];
  const quizOrder = (e) => e.shuffle(QUIZ.map((_, k) => k));
  let quizBag = null, quizAt = 0;
  ask({ id: "quiz-allgemein", name: "Quiz", emoji: "🧠", cat: "Wissen", color: "#9b6bff", hint: "Allgemeinwissen: tippe die richtige Antwort. Drei Fehler und es ist vorbei", lives: 3, time: () => 12, make(e) {
    if (!quizBag || quizAt >= quizBag.length) { quizBag = quizOrder(e); quizAt = 0; }
    const [text, right, ...wrong] = QUIZ[quizBag[quizAt++]];
    const list = e.shuffle([right, ...wrong]);
    return { prompt: text, per: 24, size: 24, long: true, options: list, correct: list.indexOf(right) };
  } });

  /* ------------------------------------------------------------------------------------------------ Flags and Capitals */
  const COUNTRIES = [["DE", "Deutschland", "Berlin"], ["FR", "Frankreich", "Paris"], ["IT", "Italien", "Rom"], ["ES", "Spanien", "Madrid"], ["GB", "Großbritannien", "London"], ["US", "USA", "Washington"], ["BR", "Brasilien", "Brasília"],
    ["JP", "Japan", "Tokio"], ["CN", "China", "Peking"], ["IN", "Indien", "Neu-Delhi"], ["RU", "Russland", "Moskau"], ["CA", "Kanada", "Ottawa"], ["AU", "Australien", "Canberra"], ["MX", "Mexiko", "Mexiko-Stadt"], ["AR", "Argentinien", "Buenos Aires"],
    ["EG", "Ägypten", "Kairo"], ["ZA", "Südafrika", "Pretoria"], ["TR", "Türkei", "Ankara"], ["GR", "Griechenland", "Athen"], ["SE", "Schweden", "Stockholm"], ["NO", "Norwegen", "Oslo"], ["FI", "Finnland", "Helsinki"], ["PL", "Polen", "Warschau"],
    ["NL", "Niederlande", "Amsterdam"], ["BE", "Belgien", "Brüssel"], ["CH", "Schweiz", "Bern"], ["AT", "Österreich", "Wien"], ["PT", "Portugal", "Lissabon"], ["IE", "Irland", "Dublin"], ["DK", "Dänemark", "Kopenhagen"], ["KR", "Südkorea", "Seoul"],
    ["TH", "Thailand", "Bangkok"], ["NZ", "Neuseeland", "Wellington"], ["CL", "Chile", "Santiago"], ["KE", "Kenia", "Nairobi"], ["UA", "Ukraine", "Kiew"], ["CZ", "Tschechien", "Prag"], ["HU", "Ungarn", "Budapest"]];
  const flag = (cc) => String.fromCodePoint(...cc.split("").map((c) => 0x1F1E6 + c.charCodeAt(0) - 65));
  const pickCountries = (e) => { const list = e.shuffle(COUNTRIES).slice(0, 4); return [list, list[0]]; };
  ask({ id: "flag-quiz", name: "Flaggen-Quiz", emoji: "🏁", cat: "Wissen", color: "#ff7a59", hint: "Zu welchem Land gehört die Flagge?", lives: 3, time: () => 8, make(e) {
    const [list, answer] = pickCountries(e); const shuffled = e.shuffle(list);
    return { options: shuffled.map((c) => c[1]), correct: shuffled.indexOf(answer), draw(env) { env.emoji(flag(answer[0]), W / 2, 215, 120); } };
  } });
  ask({ id: "capital-quiz", name: "Hauptstädte", emoji: "🏙️", cat: "Wissen", color: "#4cc9ff", hint: "Wie heißt die Hauptstadt dieses Landes?", lives: 3, time: () => 8, make(e) {
    const [list, answer] = pickCountries(e); const shuffled = e.shuffle(list);
    return { prompt: answer[1], size: 40, options: shuffled.map((c) => c[2]), correct: shuffled.indexOf(answer), draw(env) { env.text(answer[1], W / 2, 235, { size: 38 }); env.text("Hauptstadt von …", W / 2, 150, { size: 20, weight: 600 }); } };
  } });

  /* ------------------------------------------------------------------------------------------------ Spelling */
  const SPELL = [["vielleicht", "vieleicht"], ["Rhythmus", "Rhytmus"], ["Maschine", "Maschiene"], ["Bibliothek", "Bibliotek"], ["Adresse", "Addresse"], ["Restaurant", "Restorant"], ["wahrscheinlich", "warscheinlich"],
    ["Gewissen", "Gewisen"], ["Känguru", "Kängeruh"], ["Mannschaft", "Manschaft"], ["Hilfe", "Hilffe"], ["Atmosphäre", "Atmossphäre"], ["Schiff", "Schif"], ["Fahrrad", "Farrad"], ["Entschuldigung", "Endschuldigung"],
    ["pünktlich", "pünklich"], ["Tomate", "Thomate"], ["Katastrophe", "Katastrofe"], ["Ägypten", "Egypten"], ["Schlittschuh", "Schlitschuh"], ["Zahnarzt", "Zahnartz"], ["Geschwindigkeit", "Geschwindikeit"], ["Abenteuer", "Abendteuer"],
    ["Computer", "Komputer"], ["Klavier", "Clavier"], ["Chaos", "Kaos"], ["Akkordeon", "Akordeon"], ["Rhabarber", "Rabarber"], ["Apfelsine", "Apfelsiene"], ["Strategie", "Strategi"], ["Vergleich", "Vergleig"], ["Löwenzahn", "Löwenzan"],
    ["Gespenst", "Gespänst"], ["Ohrring", "Orring"], ["gefährlich", "gefärlich"], ["Prozent", "Prozennt"], ["Kuchen", "Kuhen"], ["Wettbewerb", "Wetbewerb"], ["Sandwich", "Sandwitsch"], ["Seife", "Seiffe"], ["Lehrer", "Leherer"], ["Schere", "Schehre"]];
  ask({ id: "spelling", name: "Rechtschreibung", emoji: "✏️", cat: "Wissen", color: "#ffb347", hint: "Welche Schreibweise ist richtig?", lives: 3, time: () => 6, make(e) {
    const [right, wrong] = e.pick(SPELL); const list = e.shuffle([right, wrong]);
    return { prompt: "Welche Schreibweise ist richtig?", size: 26, per: 20, options: list, correct: list.indexOf(right) };
  } });

  /* ------------------------------------------------------------------------------------------------ Number Sequences */
  ask({ id: "sequence-quiz", name: "Zahlenreihe", emoji: "🔁", cat: "Zahlen", color: "#6bd45f", hint: "Welche Zahl kommt als Nächstes?", lives: 3, time: () => 12, make(e, level) {
    const kind = e.randInt(0, level < 2 ? 1 : 4), seq = [];
    let next;
    if (kind === 0) { const a = e.randInt(1, 20), d = e.randInt(2, 9); for (let k = 0; k < 5; k++) seq.push(a + d * k); next = a + d * 5; }
    else if (kind === 1) { const a = e.randInt(1, 4), r = e.randInt(2, 3); for (let k = 0; k < 5; k++) seq.push(a * r ** k); next = a * r ** 5; }
    else if (kind === 2) { const o = e.randInt(1, 5); for (let k = 0; k < 5; k++) seq.push((k + o) ** 2); next = (5 + o) ** 2; }
    else if (kind === 3) { let a = e.randInt(1, 4), b = e.randInt(2, 6); for (let k = 0; k < 5; k++) { seq.push(a); [a, b] = [b, a + b]; } next = a; }
    else { const a = e.randInt(2, 10), x = e.randInt(2, 6), y = e.randInt(1, 4); let v = a; for (let k = 0; k < 5; k++) { seq.push(v); v += k % 2 ? y : x; } next = v; }
    const list = options(e, next, Math.max(4, Math.floor(next / 5)));
    return { prompt: `${seq.join(", ")}, ?`, size: 32, per: 14, options: list.map(String), correct: list.indexOf(next) };
  } });

  /* ------------------------------------------------------------------------------------------------ Number Sort */
  R({ id: "number-sort", name: "Zahlen sortieren", emoji: "🔟", cat: "Zahlen", color: "#59a7ff", hint: "Tippe die Zahlen von der kleinsten zur größten (Zeit läuft!)", create(e) {
    let nums = [], done = 0, time = 25, flash = 0, wrongAt = -1, boards = 0, count = 8;
    const fresh = () => { const set = new Set(); while (set.size < count) set.add(e.randInt(1, 99)); nums = e.shuffle([...set]).map((v) => ({ v, hit: false })); done = 0; };
    fresh();
    const sorted = () => [...nums.map((n) => n.v)].sort((a, b) => a - b);
    return {
      update(dt) {
        const i = e.input; time -= dt; flash = Math.max(0, flash - dt);
        if (time <= 0) { e.over(); return; }
        if (i.pressed) nums.forEach((n, k) => {
          const x = 24 + (k % 3) * 104, y = 150 + Math.floor(k / 3) * 84;
          if (!n.hit && e.inside(i.x, i.y, x, y, 96, 74)) { if (n.v === sorted()[done]) { n.hit = true; done += 1; e.addScore(1); if (done === nums.length) { boards += 1; time = Math.min(30, time + 8); count = Math.min(15, count + 1); fresh(); } } else { time -= 1.5; flash = 0.3; wrongAt = k; } }
        });
      },
      draw() {
        e.text(`${Math.max(0, time).toFixed(1)} s`, W / 2, 100, { size: 30, color: flash > 0 ? "#ff7a7a" : "#fff" });
        nums.forEach((n, k) => { const x = 24 + (k % 3) * 104, y = 150 + Math.floor(k / 3) * 84; e.rect(x, y, 96, 74, n.hit ? "rgba(255,255,255,0.18)" : flash > 0 && wrongAt === k ? "#ff5d73" : "rgba(255,255,255,0.9)", 16); if (!n.hit) e.text(n.v, x + 48, y + 38, { size: 34, color: "#111", stroke: false }); });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Prime Tap */
  const isPrime = (n) => { if (n < 2) return false; for (let d = 2; d * d <= n; d++) if (n % d === 0) return false; return true; };
  R({ id: "prime-tap", name: "Primzahl-Jagd", emoji: "🔢", cat: "Zahlen", color: "#ff6bb5", hint: "Tippe nur Primzahlen (2, 3, 5, 7, 11 …), bevor sie unten ankommen", create(e) {
    let items = [], spawn = 0.4, lives = 3, t = 0, pops = [];
    const lose = () => { lives -= 1; if (lives <= 0) e.over(); };
    return {
      update(dt) {
        const i = e.input; t += dt;
        spawn -= dt; if (spawn <= 0) { spawn = Math.max(0.55, 1.2 - t * 0.012); const prime = e.rand() < 0.45; const pool = Array.from({ length: 60 }, (_, k) => k + 2).filter((n) => isPrime(n) === prime); items.push({ x: e.rand(36, W - 36), y: -30, v: e.pick(pool), speed: 70 + t * 1.8 + e.rand(0, 30) }); }
        for (const it of items) { it.y += it.speed * dt; if (!it.dead && it.y > H - 30) { it.dead = true; if (isPrime(it.v)) lose(); } }
        if (i.pressed) { for (let k = items.length - 1; k >= 0; k--) { const it = items[k]; if (!it.dead && e.dist(i.x, i.y, it.x, it.y) < 34) { it.dead = true; if (isPrime(it.v)) { e.addScore(1); pops.push({ x: it.x, y: it.y, t: 0.3 }); } else lose(); break; } } }
        for (const p of pops) p.t -= dt; pops = pops.filter((p) => p.t > 0);
        items = items.filter((it) => !it.dead);
      },
      draw() {
        for (const it of items) { e.circle(it.x, it.y, 28, "rgba(255,255,255,0.92)", "#ff6bb5", 4); e.text(it.v, it.x, it.y, { size: 24, color: "#111", stroke: false }); }
        for (const p of pops) e.circle(p.x, p.y, 40 * (1 - p.t / 0.3) + 12, null, "#9dff7a", 4);
        e.text("♥".repeat(Math.max(0, lives)), 20, 60, { size: 22, align: "left", color: "#ff5d73" });
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Odd Emoji */
  R({ id: "odd-emoji", name: "Finde den Unterschied", emoji: "🙃", cat: "Zahlen", color: "#ffd23f", hint: "Ein Bild sieht etwas anders aus: tippe es an (25 Sekunden)", create(e) {
    const PAIRS = [["🙂", "🙃"], ["😀", "😃"], ["🐶", "🐕"], ["🍎", "🍏"], ["⭐", "🌟"], ["🐱", "🐈"], ["🌕", "🌝"], ["😊", "😌"], ["🔴", "🟠"], ["🌷", "🌹"], ["🐻", "🐼"], ["🍊", "🍑"], ["🚗", "🚙"], ["💙", "💜"], ["🌲", "🌳"]];
    let time = 25, level = 0, base = "", odd = "", at = 0, n = 3, flash = 0;
    const next = () => { n = Math.min(7, 3 + Math.floor(level / 2)); [base, odd] = e.rand() < 0.5 ? e.pick(PAIRS) : e.pick(PAIRS).slice().reverse(); at = e.randInt(0, n * n - 1); };
    next();
    return {
      update(dt) {
        const i = e.input; time -= dt; flash = Math.max(0, flash - dt);
        if (time <= 0) { e.over(); return; }
        if (i.pressed) { const size = 300 / n, cx = Math.floor((i.x - 30) / size), cy = Math.floor((i.y - 180) / size); if (cx >= 0 && cy >= 0 && cx < n && cy < n) { if (cy * n + cx === at) { level += 1; e.score(level); time = Math.min(25, time + 0.8); next(); } else { time -= 2; flash = 0.3; } } }
      },
      draw() {
        e.text(`${Math.max(0, time).toFixed(1)} s`, W / 2, 120, { size: 32, color: flash > 0 ? "#ff7a7a" : "#fff" });
        const size = 300 / n; e.panel(24, 174, 312, 312, 20, 0.4);
        for (let k = 0; k < n * n; k++) e.emoji(k === at ? odd : base, 30 + (k % n) * size + size / 2, 180 + Math.floor(k / n) * size + size / 2, size * 0.7);
      },
    };
  } });

  /* ------------------------------------------------------------------------------------------------ Number Chain */
  R({ id: "number-chain", name: "Zahlen-Jagd", emoji: "🔠", cat: "Zahlen", color: "#7ad7ff", hint: "Tippe die Zahlen der Reihe nach, von 1 bis 16, so schnell du kannst", create(e) {
    let cells, next = 1, time = 35, flash = 0, boards = 0, wrong = -1;
    const fresh = () => { cells = e.shuffle(Array.from({ length: 16 }, (_, k) => k + 1)); next = 1; };
    fresh();
    return {
      update(dt) {
        const i = e.input; time -= dt; flash = Math.max(0, flash - dt);
        if (time <= 0) { e.over(); return; }
        if (i.pressed) cells.forEach((v, k) => { const x = 20 + (k % 4) * 80, y = 170 + Math.floor(k / 4) * 80; if (e.inside(i.x, i.y, x, y, 74, 74) && v >= next) { if (v === next) { e.addScore(1); next += 1; if (next > 16) { boards += 1; time = Math.min(35, time + 10); fresh(); } } else { flash = 0.25; wrong = k; time -= 1; } } });
      },
      draw() {
        e.text(`${Math.max(0, time).toFixed(1)} s`, W / 2, 100, { size: 30 });
        e.text(`Suche die ${Math.min(next, 16)}`, W / 2, 140, { size: 22 });
        cells.forEach((v, k) => { const x = 20 + (k % 4) * 80, y = 170 + Math.floor(k / 4) * 80; e.rect(x, y, 74, 74, v < next ? "rgba(255,255,255,0.15)" : flash > 0 && wrong === k ? "#ff5d73" : "rgba(255,255,255,0.9)", 16); if (v >= next) e.text(v, x + 37, y + 38, { size: 32, color: "#111", stroke: false }); });
      },
    };
  } });
})();
