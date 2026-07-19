// timeskip studio can be programmed in more than one syntax "dialect".
// Every dialect compiles down to the exact same rule shape used by
// studio-runtime.js: {infinite, target, trigger, condition, effect, canCollide}.
// timeskipcode is our own language and the recommended default; HTML/Python/
// C# are alternative, flavoured syntaxes with identical capabilities -- not
// real interpreters for those languages, just familiar-looking spellings of
// the same block-game rules.
//
// Every dialect's lines still live inside the same immutable "⇒" / "⇓"
// glyph wrapper (see normalizeCode() in studio-editor.js) -- only the text
// of each line changes between dialects.
(function (global) {
    function num(v, fallback) {
        if (v === null || v === undefined || v === "") return fallback;
        const n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    }

    function attr(line, name) {
        const m = line.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i"));
        return m ? m[1] : null;
    }

    // Shared "for \"15s\"/\"5m\"/\"1h\"" trailing duration clause used by the
    // three flavoured dialects (HTML/Python/C#) on their MOVE effect --
    // keeps duration a simple appendable suffix no matter how the rest of
    // the line is bracketed.
    function parseTrailingDuration(line) {
        const m = line.match(/\bfor\s+"(\d+(?:\.\d+)?)(s|m|h)"/i);
        if (!m) return null;
        const perUnit = { s: 1000, m: 60000, h: 3600000 }[m[2].toLowerCase()];
        return Math.max(0, parseFloat(m[1]) * perUnit);
    }

    // Human-readable (German) explanations, shared across dialects since the
    // *meaning* of each command doesn't change, only its spelling.
    const DESCRIPTIONS = {
        repeat: "Wiederholt die Regel bei jedem Bild (Frame), statt nur einmal.",
        block: "Legt fest, für welchen Teil die Regel gilt.",
        touch: "Feuert, wenn die Spielfigur diesen Teil berührt.",
        click: "Feuert, wenn auf diesen Teil geklickt wird.",
        ambient: "Läuft dauerhaft im Hintergrund (mit REPEAT jeden Frame, sonst einmal beim Start).",
        condition: "Die Regel feuert nur, wenn diese Bedingung wahr ist.",
        kill: "Lässt die Spielfigur sterben und neu starten (mit ALL alle Spieler).",
        give: "Gibt Münzen.",
        move: 'Bewegt den Teil um X/Y. Mit der Dauer-Ergänzung wird die Bewegung animiert.',
        jump: "Lässt die Spielfigur wie auf einem Trampolin hochspringen.",
        teleport: "Versetzt sofort an eine feste Position (mit ALL alle Spieler).",
        transparent: "Macht den Teil (halb-)durchsichtig.",
        set: "Setzt eine Variable auf einen festen Wert.",
        change: "Verändert eine Variable um einen Wert (z. B. +1 oder -1).",
        duration: "Dauer, über die eine MOVE-Bewegung animiert wird.",
        solid: "Schließt die Regel ab -- der Teil bleibt fest/kollidierbar.",
        passable: "Schließt die Regel ab -- man kann hindurchgehen.",
        figuresOff: "Schaltet die kleine Spielfigur überall aus.",
    };

    // ---------- timeskipcode: our own language (recommended) ----------
    function quoted(line, key) {
        const m = line.match(new RegExp("\\b" + key + '\\s*"([^"]*)"', "i"));
        return m ? m[1] : null;
    }
    function quotedNumber(line, key, fallback) {
        return num(quoted(line, key), fallback);
    }

    const timeskipcode = {
        id: "timeskipcode",
        label: "timeskipcode",
        // No longer offered when creating a new project (see
        // STUDIO_LANGUAGE_CHOICES in app.py) -- kept here only so any
        // project that already used it keeps parsing/playing correctly.
        recommended: false,
        repeat: { insert: "REPEAT", match: (l) => /^REPEAT$/i.test(l), de: DESCRIPTIONS.repeat },
        block: {
            insert: (name) => `BLOCK "${name}"`,
            match: (l) => quoted(l, "BLOCK"),
            de: DESCRIPTIONS.block,
        },
        triggers: [
            { type: "touch", insert: "WHEN TOUCHED", match: (l) => /^WHEN\s+TOUCHED$/i.test(l), de: DESCRIPTIONS.touch },
            { type: "click", insert: "WHEN CLICKED", match: (l) => /^WHEN\s+CLICKED$/i.test(l), de: DESCRIPTIONS.click },
            { type: "ambient", insert: "WHEN ALWAYS", match: (l) => /^WHEN\s+ALWAYS$/i.test(l), de: DESCRIPTIONS.ambient },
        ],
        conditions: [
            { op: ">", insert: 'IF "score" > "10"' },
            { op: "=", insert: 'IF "score" = "10"' },
            { op: "<", insert: 'IF "score" < "10"' },
        ],
        matchCondition: (l) => {
            const m = l.match(/^IF\s+"([^"]*)"\s*(>=|<=|!=|>|<|=)\s*"(-?\d+(?:\.\d+)?)"$/i);
            return m ? { varName: m[1], operator: m[2], value: parseFloat(m[3]) } : null;
        },
        conditionDe: DESCRIPTIONS.condition,
        effects: [
            { key: "kill", insert: "KILL", template: "", de: DESCRIPTIONS.kill,
                match: (l) => /^KILL\b/i.test(l), build: (l) => ({ type: "kill", allPlayers: /\bALL\b/i.test(l) }) },
            { key: "give", insert: "GIVE", template: ' "+5" COINS', de: DESCRIPTIONS.give,
                match: (l) => /^GIVE\b/i.test(l),
                build: (l) => ({ type: "give", amount: num((l.match(/"([-+]?\d+)"/) || [])[1], 0), currency: "coins", allPlayers: /\bALL\b/i.test(l), duration: null }) },
            { key: "move", insert: "MOVE", template: ' X"-84" Y"+3"', de: DESCRIPTIONS.move,
                match: (l) => /^MOVE\b/i.test(l),
                build: (l) => {
                    const m = l.match(/IN\s*"(-?\d+(?:\.\d+)?)"\s*(SECONDS|MINUTES|HOURS)/i);
                    const duration = m ? Math.max(0, parseFloat(m[1]) * { SECONDS: 1000, MINUTES: 60000, HOURS: 3600000 }[m[2].toUpperCase()]) : null;
                    return { type: "move", dx: quotedNumber(l, "X", 0), dy: quotedNumber(l, "Y", 0), duration };
                } },
            { key: "jump", insert: "JUMP", template: ' "15"', de: DESCRIPTIONS.jump,
                match: (l) => /^JUMP\b/i.test(l),
                build: (l) => { const m = l.match(/"(-?\d+(?:\.\d+)?)"/); return { type: "trampoline", power: m ? Math.abs(parseFloat(m[1])) : 15, duration: null }; } },
            { key: "teleport", insert: "TELEPORT", template: ' X"10" Y"20"', de: DESCRIPTIONS.teleport,
                match: (l) => /^TELEPORT\b/i.test(l),
                build: (l) => ({ type: "teleport", allPlayers: /\bALL\b/i.test(l), x: quotedNumber(l, "X", 0), y: quotedNumber(l, "Y", 0), duration: null }) },
            { key: "transparent", insert: "TRANSPARENT", template: ' "50"', de: DESCRIPTIONS.transparent,
                match: (l) => /^TRANSPARENT\b/i.test(l),
                build: (l) => { const m = l.match(/"(\d+(?:\.\d+)?)"/); return { type: "transparents", percent: m ? parseFloat(m[1]) : 100, duration: null }; } },
            { key: "set", insert: "SET", template: ' "score" TO "0"', de: DESCRIPTIONS.set,
                match: (l) => /^SET\b/i.test(l),
                build: (l) => ({ type: "set", varName: quoted(l, "SET"), value: quotedNumber(l, "TO", 0) }) },
            { key: "change", insert: "CHANGE", template: ' "score" BY "+1"', de: DESCRIPTIONS.change,
                match: (l) => /^CHANGE\b/i.test(l),
                build: (l) => ({ type: "change", varName: quoted(l, "CHANGE"), value: quotedNumber(l, "BY", 0) }) },
        ],
        conditionGhostWord: "IF",
        conditionTemplate: ' "score" > "10"',
        duration: [
            { insert: ' IN "15" SECONDS', label: "15 SECONDS", de: DESCRIPTIONS.duration },
            { insert: ' IN "5" MINUTES', label: "5 MINUTES", de: DESCRIPTIONS.duration },
            { insert: ' IN "1" HOURS', label: "1 HOUR", de: DESCRIPTIONS.duration },
        ],
        close: {
            solidInsert: "SOLID", passableInsert: "PASSABLE",
            solidDe: DESCRIPTIONS.solid, passableDe: DESCRIPTIONS.passable,
            match: (l) => (/^SOLID$/i.test(l) ? true : /^PASSABLE$/i.test(l) ? false : null),
        },
        figuresOff: { insert: "FIGURES OFF", match: (code) => /FIGURES\s+OFF/i.test(code || ""), de: DESCRIPTIONS.figuresOff },
        extraActionChips: [{ insert: "KILL ALL", label: "KILL ALL", de: DESCRIPTIONS.kill }],
    };

    // ---------- HTML: tag-flavoured syntax ----------
    const html = {
        id: "html",
        label: "HTML",
        recommended: false,
        repeat: { insert: "<repeat/>", match: (l) => /^<repeat\s*\/>$/i.test(l), de: DESCRIPTIONS.repeat },
        block: {
            insert: (name) => `<block name="${name}"/>`,
            match: (l) => attr(l, "name") !== null && /^<block\b/i.test(l) ? attr(l, "name") : null,
            de: DESCRIPTIONS.block,
        },
        triggers: [
            { type: "touch", insert: "<when touched/>", match: (l) => /^<when\s+touched\s*\/>$/i.test(l), de: DESCRIPTIONS.touch },
            { type: "click", insert: "<when clicked/>", match: (l) => /^<when\s+clicked\s*\/>$/i.test(l), de: DESCRIPTIONS.click },
            { type: "ambient", insert: "<when always/>", match: (l) => /^<when\s+always\s*\/>$/i.test(l), de: DESCRIPTIONS.ambient },
        ],
        conditions: [
            { op: ">", insert: '<if var="score" op=">" value="10"/>' },
            { op: "=", insert: '<if var="score" op="=" value="10"/>' },
            { op: "<", insert: '<if var="score" op="<" value="10"/>' },
        ],
        matchCondition: (l) => {
            if (!/^<if\b/i.test(l)) return null;
            const varName = attr(l, "var");
            const operator = attr(l, "op");
            const value = attr(l, "value");
            if (varName === null || operator === null || value === null) return null;
            return { varName, operator, value: parseFloat(value) };
        },
        conditionDe: DESCRIPTIONS.condition,
        effects: [
            { key: "kill", insert: "<kill", template: '/>', de: DESCRIPTIONS.kill,
                match: (l) => /^<kill\b/i.test(l), build: (l) => ({ type: "kill", allPlayers: attr(l, "all") === "true" }) },
            { key: "give", insert: "<give", template: ' amount="+5" currency="coins"/>', de: DESCRIPTIONS.give,
                match: (l) => /^<give\b/i.test(l),
                build: (l) => ({ type: "give", amount: num(attr(l, "amount"), 0), currency: "coins", allPlayers: attr(l, "all") === "true", duration: null }) },
            { key: "move", insert: "<move", template: ' x="-84" y="+3"/>', de: DESCRIPTIONS.move,
                match: (l) => /^<move\b/i.test(l),
                build: (l) => ({ type: "move", dx: num(attr(l, "x"), 0), dy: num(attr(l, "y"), 0), duration: parseTrailingDuration(l) }) },
            { key: "jump", insert: "<jump", template: ' power="15"/>', de: DESCRIPTIONS.jump,
                match: (l) => /^<jump\b/i.test(l),
                build: (l) => ({ type: "trampoline", power: Math.abs(num(attr(l, "power"), 15)), duration: null }) },
            { key: "teleport", insert: "<teleport", template: ' x="10" y="20"/>', de: DESCRIPTIONS.teleport,
                match: (l) => /^<teleport\b/i.test(l),
                build: (l) => ({ type: "teleport", allPlayers: attr(l, "all") === "true", x: num(attr(l, "x"), 0), y: num(attr(l, "y"), 0), duration: null }) },
            { key: "transparent", insert: "<transparent", template: ' percent="50"/>', de: DESCRIPTIONS.transparent,
                match: (l) => /^<transparent\b/i.test(l),
                build: (l) => ({ type: "transparents", percent: num(attr(l, "percent"), 100), duration: null }) },
            { key: "set", insert: "<set", template: ' var="score" value="0"/>', de: DESCRIPTIONS.set,
                match: (l) => /^<set\b/i.test(l),
                build: (l) => ({ type: "set", varName: attr(l, "var"), value: num(attr(l, "value"), 0) }) },
            { key: "change", insert: "<change", template: ' var="score" by="+1"/>', de: DESCRIPTIONS.change,
                match: (l) => /^<change\b/i.test(l),
                build: (l) => ({ type: "change", varName: attr(l, "var"), value: num(attr(l, "by"), 0) }) },
        ],
        conditionGhostWord: "<if",
        duration: [
            { insert: ' for "15s"', label: "15 Sekunden", de: DESCRIPTIONS.duration },
            { insert: ' for "5m"', label: "5 Minuten", de: DESCRIPTIONS.duration },
            { insert: ' for "1h"', label: "1 Stunde", de: DESCRIPTIONS.duration },
        ],
        close: {
            solidInsert: "<solid/>", passableInsert: "<passable/>",
            solidDe: DESCRIPTIONS.solid, passableDe: DESCRIPTIONS.passable,
            match: (l) => (/^<solid\s*\/>$/i.test(l) ? true : /^<passable\s*\/>$/i.test(l) ? false : null),
        },
        figuresOff: { insert: "<figuresoff/>", match: (code) => /<figuresoff\s*\/>/i.test(code || ""), de: DESCRIPTIONS.figuresOff },
        extraActionChips: [{ insert: '<kill all="true"/>', label: '<kill all="true"/>', de: DESCRIPTIONS.kill }],
    };

    // ---------- Python: def/indentation-flavoured syntax ----------
    function callArgs(line) {
        const m = line.match(/^([a-zA-Z_]\w*)\s*\(([^)]*)\)/);
        return m ? { name: m[1].toLowerCase(), args: m[2] } : null;
    }
    function pyArg(args, name) {
        const m = args.match(new RegExp(name + "\\s*=\\s*(-?\\d+(?:\\.\\d+)?)", "i"));
        return m ? m[1] : null;
    }

    const python = {
        id: "python",
        label: "Python",
        recommended: true,
        repeat: { insert: "repeat", match: (l) => /^repeat$/i.test(l), de: DESCRIPTIONS.repeat },
        block: {
            insert: (name) => `block("${name}")`,
            match: (l) => { const m = l.match(/^block\(\s*"([^"]*)"\s*\)$/i); return m ? m[1] : null; },
            de: DESCRIPTIONS.block,
        },
        triggers: [
            { type: "touch", insert: "when touched:", match: (l) => /^when\s+touched\s*:$/i.test(l), de: DESCRIPTIONS.touch },
            { type: "click", insert: "when clicked:", match: (l) => /^when\s+clicked\s*:$/i.test(l), de: DESCRIPTIONS.click },
            { type: "ambient", insert: "when always:", match: (l) => /^when\s+always\s*:$/i.test(l), de: DESCRIPTIONS.ambient },
        ],
        conditions: [
            { op: ">", insert: "if score > 10:" },
            { op: "=", insert: "if score == 10:" },
            { op: "<", insert: "if score < 10:" },
        ],
        matchCondition: (l) => {
            const m = l.match(/^if\s+(\w+)\s*(>=|<=|!=|==|>|<)\s*(-?\d+(?:\.\d+)?)\s*:$/i);
            if (!m) return null;
            return { varName: m[1], operator: m[2] === "==" ? "=" : m[2], value: parseFloat(m[3]) };
        },
        conditionDe: DESCRIPTIONS.condition,
        effects: [
            { key: "kill", insert: "kill(", template: ")", de: DESCRIPTIONS.kill,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "kill"; },
                build: (l) => ({ type: "kill", allPlayers: /all\s*=\s*true/i.test(l) }) },
            { key: "give", insert: "give(", template: '5, "coins")', de: DESCRIPTIONS.give,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "give"; },
                build: (l) => { const c = callArgs(l); return { type: "give", amount: num((c.args.match(/-?\d+/) || [])[0], 0), currency: "coins", allPlayers: /all\s*=\s*true/i.test(l), duration: null }; } },
            { key: "move", insert: "move(", template: "x=-84, y=3)", de: DESCRIPTIONS.move,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "move"; },
                build: (l) => { const c = callArgs(l); return { type: "move", dx: num(pyArg(c.args, "x"), 0), dy: num(pyArg(c.args, "y"), 0), duration: parseTrailingDuration(l) }; } },
            { key: "jump", insert: "jump(", template: "15)", de: DESCRIPTIONS.jump,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "jump"; },
                build: (l) => { const c = callArgs(l); return { type: "trampoline", power: Math.abs(num((c.args.match(/-?\d+(?:\.\d+)?/) || [])[0], 15)), duration: null }; } },
            { key: "teleport", insert: "teleport(", template: "x=10, y=20)", de: DESCRIPTIONS.teleport,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "teleport"; },
                build: (l) => { const c = callArgs(l); return { type: "teleport", allPlayers: /all\s*=\s*true/i.test(l), x: num(pyArg(c.args, "x"), 0), y: num(pyArg(c.args, "y"), 0), duration: null }; } },
            { key: "transparent", insert: "transparent(", template: "50)", de: DESCRIPTIONS.transparent,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "transparent"; },
                build: (l) => { const c = callArgs(l); return { type: "transparents", percent: num((c.args.match(/-?\d+(?:\.\d+)?/) || [])[0], 100), duration: null }; } },
            { key: "set", insert: "set(", template: "score, 0)", de: DESCRIPTIONS.set,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "set"; },
                build: (l) => { const c = callArgs(l); const parts = c.args.split(","); return { type: "set", varName: (parts[0] || "").trim(), value: num(parts[1], 0) }; } },
            { key: "change", insert: "change(", template: "score, +1)", de: DESCRIPTIONS.change,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "change"; },
                build: (l) => { const c = callArgs(l); const parts = c.args.split(","); return { type: "change", varName: (parts[0] || "").trim(), value: num(parts[1], 0) }; } },
        ],
        conditionGhostWord: "if",
        duration: [
            { insert: ' for "15s"', label: "15 Sekunden", de: DESCRIPTIONS.duration },
            { insert: ' for "5m"', label: "5 Minuten", de: DESCRIPTIONS.duration },
            { insert: ' for "1h"', label: "1 Stunde", de: DESCRIPTIONS.duration },
        ],
        close: {
            solidInsert: "solid()", passableInsert: "passable()",
            solidDe: DESCRIPTIONS.solid, passableDe: DESCRIPTIONS.passable,
            match: (l) => (/^solid\(\)$/i.test(l) ? true : /^passable\(\)$/i.test(l) ? false : null),
        },
        figuresOff: { insert: "figures_off()", match: (code) => /figures_off\(\)/i.test(code || ""), de: DESCRIPTIONS.figuresOff },
        extraActionChips: [{ insert: "kill(all=True)", label: "kill(all=True)", de: DESCRIPTIONS.kill }],
    };

    // ---------- C#: PascalCase method-call-flavoured syntax ----------
    const csharp = {
        id: "csharp",
        label: "C#",
        recommended: false,
        repeat: { insert: "Repeat();", match: (l) => /^repeat\s*\(\s*\)\s*;$/i.test(l), de: DESCRIPTIONS.repeat },
        block: {
            insert: (name) => `Block("${name}");`,
            match: (l) => { const m = l.match(/^block\(\s*"([^"]*)"\s*\)\s*;$/i); return m ? m[1] : null; },
            de: DESCRIPTIONS.block,
        },
        triggers: [
            { type: "touch", insert: "When(Touched);", match: (l) => /^when\(\s*touched\s*\)\s*;$/i.test(l), de: DESCRIPTIONS.touch },
            { type: "click", insert: "When(Clicked);", match: (l) => /^when\(\s*clicked\s*\)\s*;$/i.test(l), de: DESCRIPTIONS.click },
            { type: "ambient", insert: "When(Always);", match: (l) => /^when\(\s*always\s*\)\s*;$/i.test(l), de: DESCRIPTIONS.ambient },
        ],
        conditions: [
            { op: ">", insert: "If(score > 10);" },
            { op: "=", insert: "If(score == 10);" },
            { op: "<", insert: "If(score < 10);" },
        ],
        matchCondition: (l) => {
            const m = l.match(/^if\(\s*(\w+)\s*(>=|<=|!=|==|>|<)\s*(-?\d+(?:\.\d+)?)\s*\)\s*;$/i);
            if (!m) return null;
            return { varName: m[1], operator: m[2] === "==" ? "=" : m[2], value: parseFloat(m[3]) };
        },
        conditionDe: DESCRIPTIONS.condition,
        effects: [
            { key: "kill", insert: "Kill(", template: ");", de: DESCRIPTIONS.kill,
                match: (l) => /^kill\(/i.test(l), build: (l) => ({ type: "kill", allPlayers: /all\s*:\s*true/i.test(l) }) },
            { key: "give", insert: "Give(", template: '5, "coins");', de: DESCRIPTIONS.give,
                match: (l) => /^give\(/i.test(l),
                build: (l) => ({ type: "give", amount: num((l.match(/-?\d+/) || [])[0], 0), currency: "coins", allPlayers: /all\s*:\s*true/i.test(l), duration: null }) },
            { key: "move", insert: "Move(", template: "x: -84, y: 3);", de: DESCRIPTIONS.move,
                match: (l) => /^move\(/i.test(l),
                build: (l) => ({ type: "move", dx: num((l.match(/x\s*:\s*(-?\d+(?:\.\d+)?)/i) || [])[1], 0), dy: num((l.match(/y\s*:\s*(-?\d+(?:\.\d+)?)/i) || [])[1], 0), duration: parseTrailingDuration(l) }) },
            { key: "jump", insert: "Jump(", template: "15);", de: DESCRIPTIONS.jump,
                match: (l) => /^jump\(/i.test(l),
                build: (l) => { const m = l.match(/-?\d+(?:\.\d+)?/); return { type: "trampoline", power: m ? Math.abs(parseFloat(m[0])) : 15, duration: null }; } },
            { key: "teleport", insert: "Teleport(", template: "x: 10, y: 20);", de: DESCRIPTIONS.teleport,
                match: (l) => /^teleport\(/i.test(l),
                build: (l) => ({ type: "teleport", allPlayers: /all\s*:\s*true/i.test(l), x: num((l.match(/x\s*:\s*(-?\d+(?:\.\d+)?)/i) || [])[1], 0), y: num((l.match(/y\s*:\s*(-?\d+(?:\.\d+)?)/i) || [])[1], 0), duration: null }) },
            { key: "transparent", insert: "Transparent(", template: "50);", de: DESCRIPTIONS.transparent,
                match: (l) => /^transparent\(/i.test(l),
                build: (l) => { const m = l.match(/-?\d+(?:\.\d+)?/); return { type: "transparents", percent: m ? parseFloat(m[0]) : 100, duration: null }; } },
            { key: "set", insert: "Set(", template: '"score", 0);', de: DESCRIPTIONS.set,
                match: (l) => /^set\(/i.test(l),
                build: (l) => { const m = l.match(/"([^"]*)"\s*,\s*(-?\d+(?:\.\d+)?)/i); return { type: "set", varName: m ? m[1] : null, value: m ? parseFloat(m[2]) : 0 }; } },
            { key: "change", insert: "Change(", template: '"score", +1);', de: DESCRIPTIONS.change,
                match: (l) => /^change\(/i.test(l),
                build: (l) => { const m = l.match(/"([^"]*)"\s*,\s*(-?\d+(?:\.\d+)?)/i); return { type: "change", varName: m ? m[1] : null, value: m ? parseFloat(m[2]) : 0 }; } },
        ],
        conditionGhostWord: "If(",
        duration: [
            { insert: ' for "15s"', label: "15 Sekunden", de: DESCRIPTIONS.duration },
            { insert: ' for "5m"', label: "5 Minuten", de: DESCRIPTIONS.duration },
            { insert: ' for "1h"', label: "1 Stunde", de: DESCRIPTIONS.duration },
        ],
        close: {
            solidInsert: "Solid();", passableInsert: "Passable();",
            solidDe: DESCRIPTIONS.solid, passableDe: DESCRIPTIONS.passable,
            match: (l) => (/^solid\(\s*\)\s*;$/i.test(l) ? true : /^passable\(\s*\)\s*;$/i.test(l) ? false : null),
        },
        figuresOff: { insert: "FiguresOff();", match: (code) => /figuresoff\(\s*\)\s*;/i.test(code || ""), de: DESCRIPTIONS.figuresOff },
        extraActionChips: [{ insert: "Kill(all: true);", label: "Kill(all: true);", de: DESCRIPTIONS.kill }],
    };

    // ---------- JavaScript: function-call-flavoured syntax ----------
    function stripQuotes(s) {
        return (s || "").replace(/^"|"$/g, "").trim();
    }
    function splitArgs(args) {
        return (args || "").split(",").map((a) => a.trim());
    }

    const javascript = {
        id: "javascript",
        label: "JavaScript",
        recommended: false,
        repeat: { insert: "repeat();", match: (l) => /^repeat\(\s*\)\s*;$/i.test(l), de: DESCRIPTIONS.repeat },
        block: {
            insert: (name) => `block("${name}");`,
            match: (l) => { const m = l.match(/^block\(\s*"([^"]*)"\s*\)\s*;$/i); return m ? m[1] : null; },
            de: DESCRIPTIONS.block,
        },
        triggers: [
            { type: "touch", insert: 'when("touched");', match: (l) => /^when\(\s*"touched"\s*\)\s*;$/i.test(l), de: DESCRIPTIONS.touch },
            { type: "click", insert: 'when("clicked");', match: (l) => /^when\(\s*"clicked"\s*\)\s*;$/i.test(l), de: DESCRIPTIONS.click },
            { type: "ambient", insert: 'when("always");', match: (l) => /^when\(\s*"always"\s*\)\s*;$/i.test(l), de: DESCRIPTIONS.ambient },
        ],
        conditions: [
            { op: ">", insert: "if (score > 10)" },
            { op: "=", insert: "if (score === 10)" },
            { op: "<", insert: "if (score < 10)" },
        ],
        matchCondition: (l) => {
            const m = l.match(/^if\s*\(\s*(\w+)\s*(>=|<=|!=|===|==|>|<)\s*(-?\d+(?:\.\d+)?)\s*\)$/i);
            if (!m) return null;
            const op = (m[2] === "===" || m[2] === "==") ? "=" : m[2];
            return { varName: m[1], operator: op, value: parseFloat(m[3]) };
        },
        conditionDe: DESCRIPTIONS.condition,
        conditionGhostWord: "if (",
        conditionTemplate: "score > 10)",
        effects: [
            { key: "kill", insert: "kill(", template: ");", de: DESCRIPTIONS.kill,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "kill"; },
                build: (l) => ({ type: "kill", allPlayers: /true/i.test(l) }) },
            { key: "give", insert: "give(", template: '5, "coins");', de: DESCRIPTIONS.give,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "give"; },
                build: (l) => { const c = callArgs(l); const parts = splitArgs(c.args); return { type: "give", amount: num(parts[0], 0), currency: "coins", allPlayers: /true/i.test(l), duration: null }; } },
            { key: "move", insert: "move(", template: "-84, 3);", de: DESCRIPTIONS.move,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "move"; },
                build: (l) => { const c = callArgs(l); const parts = splitArgs(c.args); return { type: "move", dx: num(parts[0], 0), dy: num(parts[1], 0), duration: parseTrailingDuration(l) }; } },
            { key: "jump", insert: "jump(", template: "15);", de: DESCRIPTIONS.jump,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "jump"; },
                build: (l) => { const c = callArgs(l); const parts = splitArgs(c.args); return { type: "trampoline", power: Math.abs(num(parts[0], 15)), duration: null }; } },
            { key: "teleport", insert: "teleport(", template: "10, 20);", de: DESCRIPTIONS.teleport,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "teleport"; },
                build: (l) => { const c = callArgs(l); const parts = splitArgs(c.args); return { type: "teleport", allPlayers: /true/i.test(l), x: num(parts[0], 0), y: num(parts[1], 0), duration: null }; } },
            { key: "transparent", insert: "transparent(", template: "50);", de: DESCRIPTIONS.transparent,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "transparent"; },
                build: (l) => { const c = callArgs(l); const parts = splitArgs(c.args); return { type: "transparents", percent: num(parts[0], 100), duration: null }; } },
            { key: "set", insert: "set(", template: '"score", 0);', de: DESCRIPTIONS.set,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "set"; },
                build: (l) => { const c = callArgs(l); const parts = splitArgs(c.args); return { type: "set", varName: stripQuotes(parts[0]), value: num(parts[1], 0) }; } },
            { key: "change", insert: "change(", template: '"score", 1);', de: DESCRIPTIONS.change,
                match: (l) => { const c = callArgs(l); return !!c && c.name === "change"; },
                build: (l) => { const c = callArgs(l); const parts = splitArgs(c.args); return { type: "change", varName: stripQuotes(parts[0]), value: num(parts[1], 0) }; } },
        ],
        duration: [
            { insert: ' for "15s"', label: "15 Sekunden", de: DESCRIPTIONS.duration },
            { insert: ' for "5m"', label: "5 Minuten", de: DESCRIPTIONS.duration },
            { insert: ' for "1h"', label: "1 Stunde", de: DESCRIPTIONS.duration },
        ],
        close: {
            solidInsert: "solid();", passableInsert: "passable();",
            solidDe: DESCRIPTIONS.solid, passableDe: DESCRIPTIONS.passable,
            match: (l) => (/^solid\(\s*\)\s*;$/i.test(l) ? true : /^passable\(\s*\)\s*;$/i.test(l) ? false : null),
        },
        figuresOff: { insert: "figuresOff();", match: (code) => /figuresOff\(\s*\)\s*;/i.test(code || ""), de: DESCRIPTIONS.figuresOff },
        extraActionChips: [{ insert: "kill(true);", label: "kill(true);", de: DESCRIPTIONS.kill }],
    };

    // ---------- Java: Game.xxx()-flavoured static-call syntax ----------
    function gameCallArgs(line) {
        const m = line.match(/^Game\.([a-zA-Z_]\w*)\s*\(([^)]*)\)/i);
        return m ? { name: m[1].toLowerCase(), args: m[2] } : null;
    }

    const java = {
        id: "java",
        label: "Java",
        recommended: false,
        repeat: { insert: "Game.repeat();", match: (l) => { const c = gameCallArgs(l); return !!c && c.name === "repeat"; }, de: DESCRIPTIONS.repeat },
        block: {
            insert: (name) => `Game.block("${name}");`,
            match: (l) => { const c = gameCallArgs(l); return c && c.name === "block" ? stripQuotes(c.args) : null; },
            de: DESCRIPTIONS.block,
        },
        triggers: [
            { type: "touch", insert: 'Game.when("touched");', match: (l) => { const c = gameCallArgs(l); return !!c && c.name === "when" && /touched/i.test(c.args); }, de: DESCRIPTIONS.touch },
            { type: "click", insert: 'Game.when("clicked");', match: (l) => { const c = gameCallArgs(l); return !!c && c.name === "when" && /clicked/i.test(c.args); }, de: DESCRIPTIONS.click },
            { type: "ambient", insert: 'Game.when("always");', match: (l) => { const c = gameCallArgs(l); return !!c && c.name === "when" && /always/i.test(c.args); }, de: DESCRIPTIONS.ambient },
        ],
        conditions: [
            { op: ">", insert: "if (score > 10)" },
            { op: "=", insert: "if (score == 10)" },
            { op: "<", insert: "if (score < 10)" },
        ],
        matchCondition: (l) => {
            const m = l.match(/^if\s*\(\s*(\w+)\s*(>=|<=|!=|==|>|<)\s*(-?\d+(?:\.\d+)?)\s*\)$/i);
            if (!m) return null;
            return { varName: m[1], operator: m[2] === "==" ? "=" : m[2], value: parseFloat(m[3]) };
        },
        conditionDe: DESCRIPTIONS.condition,
        conditionGhostWord: "if (",
        conditionTemplate: "score > 10)",
        effects: [
            { key: "kill", insert: "Game.kill(", template: ");", de: DESCRIPTIONS.kill,
                match: (l) => { const c = gameCallArgs(l); return !!c && c.name === "kill"; },
                build: (l) => ({ type: "kill", allPlayers: /true/i.test(l) }) },
            { key: "give", insert: "Game.give(", template: '5, "coins");', de: DESCRIPTIONS.give,
                match: (l) => { const c = gameCallArgs(l); return !!c && c.name === "give"; },
                build: (l) => { const c = gameCallArgs(l); const parts = splitArgs(c.args); return { type: "give", amount: num(parts[0], 0), currency: "coins", allPlayers: /true/i.test(l), duration: null }; } },
            { key: "move", insert: "Game.move(", template: "-84, 3);", de: DESCRIPTIONS.move,
                match: (l) => { const c = gameCallArgs(l); return !!c && c.name === "move"; },
                build: (l) => { const c = gameCallArgs(l); const parts = splitArgs(c.args); return { type: "move", dx: num(parts[0], 0), dy: num(parts[1], 0), duration: parseTrailingDuration(l) }; } },
            { key: "jump", insert: "Game.jump(", template: "15);", de: DESCRIPTIONS.jump,
                match: (l) => { const c = gameCallArgs(l); return !!c && c.name === "jump"; },
                build: (l) => { const c = gameCallArgs(l); const parts = splitArgs(c.args); return { type: "trampoline", power: Math.abs(num(parts[0], 15)), duration: null }; } },
            { key: "teleport", insert: "Game.teleport(", template: "10, 20);", de: DESCRIPTIONS.teleport,
                match: (l) => { const c = gameCallArgs(l); return !!c && c.name === "teleport"; },
                build: (l) => { const c = gameCallArgs(l); const parts = splitArgs(c.args); return { type: "teleport", allPlayers: /true/i.test(l), x: num(parts[0], 0), y: num(parts[1], 0), duration: null }; } },
            { key: "transparent", insert: "Game.transparent(", template: "50);", de: DESCRIPTIONS.transparent,
                match: (l) => { const c = gameCallArgs(l); return !!c && c.name === "transparent"; },
                build: (l) => { const c = gameCallArgs(l); const parts = splitArgs(c.args); return { type: "transparents", percent: num(parts[0], 100), duration: null }; } },
            { key: "set", insert: "Game.set(", template: '"score", 0);', de: DESCRIPTIONS.set,
                match: (l) => { const c = gameCallArgs(l); return !!c && c.name === "set"; },
                build: (l) => { const c = gameCallArgs(l); const parts = splitArgs(c.args); return { type: "set", varName: stripQuotes(parts[0]), value: num(parts[1], 0) }; } },
            { key: "change", insert: "Game.change(", template: '"score", 1);', de: DESCRIPTIONS.change,
                match: (l) => { const c = gameCallArgs(l); return !!c && c.name === "change"; },
                build: (l) => { const c = gameCallArgs(l); const parts = splitArgs(c.args); return { type: "change", varName: stripQuotes(parts[0]), value: num(parts[1], 0) }; } },
        ],
        duration: [
            { insert: ' for "15s"', label: "15 Sekunden", de: DESCRIPTIONS.duration },
            { insert: ' for "5m"', label: "5 Minuten", de: DESCRIPTIONS.duration },
            { insert: ' for "1h"', label: "1 Stunde", de: DESCRIPTIONS.duration },
        ],
        close: {
            solidInsert: "Game.solid();", passableInsert: "Game.passable();",
            solidDe: DESCRIPTIONS.solid, passableDe: DESCRIPTIONS.passable,
            match: (l) => { const c = gameCallArgs(l); if (!c) return null; if (c.name === "solid") return true; if (c.name === "passable") return false; return null; },
        },
        figuresOff: { insert: "Game.figuresOff();", match: (code) => /game\.figuresoff\(\s*\)\s*;/i.test(code || ""), de: DESCRIPTIONS.figuresOff },
        extraActionChips: [{ insert: "Game.kill(true);", label: "Game.kill(true);", de: DESCRIPTIONS.kill }],
    };

    const DIALECTS = { timeskipcode, html, python, csharp, javascript, java };

    function get(id) {
        return DIALECTS[id] || DIALECTS.python;
    }

    global.StudioDialects = {
        get,
        // timeskipcode is deliberately left out here -- it's no longer
        // offered anywhere a *new* choice is made (project creation, the
        // help page), only still parseable for projects that already used it.
        list: Object.values(DIALECTS).filter((d) => d.id !== "timeskipcode"),
        categoryLabels: {
            when: "Wann", condition: "Bedingung", action: "Aktion",
            variables: "Variablen", duration: "Dauer", end: "Ende",
            other: "Sonstiges", blocks: "Blöcke",
        },
    };
})(window);
