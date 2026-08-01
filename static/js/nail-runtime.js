// NAIL runtime -- a real, working interpreter for the block trees the
// editor builds (see nail-editor.js) and saves as project_json. Used by
// both the editor's green-flag button and the standalone play page.
//
// Each running script is a JS generator (see runBlock()); the scheduler
// advances every active generator by one step per animation frame, which
// is what lets "wiederhole"/"warte" pause a script without blocking the
// browser tab or every other running script -- the same cooperative,
// round-robin model Scratch's own VM uses, just far simpler.
//
// Every command/reporter block runs against a "ctx" ({sprite: ...}) --
// threading that through (rather than closing over one shared sprite
// variable) is what lets clones (control_create_clone) run their own
// independent scripts against their own x/y/costume/etc. state.
(function () {
    function clampDirection(deg) {
        let d = deg % 360;
        if (d <= -180) d += 360;
        if (d > 180) d -= 360;
        return d;
    }

    function toNumber(value) {
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : 0;
    }

    const BACKDROPS = ["Weiß", "Himmel", "Wiese", "Nacht"];
    const COSTUMES = ["Roboter 1", "Roboter 2", "Roboter 3"];

    function freshSprite() {
        return {
            x: 0, y: 0, direction: 90, size: 100, visible: true, say: null, think: null,
            costumeIndex: 0, colorEffect: 0, ghostEffect: 0, volume: 100, soundPitch: 100,
            draggable: false,
        };
    }

    function createEngine(options) {
        const {
            stageWidth = 480, stageHeight = 360,
            onStateChange, // (mainSprite, variables, extras) => void
            onStop, // () => void, called once every script has finished/been stopped
            username = "",
        } = options;

        let project = { variables: {}, lists: {}, sprite: {}, scripts: [] };
        let sprite = freshSprite();
        let variables = {};
        let lists = {};
        let shownVariables = new Set();
        let shownLists = new Set();
        let backdropIndex = 0;
        let timerStart = Date.now();
        let answer = "";
        let running = false;
        let activeThreads = []; // [{gen, ctx}]
        let keysDown = new Set();
        let mouseDown = false;
        let mousePos = { x: 0, y: 0 };
        let broadcastListeners = {}; // message -> [{hat, ctx}]
        let broadcastQueue = [];
        let backdropSwitchListeners = {}; // backdropName -> [hat]
        let rafHandle = null;
        let nextCloneId = 1;
        let clones = []; // [{id, sprite}]
        let audioCtx = null;
        let activeAudioNodes = [];

        function loadProject(newProject) {
            stopAll();
            project = newProject && typeof newProject === "object" ? newProject : { variables: {}, lists: {}, sprite: {}, scripts: [] };
            variables = Object.assign({}, project.variables || {});
            lists = {};
            Object.keys(project.lists || {}).forEach((name) => { lists[name] = (project.lists[name] || []).slice(); });
            sprite = Object.assign(freshSprite(), project.sprite || {});
            backdropIndex = 0;
            clones = [];
            shownVariables = new Set();
            shownLists = new Set();
            notify();
        }

        function notify() {
            if (onStateChange) {
                onStateChange(sprite, variables, {
                    lists, clones, backdropIndex, shownVariables, shownLists,
                });
            }
        }

        function getVariable(name) {
            return Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : 0;
        }
        function setVariable(name, value) {
            variables[name] = value;
            notify();
        }
        function getList(name) {
            if (!lists[name]) lists[name] = [];
            return lists[name];
        }

        // ---------- Sound: real, synthesized (no uploaded-asset system in
        // NAIL yet, so each preset name maps to a short, honest synthesized
        // tone/noise instead of a fake silent no-op). ----------
        function getAudioContext() {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return null;
            if (!audioCtx) audioCtx = new Ctx();
            if (audioCtx.state === "suspended") audioCtx.resume();
            return audioCtx;
        }
        const SOUND_PRESETS = {
            "Miau": { freq: 660, type: "sine", duration: 0.35, slideTo: 880 },
            "Pop": { freq: 500, type: "triangle", duration: 0.12 },
            "Piep": { freq: 1200, type: "square", duration: 0.15 },
            "Trommel": { freq: 110, type: "sawtooth", duration: 0.2 },
        };
        function playSoundNamed(name, ctxSprite) {
            const ctx = getAudioContext();
            if (!ctx) return 0;
            const preset = SOUND_PRESETS[name] || SOUND_PRESETS.Pop;
            const pitchMul = Math.max(0.1, (ctxSprite.soundPitch || 100) / 100);
            const gainVal = Math.max(0, Math.min(1, (ctxSprite.volume === undefined ? 100 : ctxSprite.volume) / 100)) * 0.18;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = preset.type;
            const start = ctx.currentTime;
            osc.frequency.setValueAtTime(preset.freq * pitchMul, start);
            if (preset.slideTo) osc.frequency.linearRampToValueAtTime(preset.slideTo * pitchMul, start + preset.duration);
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(gainVal, start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + preset.duration);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + preset.duration + 0.02);
            activeAudioNodes.push(osc);
            osc.onended = () => { activeAudioNodes = activeAudioNodes.filter((n) => n !== osc); };
            return preset.duration;
        }
        function stopAllSounds() {
            activeAudioNodes.forEach((osc) => { try { osc.stop(); } catch (e) { /* already stopped */ } });
            activeAudioNodes = [];
        }

        // Evaluates one input slot: either a literal (number/string) or a
        // nested reporter/boolean block ({blockRef: {...}}) -- recursing
        // naturally handles arbitrarily deep composition like (1 + 2) * 3.
        function evalInput(inputs, name, fallback, ctx) {
            if (!inputs || !(name in inputs)) return fallback;
            const raw = inputs[name];
            if (raw && typeof raw === "object" && raw.blockRef) {
                return evalReporter(raw.blockRef, ctx);
            }
            return raw;
        }
        function evalNumberInput(inputs, name, fallback, ctx) {
            return toNumber(evalInput(inputs, name, fallback, ctx));
        }
        function evalBooleanInput(inputs, name, ctx) {
            const v = evalInput(inputs, name, false, ctx);
            return v === true || v === "true" || (typeof v === "number" && v !== 0);
        }

        function distanceTo(a, b) {
            const dx = a.x - b.x, dy = a.y - b.y;
            return Math.sqrt(dx * dx + dy * dy);
        }

        function evalReporter(block, ctx) {
            if (!block) return 0;
            const inputs = block.inputs || {};
            const s = ctx.sprite;
            switch (block.type) {
                case "motion_x_position": return s.x;
                case "motion_y_position": return s.y;
                case "motion_direction": return s.direction;
                case "looks_size": return s.size;
                case "looks_costume_number": return s.costumeIndex + 1;
                case "looks_backdrop_number": return backdropIndex + 1;
                case "sound_volume": return s.volume === undefined ? 100 : s.volume;
                case "sensing_answer": return answer;
                case "sensing_mouse_x": return mousePos.x;
                case "sensing_mouse_y": return mousePos.y;
                case "sensing_distance_to_mouse": return distanceTo(s, mousePos);
                case "sensing_timer": return (Date.now() - timerStart) / 1000;
                case "sensing_backdrop_number_of_stage": return backdropIndex + 1;
                case "sensing_current_year": return new Date().getFullYear();
                case "sensing_days_since_2000": return Math.floor((Date.now() - Date.UTC(2000, 0, 1)) / 86400000);
                case "sensing_online": return typeof navigator !== "undefined" ? !!navigator.onLine : true;
                case "sensing_username": return username || "";
                case "sensing_touching_mouse": return distanceTo(s, mousePos) < 40 * (s.size / 100);
                case "sensing_touching_edge":
                    return Math.abs(s.x) > stageWidth / 2 - 20 || Math.abs(s.y) > stageHeight / 2 - 20;
                case "sensing_touching_color":
                    return BACKDROPS[backdropIndex] === evalInput(inputs, "color", "Weiß", ctx);
                case "sensing_key_pressed":
                    return keysDown.has(evalInput(inputs, "key", "Leertaste", ctx));
                case "sensing_mouse_down": return mouseDown;
                case "op_add": return evalNumberInput(inputs, "a", 0, ctx) + evalNumberInput(inputs, "b", 0, ctx);
                case "op_sub": return evalNumberInput(inputs, "a", 0, ctx) - evalNumberInput(inputs, "b", 0, ctx);
                case "op_mul": return evalNumberInput(inputs, "a", 0, ctx) * evalNumberInput(inputs, "b", 0, ctx);
                case "op_div": {
                    const b = evalNumberInput(inputs, "b", 0, ctx);
                    return b === 0 ? 0 : evalNumberInput(inputs, "a", 0, ctx) / b;
                }
                case "op_mod": {
                    const b = evalNumberInput(inputs, "b", 0, ctx);
                    return b === 0 ? 0 : evalNumberInput(inputs, "a", 0, ctx) % b;
                }
                case "op_round": return Math.round(evalNumberInput(inputs, "a", 0, ctx));
                case "op_letter_of": {
                    const text = String(evalInput(inputs, "text", "", ctx));
                    const idx = Math.round(evalNumberInput(inputs, "index", 1, ctx)) - 1;
                    return (idx >= 0 && idx < text.length) ? text[idx] : "";
                }
                case "op_math": {
                    const a = evalNumberInput(inputs, "a", 0, ctx);
                    const fn = evalInput(inputs, "fn", "Betrag", ctx);
                    switch (fn) {
                        case "abrunden": return Math.floor(a);
                        case "aufrunden": return Math.ceil(a);
                        case "Quadratwurzel": return a < 0 ? 0 : Math.sqrt(a);
                        case "sin": return Math.round(Math.sin(a * Math.PI / 180) * 1000) / 1000;
                        case "cos": return Math.round(Math.cos(a * Math.PI / 180) * 1000) / 1000;
                        default: return Math.abs(a);
                    }
                }
                case "op_random": {
                    const from = evalNumberInput(inputs, "from", 1, ctx), to = evalNumberInput(inputs, "to", 10, ctx);
                    const lo = Math.min(from, to), hi = Math.max(from, to);
                    return Math.round(lo + Math.random() * (hi - lo));
                }
                case "op_gt": return evalNumberInput(inputs, "a", 0, ctx) > evalNumberInput(inputs, "b", 0, ctx);
                case "op_lt": return evalNumberInput(inputs, "a", 0, ctx) < evalNumberInput(inputs, "b", 0, ctx);
                case "op_eq": return String(evalInput(inputs, "a", "", ctx)) === String(evalInput(inputs, "b", "", ctx));
                case "op_and": return evalBooleanInput(inputs, "a", ctx) && evalBooleanInput(inputs, "b", ctx);
                case "op_or": return evalBooleanInput(inputs, "a", ctx) || evalBooleanInput(inputs, "b", ctx);
                case "op_not": return !evalBooleanInput(inputs, "a", ctx);
                case "op_join": return `${evalInput(inputs, "a", "", ctx)}${evalInput(inputs, "b", "", ctx)}`;
                case "op_length": return String(evalInput(inputs, "a", "", ctx)).length;
                case "op_contains":
                    return String(evalInput(inputs, "a", "", ctx)).toLowerCase()
                        .includes(String(evalInput(inputs, "b", "", ctx)).toLowerCase());
                case "var_get": return getVariable(inputs.name);
                case "list_item": {
                    const list = getList(inputs.list);
                    const idx = Math.round(evalNumberInput(inputs, "index", 1, ctx)) - 1;
                    return (idx >= 0 && idx < list.length) ? list[idx] : "";
                }
                case "list_length": return getList(inputs.list).length;
                case "list_contains":
                    return getList(inputs.list).map(String).includes(String(evalInput(inputs, "item", "", ctx)));
                default:
                    if (block.type && block.type.indexOf("var_get:") === 0) return getVariable(block.type.slice(8));
                    if (block.type && block.type.indexOf("list_get:") === 0) return getList(block.type.slice(9)).join(" ");
                    return 0;
            }
        }

        // Each command block is a generator step -- "yield" hands control
        // back to the scheduler for one frame, which is what keeps a
        // "wiederhole fortlaufend" from ever locking up the page.
        function* runBlock(block, ctx) {
            if (!block || !running) return;
            const inputs = block.inputs || {};
            const s = ctx.sprite;
            switch (block.type) {
                case "motion_move_steps": {
                    const steps = evalNumberInput(inputs, "steps", 0, ctx);
                    const rad = (90 - s.direction) * Math.PI / 180;
                    s.x += Math.cos(rad) * steps;
                    s.y += Math.sin(rad) * steps;
                    notify();
                    break;
                }
                case "motion_turn_right":
                    s.direction = clampDirection(s.direction + evalNumberInput(inputs, "degrees", 0, ctx));
                    notify();
                    break;
                case "motion_turn_left":
                    s.direction = clampDirection(s.direction - evalNumberInput(inputs, "degrees", 0, ctx));
                    notify();
                    break;
                case "motion_go_to_random":
                    s.x = Math.round((Math.random() - 0.5) * (stageWidth - 60));
                    s.y = Math.round((Math.random() - 0.5) * (stageHeight - 60));
                    notify();
                    break;
                case "motion_go_to_xy":
                    s.x = evalNumberInput(inputs, "x", 0, ctx);
                    s.y = evalNumberInput(inputs, "y", 0, ctx);
                    notify();
                    break;
                case "motion_glide_to_xy": {
                    const secs = Math.max(0, evalNumberInput(inputs, "secs", 1, ctx));
                    const startX = s.x, startY = s.y;
                    const endX = evalNumberInput(inputs, "x", 0, ctx), endY = evalNumberInput(inputs, "y", 0, ctx);
                    const startTime = Date.now();
                    while (running) {
                        const t = Math.min(1, (Date.now() - startTime) / (secs * 1000));
                        s.x = startX + (endX - startX) * t;
                        s.y = startY + (endY - startY) * t;
                        notify();
                        if (t >= 1) break;
                        yield;
                    }
                    break;
                }
                case "motion_point_direction":
                    s.direction = clampDirection(evalNumberInput(inputs, "direction", 90, ctx));
                    notify();
                    break;
                case "motion_change_x": s.x += evalNumberInput(inputs, "dx", 0, ctx); notify(); break;
                case "motion_set_x": s.x = evalNumberInput(inputs, "x", 0, ctx); notify(); break;
                case "motion_change_y": s.y += evalNumberInput(inputs, "dy", 0, ctx); notify(); break;
                case "motion_set_y": s.y = evalNumberInput(inputs, "y", 0, ctx); notify(); break;
                case "motion_bounce_edge": {
                    const halfW = stageWidth / 2 - 20, halfH = stageHeight / 2 - 20;
                    if (s.x > halfW || s.x < -halfW) s.direction = clampDirection(180 - s.direction);
                    if (s.y > halfH || s.y < -halfH) s.direction = clampDirection(-s.direction);
                    s.x = Math.max(-halfW, Math.min(halfW, s.x));
                    s.y = Math.max(-halfH, Math.min(halfH, s.y));
                    notify();
                    break;
                }
                case "looks_say_for":
                    s.say = String(evalInput(inputs, "text", "", ctx)); notify();
                    yield* runBlock({ type: "control_wait", inputs: { secs: inputs.secs } }, ctx);
                    s.say = null; notify();
                    break;
                case "looks_say":
                    s.say = String(evalInput(inputs, "text", "", ctx)); notify();
                    break;
                case "looks_think_for":
                    s.think = String(evalInput(inputs, "text", "", ctx)); notify();
                    yield* runBlock({ type: "control_wait", inputs: { secs: inputs.secs } }, ctx);
                    s.think = null; notify();
                    break;
                case "looks_think":
                    s.think = String(evalInput(inputs, "text", "", ctx)); notify();
                    break;
                case "looks_change_size":
                    s.size = Math.max(5, s.size + evalNumberInput(inputs, "delta", 0, ctx)); notify();
                    break;
                case "looks_set_size":
                    s.size = Math.max(5, evalNumberInput(inputs, "size", 100, ctx)); notify();
                    break;
                case "looks_show": s.visible = true; notify(); break;
                case "looks_hide": s.visible = false; notify(); break;
                case "looks_next_costume": s.costumeIndex = (s.costumeIndex + 1) % COSTUMES.length; notify(); break;
                case "looks_set_costume": {
                    const idx = COSTUMES.indexOf(evalInput(inputs, "costume", "Roboter 1", ctx));
                    s.costumeIndex = idx >= 0 ? idx : 0;
                    notify();
                    break;
                }
                case "looks_next_backdrop": setBackdrop((backdropIndex + 1) % BACKDROPS.length); break;
                case "looks_set_backdrop": {
                    const idx = BACKDROPS.indexOf(evalInput(inputs, "backdrop", "Weiß", ctx));
                    setBackdrop(idx >= 0 ? idx : 0);
                    break;
                }
                case "looks_change_effect": {
                    const effect = evalInput(inputs, "effect", "Farbe", ctx);
                    const delta = evalNumberInput(inputs, "delta", 25, ctx);
                    if (effect === "Transparenz") s.ghostEffect = Math.max(0, Math.min(100, s.ghostEffect + delta));
                    else s.colorEffect = (s.colorEffect + delta) % 360;
                    notify();
                    break;
                }
                case "looks_set_effect": {
                    const effect = evalInput(inputs, "effect", "Farbe", ctx);
                    const value = evalNumberInput(inputs, "value", 0, ctx);
                    if (effect === "Transparenz") s.ghostEffect = Math.max(0, Math.min(100, value));
                    else s.colorEffect = value % 360;
                    notify();
                    break;
                }
                case "looks_clear_effects": s.colorEffect = 0; s.ghostEffect = 0; notify(); break;
                case "looks_go_to_front": break; // Only meaningful with several sprites/clones layered -- harmless no-op for the main sprite.
                case "sound_change_volume":
                    s.volume = Math.max(0, Math.min(100, (s.volume === undefined ? 100 : s.volume) + evalNumberInput(inputs, "delta", 0, ctx)));
                    notify();
                    break;
                case "sound_set_volume":
                    s.volume = Math.max(0, Math.min(100, evalNumberInput(inputs, "volume", 100, ctx)));
                    notify();
                    break;
                case "sound_change_effect":
                    s.soundPitch = Math.max(10, (s.soundPitch || 100) + evalNumberInput(inputs, "delta", 10, ctx));
                    break;
                case "sound_set_effect":
                    s.soundPitch = Math.max(10, evalNumberInput(inputs, "value", 100, ctx));
                    break;
                case "sound_clear_effects": s.soundPitch = 100; break;
                case "sound_play": {
                    const dur = playSoundNamed(evalInput(inputs, "sound", "Miau", ctx), s);
                    yield* runBlock({ type: "control_wait", inputs: { secs: dur } }, ctx);
                    break;
                }
                case "sound_play_no_wait":
                    playSoundNamed(evalInput(inputs, "sound", "Miau", ctx), s);
                    break;
                case "sound_stop_all": stopAllSounds(); break;
                case "event_broadcast":
                    broadcastQueue.push(String(evalInput(inputs, "message", "", ctx)));
                    break;
                case "event_broadcast_and_wait": {
                    const msg = String(evalInput(inputs, "message", "", ctx));
                    const started = [];
                    (broadcastListeners[msg] || []).forEach((entry) => {
                        const thread = { gen: runBlock(entry.hat, entry.ctx), ctx: entry.ctx };
                        activeThreads.push(thread);
                        started.push(thread);
                    });
                    while (running && started.some((t) => activeThreads.includes(t))) yield;
                    break;
                }
                case "control_wait": {
                    const ms = Math.max(0, evalNumberInput(inputs, "secs", 0, ctx)) * 1000;
                    const until = Date.now() + ms;
                    while (running && Date.now() < until) yield;
                    break;
                }
                case "control_repeat": {
                    const times = Math.max(0, Math.round(evalNumberInput(inputs, "times", 0, ctx)));
                    for (let i = 0; i < times && running; i++) {
                        yield* runBlock(block.body, ctx);
                        yield;
                    }
                    break;
                }
                case "control_forever":
                    while (running) {
                        yield* runBlock(block.body, ctx);
                        yield;
                    }
                    break;
                case "control_if":
                    if (evalBooleanInput(inputs, "condition", ctx)) yield* runBlock(block.body, ctx);
                    break;
                case "control_if_else":
                    if (evalBooleanInput(inputs, "condition", ctx)) yield* runBlock(block.body, ctx);
                    else yield* runBlock(block.body2, ctx);
                    break;
                case "control_wait_until":
                    while (running && !evalBooleanInput(inputs, "condition", ctx)) yield;
                    break;
                case "control_repeat_until":
                    while (running && !evalBooleanInput(inputs, "condition", ctx)) {
                        yield* runBlock(block.body, ctx);
                        yield;
                    }
                    break;
                case "control_stop": {
                    const target = evalInput(inputs, "target", "alles", ctx);
                    if (target === "alles") stopAll();
                    return;
                }
                case "control_create_clone": {
                    const id = nextCloneId++;
                    const cloneSprite = Object.assign({}, s);
                    clones.push({ id, sprite: cloneSprite });
                    const cloneCtx = { sprite: cloneSprite, isClone: true };
                    collectHats("control_when_i_start_as_clone").forEach((hat) => {
                        activeThreads.push({ gen: runBlock(hat, cloneCtx), ctx: cloneCtx });
                    });
                    notify();
                    break;
                }
                case "control_delete_clone": {
                    if (ctx.isClone) {
                        clones = clones.filter((c) => c.sprite !== s);
                        notify();
                    }
                    return;
                }
                case "sensing_ask": {
                    const question = String(evalInput(inputs, "question", "", ctx));
                    s.say = question; notify();
                    if (options.onAsk) {
                        answer = yield* awaitPromiseAsGenerator(options.onAsk(question));
                    }
                    s.say = null; notify();
                    break;
                }
                case "sensing_reset_timer": timerStart = Date.now(); break;
                case "sensing_set_drag_mode":
                    s.draggable = evalInput(inputs, "mode", "ziehbar", ctx) === "ziehbar";
                    notify();
                    break;
                case "var_set": setVariable(inputs.name, evalNumberInput(inputs, "value", 0, ctx)); break;
                case "var_change": setVariable(inputs.name, toNumber(getVariable(inputs.name)) + evalNumberInput(inputs, "value", 0, ctx)); break;
                case "var_show": shownVariables.add(inputs.name); notify(); break;
                case "var_hide": shownVariables.delete(inputs.name); notify(); break;
                case "list_add": getList(inputs.list).push(String(evalInput(inputs, "item", "", ctx))); notify(); break;
                case "list_delete": {
                    const idx = Math.round(evalNumberInput(inputs, "index", 1, ctx)) - 1;
                    const list = getList(inputs.list);
                    if (idx >= 0 && idx < list.length) list.splice(idx, 1);
                    notify();
                    break;
                }
                case "list_delete_all": lists[inputs.list] = []; notify(); break;
                case "list_insert": {
                    const idx = Math.round(evalNumberInput(inputs, "index", 1, ctx)) - 1;
                    const list = getList(inputs.list);
                    list.splice(Math.max(0, Math.min(list.length, idx)), 0, String(evalInput(inputs, "item", "", ctx)));
                    notify();
                    break;
                }
                case "list_replace": {
                    const idx = Math.round(evalNumberInput(inputs, "index", 1, ctx)) - 1;
                    const list = getList(inputs.list);
                    if (idx >= 0 && idx < list.length) list[idx] = String(evalInput(inputs, "item", "", ctx));
                    notify();
                    break;
                }
                case "list_show": shownLists.add(inputs.list); notify(); break;
                case "list_hide": shownLists.delete(inputs.list); notify(); break;
                default:
                    break; // Unimplemented block type -- a safe, silent no-op.
            }
            if (block.next) yield* runBlock(block.next, ctx);
        }

        function setBackdrop(idx) {
            backdropIndex = idx;
            notify();
            (backdropSwitchListeners[BACKDROPS[idx]] || []).forEach((hat) => startThread(hat, { sprite }));
        }

        // Bridges a Promise (e.g. waiting on a real text answer from the
        // player) into the generator-stepping world above without ever
        // blocking the scheduler loop.
        function* awaitPromiseAsGenerator(promise) {
            let done = false, result = "";
            promise.then((r) => { result = r; done = true; });
            while (!done && running) yield;
            return result;
        }

        function startThread(topBlock, ctx) {
            activeThreads.push({ gen: runBlock(topBlock, ctx), ctx });
        }

        function scheduleTick() {
            if (rafHandle) return;
            const step = () => {
                if (!running) { rafHandle = null; return; }
                // Broadcasts raised this frame start their listeners' threads
                // before the next tick so "sende ... an alle" feels immediate.
                if (broadcastQueue.length) {
                    const messages = broadcastQueue;
                    broadcastQueue = [];
                    messages.forEach((msg) => {
                        (broadcastListeners[msg] || []).forEach((entry) => startThread(entry.hat, entry.ctx));
                    });
                }
                // A manual loop (not Array.prototype.filter) because blocks
                // like control_create_clone / event_broadcast_and_wait push
                // new threads onto activeThreads from inside a thread's own
                // .next() call -- filter() snapshots the array length before
                // running the callback, so anything appended mid-callback
                // would otherwise be silently dropped when the filtered
                // result replaces the array.
                const stillActive = [];
                const tickLength = activeThreads.length;
                for (let i = 0; i < tickLength; i++) {
                    const result = activeThreads[i].gen.next();
                    if (!result.done) stillActive.push(activeThreads[i]);
                }
                activeThreads = stillActive.concat(activeThreads.slice(tickLength));
                if (activeThreads.length === 0 && broadcastQueue.length === 0) {
                    running = false;
                    rafHandle = null;
                    if (onStop) onStop();
                    return;
                }
                rafHandle = requestAnimationFrame(step);
            };
            rafHandle = requestAnimationFrame(step);
        }

        function collectHats(type) {
            return (project.scripts || [])
                .map((s2) => s2.block)
                .filter((b) => b && b.type === type);
        }

        function greenFlag() {
            stopAll();
            running = true;
            timerStart = Date.now();
            broadcastListeners = {};
            backdropSwitchListeners = {};
            const mainCtx = { sprite };
            (project.scripts || []).forEach((s2) => {
                if (s2.block && s2.block.type === "event_when_broadcast") {
                    const msg = (s2.block.inputs || {}).message;
                    broadcastListeners[msg] = broadcastListeners[msg] || [];
                    broadcastListeners[msg].push({ hat: s2.block, ctx: mainCtx });
                }
                if (s2.block && s2.block.type === "event_when_backdrop_switches") {
                    const bd = (s2.block.inputs || {}).backdrop;
                    backdropSwitchListeners[bd] = backdropSwitchListeners[bd] || [];
                    backdropSwitchListeners[bd].push(s2.block);
                }
            });
            collectHats("event_flag_clicked").forEach((hat) => startThread(hat, mainCtx));
            scheduleTick();
        }

        function keyPressed(keyLabel) {
            if (!running) return;
            collectHats("event_key_pressed").forEach((hat) => {
                if ((hat.inputs || {}).key === keyLabel) startThread(hat, { sprite });
            });
        }

        function spriteClicked() {
            if (!running) return;
            collectHats("event_sprite_clicked").forEach((hat) => startThread(hat, { sprite }));
        }

        function stopAll() {
            running = false;
            activeThreads = [];
            broadcastQueue = [];
            clones = [];
            stopAllSounds();
            sprite.say = null;
            sprite.think = null;
            if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
            notify();
        }

        function setKeyState(keyLabel, isDown) {
            if (isDown) { keysDown.add(keyLabel); keyPressed(keyLabel); }
            else keysDown.delete(keyLabel);
        }
        function setMouseState(x, y, isDown) {
            if (x !== undefined) mousePos.x = x;
            if (y !== undefined) mousePos.y = y;
            if (isDown !== undefined) mouseDown = isDown;
        }

        function setSpritePosition(x, y) {
            sprite.x = x;
            sprite.y = y;
            notify();
        }

        return {
            loadProject, greenFlag, stopAll, setKeyState, setMouseState, spriteClicked,
            setSpritePosition,
            getSprite: () => sprite, getVariables: () => variables, getLists: () => lists,
            getClones: () => clones, getBackdropIndex: () => backdropIndex,
            getShownVariables: () => shownVariables, getShownLists: () => shownLists,
            isRunning: () => running,
            BACKDROPS, COSTUMES,
        };
    }

    window.NailRuntime = { createEngine, BACKDROPS, COSTUMES };
})();
