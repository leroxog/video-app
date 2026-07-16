// timeskip studio's block scripting language.
//
// Every real line starts with the (immutable) glyph "⇒" and a finished
// script ends with an immutable "⇓" line. Each rule is a fixed sequence:
//   [⇒ infinit.true]      -- optional, repeats the effect every frame
//   ⇒ <target block name>
//   ⇒ touch | click
//   ⇒ <effect: kill | give | move | trampoline | teleport | transparents>
//   ⇒ canColide(.true|.false)
// canColide(...) always closes a rule, so a script can chain several rules.
(function (global) {
    function stripGlyphLines(code) {
        return (code || "")
            .split("\n")
            .map((l) => l.replace(/^\s*⇒\s?/, "").trim())
            .filter((l) => l && l !== "⇓");
    }

    function num(str, fallback) {
        const m = String(str).match(/[-+]?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : fallback;
    }

    function parseEffectLine(line) {
        const lower = line.toLowerCase();
        const allPlayers = /allplayer/i.test(line);
        if (lower.startsWith("kill")) {
            return { type: "kill", allPlayers };
        }
        if (lower.startsWith("give")) {
            const quoted = (line.match(/"([^"]*)"/g) || []).map((p) => p.replace(/"/g, ""));
            let amount = 0;
            let label = "";
            for (const part of quoted) {
                if (/^[-+]?\d+$/.test(part)) amount = parseInt(part, 10);
                else if (!/coin/i.test(part) && !label) label = part;
            }
            return { type: "give", amount, currency: "coins", label, allPlayers };
        }
        if (lower.startsWith("move")) {
            const xMatch = line.match(/x\s*=\s*"?([-+]?\d+)"?/i);
            const yMatch = line.match(/y\s*=\s*"?([-+]?\d+)"?/i);
            return { type: "move", dx: xMatch ? parseInt(xMatch[1], 10) : 0, dy: yMatch ? parseInt(yMatch[1], 10) : 0 };
        }
        if (lower.startsWith("trampoline")) {
            return { type: "trampoline", power: Math.abs(num(line, 15)) };
        }
        if (lower.startsWith("teleport")) {
            const xMatch = line.match(/x\s*=\s*"?([-+]?\d+)"?/i);
            const yMatch = line.match(/y\s*=\s*"?([-+]?\d+)"?/i);
            return {
                type: "teleport",
                allPlayers,
                x: xMatch ? parseInt(xMatch[1], 10) : 0,
                y: yMatch ? parseInt(yMatch[1], 10) : 0,
            };
        }
        if (lower.startsWith("transparents")) {
            const pct = line.match(/(\d+)\s*%/);
            return { type: "transparents", percent: pct ? parseInt(pct[1], 10) : 100 };
        }
        return null;
    }

    function parseStudioScript(code) {
        const lines = stripGlyphLines(code);
        const rules = [];
        let current = null;
        const fresh = () => ({ infinite: false, target: null, trigger: null, effect: null, canCollide: true });
        current = fresh();

        for (const line of lines) {
            if (/^infinit\.true$/i.test(line)) {
                current.infinite = true;
                continue;
            }
            const collide = line.match(/canColide\s*\(\s*\.?(true|false)\s*\)/i);
            if (collide) {
                current.canCollide = collide[1].toLowerCase() === "true";
                if (current.target && current.trigger && current.effect) rules.push(current);
                current = fresh();
                continue;
            }
            if (!current.target) {
                current.target = line.replace(/^["']|["']$/g, "");
                continue;
            }
            if (!current.trigger) {
                if (/touch/i.test(line)) current.trigger = "touch";
                else if (/click/i.test(line)) current.trigger = "click";
                continue;
            }
            if (!current.effect) {
                current.effect = parseEffectLine(line);
            }
        }
        return rules;
    }

    global.StudioDSL = { parseStudioScript, stripGlyphLines };
})(window);
