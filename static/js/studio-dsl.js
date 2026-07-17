// timeskip studio's block scripting language (v3 -- simple keyword form).
//
// Every real line starts with the (immutable) glyph "⇒" and a finished
// script ends with an immutable "⇓" line. Each rule is a fixed sequence
// of plain keyword lines, no "=" anywhere -- values are always quoted:
//   [⇒ WIEDERHOLEN]                    -- optional, repeats every frame
//   ⇒ BLOCK "Name"                      -- which block the rule is about
//   ⇒ WENN BERÜHRT | WENN KLICK | WENN IMMER
//   ⇒ <effect line, see below>
//   ⇒ FEST | DURCHLÄSSIG                -- solid, or players fall through
// FEST/DURCHLÄSSIG always closes a rule, so a script can chain several.
// Anywhere in the script: ⇒ FIGUREN AUS turns off the little player figure.
//
// Effects:
//   TÖTEN [ALLE]
//   GIB [ALLE] "+5" MÜNZEN
//   BEWEGEN X"-84" Y"+3" [IN "15" SEKUNDEN|MINUTEN|STUNDEN]
//   SPRUNG "15"
//   TELEPORT [ALLE] X"10" Y"20"
//   DURCHSICHTIG "50"
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
        const m = line.match(/IN\s*"(-?\d+(?:\.\d+)?)"\s*(SEKUNDEN|MINUTEN|STUNDEN)/i);
        if (!m) return null;
        const value = parseFloat(m[1]);
        const perUnit = { SEKUNDEN: 1000, MINUTEN: 60000, STUNDEN: 3600000 }[m[2].toUpperCase()];
        return Math.max(0, value * perUnit);
    }

    function parseEffectLine(line) {
        const upper = line.toUpperCase();
        const allPlayers = /\bALLE\b/i.test(line);

        if (upper.startsWith("TÖTEN") || upper.startsWith("TOETEN") || upper.startsWith("TOTEN")) {
            return { type: "kill", allPlayers };
        }
        if (upper.startsWith("GIB")) {
            const m = line.match(/"([-+]?\d+)"/);
            return {
                type: "give",
                amount: m ? parseInt(m[1], 10) : 0,
                currency: "coins",
                allPlayers,
                duration: null,
            };
        }
        if (upper.startsWith("BEWEGEN")) {
            return {
                type: "move",
                dx: quotedNumber(line, "X", 0),
                dy: quotedNumber(line, "Y", 0),
                duration: parseDuration(line),
            };
        }
        if (upper.startsWith("SPRUNG")) {
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
        if (upper.startsWith("DURCHSICHTIG")) {
            const m = line.match(/"(\d+(?:\.\d+)?)"/);
            return { type: "transparents", percent: m ? parseFloat(m[1]) : 100, duration: null };
        }
        return null;
    }

    function parseTrigger(line) {
        const upper = line.toUpperCase();
        if (/^WENN\s+BER[UÜ]HRT$/.test(upper)) return "touch";
        if (/^WENN\s+KLICK$/.test(upper)) return "click";
        if (/^WENN\s+IMMER$/.test(upper)) return "ambient";
        return null;
    }

    function parseStudioScript(code) {
        const lines = stripGlyphLines(code);
        const rules = [];
        let current = null;
        const fresh = () => ({ infinite: false, target: null, trigger: null, effect: null, canCollide: true });
        current = fresh();

        for (const line of lines) {
            const upper = line.toUpperCase();

            if (/^WIEDERHOLEN$/.test(upper)) {
                current.infinite = true;
                continue;
            }
            if (/^FIGUREN\s+AUS$/.test(upper)) {
                continue; // handled separately by scanning the raw script text
            }
            if (/^FEST$/.test(upper) || /^DURCHL[ÄA]SSIG$/.test(upper)) {
                current.canCollide = /^FEST$/.test(upper);
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
                current.effect = parseEffectLine(line);
            }
        }
        return rules;
    }

    function figuresDisabled(code) {
        return /FIGUREN\s+AUS/i.test(code || "");
    }

    global.StudioDSL = { parseStudioScript, stripGlyphLines, figuresDisabled };
})(window);
