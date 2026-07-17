// timeskip studio's block scripting language.
//
// Every real line starts with the (immutable) glyph "⇒" and a finished
// script ends with an immutable "⇓" line. Each rule is a fixed sequence:
//   [⇒ infinit.true]                 -- optional, repeats the effect every
//                                        frame instead of firing once
//   ⇒ "BlockName"=touch               -- which block, then when it fires:
//                                        touch, click, or "," for an
//                                        ambient rule that needs no player
//                                        action at all
//   ⇒ <effect> ...params...[=15sec.]  -- kill | give | move | trampoline |
//                                        teleport | transparents, optionally
//                                        followed by a duration (sec/min/
//                                        hour) -- e.g. how long a move
//                                        animates for
//   ⇒ canColide(.true|.false)
// canColide(...) always closes a rule, so a script can chain several rules.
// Quotes around block names, numbers, and other literal values are the
// intended style, but the parser accepts bare words too.
(function (global) {
    function stripGlyphLines(code) {
        return (code || "")
            .split("\n")
            .map((l) => l.replace(/^\s*⇒\s?/, "").trim())
            .filter((l) => l && l !== "⇓");
    }

    function unquote(str) {
        return String(str || "").trim().replace(/^["']|["']$/g, "");
    }

    function num(str, fallback) {
        const m = String(str).match(/[-+]?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : fallback;
    }

    function parseDurationMs(str) {
        const m = String(str).match(/([-+]?\d+(?:\.\d+)?)\s*(sec|min|hour)/i);
        if (!m) return null;
        const value = parseFloat(m[1]);
        const unit = m[2].toLowerCase();
        const perUnit = { sec: 1000, min: 60000, hour: 3600000 }[unit];
        return Math.max(0, value * perUnit);
    }

    function parseTrigger(raw) {
        const trimmed = String(raw || "").trim();
        if (trimmed === "," || trimmed === '","' || trimmed === '"' + "," + '"') return "ambient";
        if (/click/i.test(trimmed)) return "click";
        if (/touch/i.test(trimmed)) return "touch";
        return null;
    }

    // A combined "target=trigger" line, e.g. "Part1"=touch or "Part1"=,
    function parseTargetTriggerLine(line) {
        const eq = line.indexOf("=");
        if (eq === -1) return null;
        const target = unquote(line.slice(0, eq));
        const trigger = parseTrigger(line.slice(eq + 1));
        if (!target || !trigger) return null;
        return { target, trigger };
    }

    function parseEffectLine(line) {
        const duration = parseDurationMs(line);
        const body = duration === null ? line : line.slice(0, line.lastIndexOf("="));
        const lower = body.toLowerCase();
        const allPlayers = /allplayer/i.test(body);

        if (lower.startsWith("kill")) {
            return { type: "kill", allPlayers, duration };
        }
        if (lower.startsWith("give")) {
            const quoted = (body.match(/"([^"]*)"/g) || []).map((p) => p.replace(/"/g, ""));
            let amount = 0;
            let label = "";
            for (const part of quoted) {
                if (/^[-+]?\d+$/.test(part)) amount = parseInt(part, 10);
                else if (!/coin/i.test(part) && !label) label = part;
            }
            return { type: "give", amount, currency: "coins", label, allPlayers, duration };
        }
        if (lower.startsWith("move")) {
            const xMatch = body.match(/x\s*=\s*"?([-+]?\d+)"?/i);
            const yMatch = body.match(/y\s*=\s*"?([-+]?\d+)"?/i);
            return {
                type: "move",
                dx: xMatch ? parseInt(xMatch[1], 10) : 0,
                dy: yMatch ? parseInt(yMatch[1], 10) : 0,
                duration,
            };
        }
        if (lower.startsWith("trampoline")) {
            return { type: "trampoline", power: Math.abs(num(body, 15)), duration };
        }
        if (lower.startsWith("teleport")) {
            const xMatch = body.match(/x\s*=\s*"?([-+]?\d+)"?/i);
            const yMatch = body.match(/y\s*=\s*"?([-+]?\d+)"?/i);
            return {
                type: "teleport",
                allPlayers,
                x: xMatch ? parseInt(xMatch[1], 10) : 0,
                y: yMatch ? parseInt(yMatch[1], 10) : 0,
                duration,
            };
        }
        if (lower.startsWith("transparents")) {
            const pct = body.match(/(\d+)\s*%/);
            return { type: "transparents", percent: pct ? parseInt(pct[1], 10) : 100, duration };
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
                // Preferred style: "BlockName"=touch (target + trigger together).
                const combined = parseTargetTriggerLine(line);
                if (combined) {
                    current.target = combined.target;
                    current.trigger = combined.trigger;
                } else {
                    current.target = unquote(line);
                }
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

    global.StudioDSL = { parseStudioScript, stripGlyphLines };
})(window);
