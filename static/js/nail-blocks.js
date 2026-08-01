// NAIL (Nex AI Learning) block definitions -- the vocabulary both the
// editor (palette + canvas) and the runtime (interpreter) share. Each
// entry describes one draggable block: which category/color it belongs
// to, its shape (how it connects to others), the label with embedded
// input slots, and the inputs' own type/default. This mirrors what a
// real Scratch block definition carries, just in plain JSON instead of
// Blockly's XML.
//
// shape:
//   "hat"     - event block, sits at the top of a script, no top connector
//   "stack"   - a normal command block, connects above and below
//   "c"       - a stack block that also wraps a nested body (repeat/if/...)
//   "cap"     - a stack block with nothing allowed below it (stop all)
//   "boolean" - hexagonal, plugs into a boolean input slot, returns true/false
//   "reporter"- rounded oval, plugs into a value input slot, returns a value
//
// label is an array of strings and {input} placeholders, e.g.
//   ["gehe", {input: "steps", type: "number", default: 10}, "er Schritte"]
(function () {
    const CATEGORIES = [
        { key: "motion", name: "Bewegung", color: "#4C97FF" },
        { key: "looks", name: "Aussehen", color: "#9966FF" },
        { key: "sound", name: "Klang", color: "#D65CD6" },
        { key: "events", name: "Ereignisse", color: "#FFBF00" },
        { key: "control", name: "Steuerung", color: "#FFAB19" },
        { key: "sensing", name: "Fühlen", color: "#5CB1D6" },
        { key: "operators", name: "Operatoren", color: "#59C059" },
        { key: "variables", name: "Variablen", color: "#FF8C1A" },
    ];

    const BLOCKS = [
        // --- Bewegung ---
        { type: "motion_move_steps", category: "motion", shape: "stack",
            label: ["gehe", { input: "steps", type: "number", default: 10 }, "er Schritte"] },
        { type: "motion_turn_right", category: "motion", shape: "stack",
            label: ["drehe dich ↻ um", { input: "degrees", type: "number", default: 15 }, "Grad"] },
        { type: "motion_turn_left", category: "motion", shape: "stack",
            label: ["drehe dich ↺ um", { input: "degrees", type: "number", default: 15 }, "Grad"] },
        { type: "motion_go_to_random", category: "motion", shape: "stack",
            label: ["gehe zu Zufallsposition"] },
        { type: "motion_go_to_xy", category: "motion", shape: "stack",
            label: ["gehe zu x:", { input: "x", type: "number", default: 0 }, "y:", { input: "y", type: "number", default: 0 }] },
        { type: "motion_glide_to_xy", category: "motion", shape: "stack",
            label: ["gleite in", { input: "secs", type: "number", default: 1 }, "Sek. zu x:", { input: "x", type: "number", default: 0 }, "y:", { input: "y", type: "number", default: 0 }] },
        { type: "motion_point_direction", category: "motion", shape: "stack",
            label: ["setze Richtung auf", { input: "direction", type: "number", default: 90 }, "Grad"] },
        { type: "motion_change_x", category: "motion", shape: "stack",
            label: ["ändere x um", { input: "dx", type: "number", default: 10 }] },
        { type: "motion_set_x", category: "motion", shape: "stack",
            label: ["setze x auf", { input: "x", type: "number", default: 0 }] },
        { type: "motion_change_y", category: "motion", shape: "stack",
            label: ["ändere y um", { input: "dy", type: "number", default: 10 }] },
        { type: "motion_set_y", category: "motion", shape: "stack",
            label: ["setze y auf", { input: "y", type: "number", default: 0 }] },
        { type: "motion_bounce_edge", category: "motion", shape: "stack",
            label: ["pralle vom Rand ab"] },
        { type: "motion_x_position", category: "motion", shape: "reporter", label: ["x-Position"] },
        { type: "motion_y_position", category: "motion", shape: "reporter", label: ["y-Position"] },
        { type: "motion_direction", category: "motion", shape: "reporter", label: ["Richtung"] },

        // --- Aussehen ---
        { type: "looks_say_for", category: "looks", shape: "stack",
            label: ["sage", { input: "text", type: "text", default: "Hallo!" }, "für", { input: "secs", type: "number", default: 2 }, "Sekunden"] },
        { type: "looks_say", category: "looks", shape: "stack",
            label: ["sage", { input: "text", type: "text", default: "Hallo!" }] },
        { type: "looks_think_for", category: "looks", shape: "stack",
            label: ["denke", { input: "text", type: "text", default: "Hmm..." }, "für", { input: "secs", type: "number", default: 2 }, "Sekunden"] },
        { type: "looks_think", category: "looks", shape: "stack",
            label: ["denke", { input: "text", type: "text", default: "Hmm..." }] },
        { type: "looks_change_size", category: "looks", shape: "stack",
            label: ["ändere Größe um", { input: "delta", type: "number", default: 10 }] },
        { type: "looks_set_size", category: "looks", shape: "stack",
            label: ["setze Größe auf", { input: "size", type: "number", default: 100 }, "%"] },
        { type: "looks_show", category: "looks", shape: "stack", label: ["zeige dich"] },
        { type: "looks_hide", category: "looks", shape: "stack", label: ["verstecke dich"] },
        { type: "looks_size", category: "looks", shape: "reporter", label: ["Größe"] },

        // --- Klang (palette-only for v1, see nail-runtime.js) ---
        { type: "sound_play", category: "sound", shape: "stack", label: ["spiele Klang", { input: "sound", type: "text", default: "Miau" }] },
        { type: "sound_change_volume", category: "sound", shape: "stack", label: ["ändere Lautstärke um", { input: "delta", type: "number", default: -10 }] },
        { type: "sound_set_volume", category: "sound", shape: "stack", label: ["setze Lautstärke auf", { input: "volume", type: "number", default: 100 }, "%"] },
        { type: "sound_volume", category: "sound", shape: "reporter", label: ["Lautstärke"] },

        // --- Ereignisse ---
        { type: "event_flag_clicked", category: "events", shape: "hat", label: ["wenn", "⚑", "angeklickt wird"] },
        { type: "event_key_pressed", category: "events", shape: "hat",
            label: ["wenn Taste", { input: "key", type: "select", options: ["Leertaste", "Pfeil hoch", "Pfeil runter", "Pfeil links", "Pfeil rechts", "a", "b", "c"], default: "Leertaste" }, "gedrückt wird"] },
        { type: "event_sprite_clicked", category: "events", shape: "hat", label: ["wenn diese Figur angeklickt wird"] },
        { type: "event_broadcast", category: "events", shape: "stack",
            label: ["sende", { input: "message", type: "text", default: "Nachricht1" }, "an alle"] },
        { type: "event_when_broadcast", category: "events", shape: "hat",
            label: ["wenn ich", { input: "message", type: "text", default: "Nachricht1" }, "empfange"] },

        // --- Steuerung ---
        { type: "control_wait", category: "control", shape: "stack",
            label: ["warte", { input: "secs", type: "number", default: 1 }, "Sekunden"] },
        { type: "control_repeat", category: "control", shape: "c",
            label: ["wiederhole", { input: "times", type: "number", default: 10 }, "mal"] },
        { type: "control_forever", category: "control", shape: "c", label: ["wiederhole fortlaufend"] },
        { type: "control_if", category: "control", shape: "c",
            label: ["falls", { input: "condition", type: "boolean" }, "dann"] },
        { type: "control_if_else", category: "control", shape: "c2",
            label: ["falls", { input: "condition", type: "boolean" }, "dann", "sonst"] },
        { type: "control_wait_until", category: "control", shape: "stack",
            label: ["warte bis", { input: "condition", type: "boolean" }] },
        { type: "control_repeat_until", category: "control", shape: "c",
            label: ["wiederhole bis", { input: "condition", type: "boolean" }] },
        { type: "control_stop_all", category: "control", shape: "cap", label: ["stoppe alles"] },

        // --- Fühlen ---
        { type: "sensing_touching_mouse", category: "sensing", shape: "boolean", label: ["wird Mauszeiger berührt?"] },
        { type: "sensing_touching_edge", category: "sensing", shape: "boolean", label: ["wird Rand berührt?"] },
        { type: "sensing_ask", category: "sensing", shape: "stack",
            label: ["frage", { input: "question", type: "text", default: "Wie heißt du?" }, "und warte"] },
        { type: "sensing_answer", category: "sensing", shape: "reporter", label: ["Antwort"] },
        { type: "sensing_key_pressed", category: "sensing", shape: "boolean",
            label: ["Taste", { input: "key", type: "select", options: ["Leertaste", "Pfeil hoch", "Pfeil runter", "Pfeil links", "Pfeil rechts", "a", "b", "c"], default: "Leertaste" }, "gedrückt?"] },
        { type: "sensing_mouse_down", category: "sensing", shape: "boolean", label: ["Maustaste gedrückt?"] },
        { type: "sensing_mouse_x", category: "sensing", shape: "reporter", label: ["Maus x-Position"] },
        { type: "sensing_mouse_y", category: "sensing", shape: "reporter", label: ["Maus y-Position"] },
        { type: "sensing_timer", category: "sensing", shape: "reporter", label: ["Stoppuhr"] },
        { type: "sensing_reset_timer", category: "sensing", shape: "stack", label: ["setze Stoppuhr zurück"] },

        // --- Operatoren ---
        { type: "op_add", category: "operators", shape: "reporter",
            label: [{ input: "a", type: "number", default: "" }, "+", { input: "b", type: "number", default: "" }] },
        { type: "op_sub", category: "operators", shape: "reporter",
            label: [{ input: "a", type: "number", default: "" }, "-", { input: "b", type: "number", default: "" }] },
        { type: "op_mul", category: "operators", shape: "reporter",
            label: [{ input: "a", type: "number", default: "" }, "×", { input: "b", type: "number", default: "" }] },
        { type: "op_div", category: "operators", shape: "reporter",
            label: [{ input: "a", type: "number", default: "" }, "/", { input: "b", type: "number", default: "" }] },
        { type: "op_random", category: "operators", shape: "reporter",
            label: ["Zufallszahl von", { input: "from", type: "number", default: 1 }, "bis", { input: "to", type: "number", default: 10 }] },
        { type: "op_gt", category: "operators", shape: "boolean",
            label: [{ input: "a", type: "number", default: "" }, ">", { input: "b", type: "number", default: 50 }] },
        { type: "op_lt", category: "operators", shape: "boolean",
            label: [{ input: "a", type: "number", default: "" }, "<", { input: "b", type: "number", default: 50 }] },
        { type: "op_eq", category: "operators", shape: "boolean",
            label: [{ input: "a", type: "number", default: "" }, "=", { input: "b", type: "number", default: 50 }] },
        { type: "op_and", category: "operators", shape: "boolean",
            label: [{ input: "a", type: "boolean" }, "und", { input: "b", type: "boolean" }] },
        { type: "op_or", category: "operators", shape: "boolean",
            label: [{ input: "a", type: "boolean" }, "oder", { input: "b", type: "boolean" }] },
        { type: "op_not", category: "operators", shape: "boolean",
            label: ["nicht", { input: "a", type: "boolean" }] },
        { type: "op_join", category: "operators", shape: "reporter",
            label: ["verbinde", { input: "a", type: "text", default: "Apfel" }, "und", { input: "b", type: "text", default: "Banane" }] },
        { type: "op_length", category: "operators", shape: "reporter",
            label: ["Länge von", { input: "a", type: "text", default: "Apfel" }] },
        { type: "op_contains", category: "operators", shape: "boolean",
            label: [{ input: "a", type: "text", default: "Apfel" }, "enthält", { input: "b", type: "text", default: "a" }, "?"] },
        { type: "op_mod", category: "operators", shape: "reporter",
            label: [{ input: "a", type: "number", default: "" }, "mod", { input: "b", type: "number", default: "" }] },
        { type: "op_round", category: "operators", shape: "reporter",
            label: [{ input: "a", type: "number", default: "" }, "gerundet"] },

        // --- Variablen (custom variables are added dynamically, see
        // nail-editor.js's refreshVariableBlocks) ---
        { type: "var_set", category: "variables", shape: "stack",
            label: ["setze", { input: "name", type: "variable" }, "auf", { input: "value", type: "number", default: 0 }] },
        { type: "var_change", category: "variables", shape: "stack",
            label: ["ändere", { input: "name", type: "variable" }, "um", { input: "value", type: "number", default: 1 }] },
        { type: "var_show", category: "variables", shape: "stack",
            label: ["zeige Variable", { input: "name", type: "variable" }] },
        { type: "var_hide", category: "variables", shape: "stack",
            label: ["verstecke Variable", { input: "name", type: "variable" }] },
    ];

    const BLOCKS_BY_TYPE = {};
    BLOCKS.forEach((b) => { BLOCKS_BY_TYPE[b.type] = b; });

    window.NailBlocks = { CATEGORIES, BLOCKS, BLOCKS_BY_TYPE };
})();
