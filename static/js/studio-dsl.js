// timeskip studio's scripting engine. The actual keyword syntax is defined
// per-language-dialect in studio-dialects.js (timeskipcode by default, plus
// HTML/Python/C#-flavoured alternatives) -- this file only knows the parts
// that are the same across every dialect:
//
// Every real line starts with the (immutable) glyph "⇒" and a finished
// script ends with an immutable "⇓" line. Each rule is:
//   [⇒ <repeat>]                 -- optional, repeats every frame
//   ⇒ <block reference>          -- which block the rule is about
//   ⇒ <trigger>                  -- touched | clicked | always
//   [⇒ <condition>]              -- optional, only fires if true
//   ⇒ <effect line>
//   ⇒ <close: solid | passable>  -- closes the rule
// Anywhere in the script, a dialect-specific "figures off" line/marker turns
// off the little player figure.
(function (global) {
    function stripGlyphLines(code) {
        return (code || "")
            .split("\n")
            .map((l) => l.replace(/^\s*⇒\s?/, "").trim())
            .filter((l) => l && l !== "⇓");
    }

    function parseStudioScript(code, language) {
        const dialect = global.StudioDialects.get(language);
        const lines = stripGlyphLines(code);
        const rules = [];
        const fresh = () => ({
            infinite: false, target: null, trigger: null, condition: null, effect: null, canCollide: true,
        });
        let current = fresh();

        for (const line of lines) {
            if (dialect.repeat.match(line)) {
                current.infinite = true;
                continue;
            }
            const closeVal = dialect.close.match(line);
            if (closeVal !== null) {
                current.canCollide = closeVal;
                if (current.target && current.trigger && current.effect) rules.push(current);
                current = fresh();
                continue;
            }
            if (!current.target) {
                const name = dialect.block.match(line);
                if (name !== null) current.target = name;
                continue;
            }
            if (!current.trigger) {
                const trig = dialect.triggers.find((t) => t.match(line));
                if (trig) current.trigger = trig.type;
                continue;
            }
            if (!current.effect) {
                const cond = dialect.matchCondition(line);
                if (cond) {
                    current.condition = cond;
                    continue;
                }
                const eff = dialect.effects.find((e) => e.match(line));
                if (eff) current.effect = eff.build(line);
            }
        }
        return rules;
    }

    function figuresDisabled(code, language) {
        const dialect = global.StudioDialects.get(language);
        return dialect.figuresOff.match(code || "");
    }

    global.StudioDSL = { parseStudioScript, stripGlyphLines, figuresDisabled };
})(window);
