// timeskip studio's scripting language (v4 -- English, with variables and
// conditions).
//
// Every real line starts with the (immutable) glyph "⇒" and a finished
// script ends with an immutable "⇓" line. Each rule is a sequence of plain
// keyword lines, no "=" anywhere -- values are always quoted:
//   [⇒ REPEAT]                          -- optional, repeats every frame
//   ⇒ BLOCK "Name"                       -- which block the rule is about
//   ⇒ WHEN TOUCHED | WHEN CLICKED | WHEN ALWAYS
//   [⇒ IF "varName" > "10"]              -- optional, only fires if true
//   ⇒ <effect line, see below>
//   ⇒ SOLID | PASSABLE                   -- closes the rule
// Anywhere in the script: ⇒ FIGURES OFF turns off the little player figure.
//
// Effects:
//   KILL [ALL]
//   GIVE [ALL] "+5" COINS
//   MOVE X"-84" Y"+3" [IN "15" SECONDS|MINUTES|HOURS]
//   JUMP "15"
//   TELEPORT [ALL] X"10" Y"20"
//   TRANSPARENT "50"
//   SET "varName" TO "10"
//   CHANGE "varName" BY "+5"
(function (global) {
    function stripGlyphLines(code) {
        return (code || "")
            .split("\n")
            .map((l) => l.replace(/^\s*⇒\s?/, "").trim())
            .filter((l) => l && l !== "⇓");
    }

    function quoted(line, key) {
        const m = line.match(new RegExp("\\b" + key + '\\s*"([^"]*)"', "i"));
        return m ? m[1] : null;
    }

    function quotedNumber(line, key, fallback) {
        const v = quoted(line, key);
        if (v === null) return fallback;
        const n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    }

    function parseDuration(line) {
        const m = line.match(/IN\s*"(-?\d+(?:\.\d+)?)"\s*(SECONDS|MINUTES|HOURS)/i);
        if (!m) return null;
        const value = parseFloat(m[1]);
        const perUnit = { SECONDS: 1000, MINUTES: 60000, HOURS: 3600000 }[m[2].toUpperCase()];
        return Math.max(0, value * perUnit);
    }

    function parseCondition(line) {
        const m = line.match(/^IF\s+"([^"]*)"\s*(>=|<=|!=|>|<|=)\s*"(-?\d+(?:\.\d+)?)"$/i);
        if (!m) return null;
        return { varName: m[1], operator: m[2], value: parseFloat(m[3]) };
    }

    function parseEffectLine(line) {
        const upper = line.toUpperCase();
        const allPlayers = /\bALL\b/i.test(line);

        if (upper.startsWith("KILL")) {
            return { type: "kill", allPlayers };
        }
        if (upper.startsWith("GIVE")) {
            const m = line.match(/"([-+]?\d+)"/);
            return {
                type: "give",
                amount: m ? parseInt(m[1], 10) : 0,
                currency: "coins",
                allPlayers,
                duration: null,
            };
        }
        if (upper.startsWith("MOVE")) {
            return {
                type: "move",
                dx: quotedNumber(line, "X", 0),
                dy: quotedNumber(line, "Y", 0),
                duration: parseDuration(line),
            };
        }
        if (upper.startsWith("JUMP")) {
            const m = line.match(/"(-?\d+(?:\.\d+)?)"/);
            return { type: "trampoline", power: m ? Math.abs(parseFloat(m[1])) : 15, duration: null };
        }
        if (upper.startsWith("TELEPORT")) {
            return {
                type: "teleport",
                allPlayers,
                x: quotedNumber(line, "X", 0),
                y: quotedNumber(line, "Y", 0),
                duration: null,
            };
        }
        if (upper.startsWith("TRANSPARENT")) {
            const m = line.match(/"(\d+(?:\.\d+)?)"/);
            return { type: "transparents", percent: m ? parseFloat(m[1]) : 100, duration: null };
        }
        if (upper.startsWith("SET")) {
            const name = quoted(line, "SET");
            const value = quotedNumber(line, "TO", 0);
            return { type: "set", varName: name, value };
        }
        if (upper.startsWith("CHANGE")) {
            const name = quoted(line, "CHANGE");
            const value = quotedNumber(line, "BY", 0);
            return { type: "change", varName: name, value };
        }
        return null;
    }

    function parseTrigger(line) {
        const upper = line.toUpperCase();
        if (/^WHEN\s+TOUCHED$/.test(upper)) return "touch";
        if (/^WHEN\s+CLICKED$/.test(upper)) return "click";
        if (/^WHEN\s+ALWAYS$/.test(upper)) return "ambient";
        return null;
    }

    function parseStudioScript(code) {
        const lines = stripGlyphLines(code);
        const rules = [];
        let current = null;
        const fresh = () => ({
            infinite: false, target: null, trigger: null, condition: null, effect: null, canCollide: true,
        });
        current = fresh();

        for (const line of lines) {
            const upper = line.toUpperCase();

            if (/^REPEAT$/.test(upper)) {
                current.infinite = true;
                continue;
            }
            if (/^FIGURES\s+OFF$/.test(upper)) {
                continue; // handled separately by scanning the raw script text
            }
            if (/^SOLID$/.test(upper) || /^PASSABLE$/.test(upper)) {
                current.canCollide = /^SOLID$/.test(upper);
                if (current.target && current.trigger && current.effect) rules.push(current);
                current = fresh();
                continue;
            }
            if (!current.target) {
                const name = quoted(line, "BLOCK");
                if (name !== null) current.target = name;
                continue;
            }
            if (!current.trigger) {
                current.trigger = parseTrigger(line);
                continue;
            }
            if (!current.effect) {
                if (/^IF\s/i.test(line)) {
                    current.condition = parseCondition(line);
                    continue;
                }
                current.effect = parseEffectLine(line);
            }
        }
        return rules;
    }

    function figuresDisabled(code) {
        return /FIGURES\s+OFF/i.test(code || "");
    }

    global.StudioDSL = { parseStudioScript, stripGlyphLines, figuresDisabled };
})(window);
