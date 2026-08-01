// NAIL runtime -- a real, working interpreter for the block trees the
// editor builds (see nail-editor.js) and saves as project_json. Used by
// both the editor's green-flag button and the standalone play page.
//
// Each running script is a JS generator (see runBlock()); the scheduler
// advances every active generator by one step per animation frame, which
// is what lets "wiederhole"/"warte" pause a script without blocking the
// browser tab or every other running script -- the same cooperative,
// round-robin model Scratch's own VM uses, just far simpler.
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

    function createEngine(options) {
        const {
            stageWidth = 480, stageHeight = 360,
            onStateChange, // (spriteState) => void, called after every visible change
            onStop, // () => void, called once every script has finished/been stopped
        } = options;

        let project = { variables: {}, sprite: {}, scripts: [] };
        let sprite = {};
        let variables = {};
        let timerStart = Date.now();
        let answer = "";
        let running = false;
        let activeThreads = [];
        let keysDown = new Set();
        let mouseDown = false;
        let mousePos = { x: 0, y: 0 };
        let broadcastListeners = {}; // message -> [hatBlock, ...]
        let broadcastQueue = [];
        let rafHandle = null;

        function loadProject(newProject) {
            stopAll();
            project = newProject && typeof newProject === "object" ? newProject : { variables: {}, sprite: {}, scripts: [] };
            variables = Object.assign({}, project.variables || {});
            sprite = Object.assign({
                x: 0, y: 0, direction: 90, size: 100, visible: true, say: null, think: null,
            }, project.sprite || {});
            notify();
        }

        function notify() {
            if (onStateChange) onStateChange(sprite, variables);
        }

        function getVariable(name) {
            return Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : 0;
        }
        function setVariable(name, value) {
            variables[name] = value;
            notify();
        }

        // Evaluates one input slot: either a literal (number/string) or a
        // nested reporter/boolean block ({blockRef: {...}}) -- recursing
        // naturally handles arbitrarily deep composition like (1 + 2) * 3.
        function evalInput(inputs, name, fallback) {
            if (!inputs || !(name in inputs)) return fallback;
            const raw = inputs[name];
            if (raw && typeof raw === "object" && raw.blockRef) {
                return evalReporter(raw.blockRef);
            }
            return raw;
        }
        function evalNumberInput(inputs, name, fallback) {
            return toNumber(evalInput(inputs, name, fallback));
        }
        function evalBooleanInput(inputs, name) {
            const v = evalInput(inputs, name, false);
            return v === true || v === "true" || (typeof v === "number" && v !== 0);
        }

        function evalReporter(block) {
            if (!block) return 0;
            const inputs = block.inputs || {};
            switch (block.type) {
                case "motion_x_position": return sprite.x;
                case "motion_y_position": return sprite.y;
                case "motion_direction": return sprite.direction;
                case "looks_size": return sprite.size;
                case "sound_volume": return sprite.volume === undefined ? 100 : sprite.volume;
                case "sensing_answer": return answer;
                case "sensing_mouse_x": return mousePos.x;
                case "sensing_mouse_y": return mousePos.y;
                case "sensing_timer": return (Date.now() - timerStart) / 1000;
                case "sensing_touching_mouse": {
                    const dx = mousePos.x - sprite.x, dy = mousePos.y - sprite.y;
                    return Math.sqrt(dx * dx + dy * dy) < 40 * (sprite.size / 100);
                }
                case "sensing_touching_edge":
                    return Math.abs(sprite.x) > stageWidth / 2 - 20 || Math.abs(sprite.y) > stageHeight / 2 - 20;
                case "sensing_key_pressed":
                    return keysDown.has(evalInput(inputs, "key", "Leertaste"));
                case "sensing_mouse_down": return mouseDown;
                case "op_add": return evalNumberInput(inputs, "a", 0) + evalNumberInput(inputs, "b", 0);
                case "op_sub": return evalNumberInput(inputs, "a", 0) - evalNumberInput(inputs, "b", 0);
                case "op_mul": return evalNumberInput(inputs, "a", 0) * evalNumberInput(inputs, "b", 0);
                case "op_div": {
                    const b = evalNumberInput(inputs, "b", 0);
                    return b === 0 ? 0 : evalNumberInput(inputs, "a", 0) / b;
                }
                case "op_mod": {
                    const b = evalNumberInput(inputs, "b", 0);
                    return b === 0 ? 0 : evalNumberInput(inputs, "a", 0) % b;
                }
                case "op_round": return Math.round(evalNumberInput(inputs, "a", 0));
                case "op_random": {
                    const from = evalNumberInput(inputs, "from", 1), to = evalNumberInput(inputs, "to", 10);
                    const lo = Math.min(from, to), hi = Math.max(from, to);
                    return Math.round(lo + Math.random() * (hi - lo));
                }
                case "op_gt": return evalNumberInput(inputs, "a", 0) > evalNumberInput(inputs, "b", 0);
                case "op_lt": return evalNumberInput(inputs, "a", 0) < evalNumberInput(inputs, "b", 0);
                case "op_eq": return String(evalInput(inputs, "a", "")) === String(evalInput(inputs, "b", ""));
                case "op_and": return evalBooleanInput(inputs, "a") && evalBooleanInput(inputs, "b");
                case "op_or": return evalBooleanInput(inputs, "a") || evalBooleanInput(inputs, "b");
                case "op_not": return !evalBooleanInput(inputs, "a");
                case "op_join": return `${evalInput(inputs, "a", "")}${evalInput(inputs, "b", "")}`;
                case "op_length": return String(evalInput(inputs, "a", "")).length;
                case "op_contains":
                    return String(evalInput(inputs, "a", "")).toLowerCase()
                        .includes(String(evalInput(inputs, "b", "")).toLowerCase());
                case "var_get": return getVariable(inputs.name);
                default:
                    if (block.type && block.type.indexOf("var_get:") === 0) {
                        return getVariable(block.type.slice(8));
                    }
                    return 0;
            }
        }

        function wait(ms) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }

        // Each command block is a generator step -- "yield" hands control
        // back to the scheduler for one frame, which is what keeps a
        // "wiederhole fortlaufend" from ever locking up the page.
        function* runBlock(block) {
            if (!block || !running) return;
            const inputs = block.inputs || {};
            switch (block.type) {
                case "motion_move_steps": {
                    const steps = evalNumberInput(inputs, "steps", 0);
                    const rad = (90 - sprite.direction) * Math.PI / 180;
                    sprite.x += Math.cos(rad) * steps;
                    sprite.y += Math.sin(rad) * steps;
                    notify();
                    break;
                }
                case "motion_turn_right":
                    sprite.direction = clampDirection(sprite.direction + evalNumberInput(inputs, "degrees", 0));
                    notify();
                    break;
                case "motion_turn_left":
                    sprite.direction = clampDirection(sprite.direction - evalNumberInput(inputs, "degrees", 0));
                    notify();
                    break;
                case "motion_go_to_random":
                    sprite.x = Math.round((Math.random() - 0.5) * (stageWidth - 60));
                    sprite.y = Math.round((Math.random() - 0.5) * (stageHeight - 60));
                    notify();
                    break;
                case "motion_go_to_xy":
                    sprite.x = evalNumberInput(inputs, "x", 0);
                    sprite.y = evalNumberInput(inputs, "y", 0);
                    notify();
                    break;
                case "motion_glide_to_xy": {
                    const secs = Math.max(0, evalNumberInput(inputs, "secs", 1));
                    const startX = sprite.x, startY = sprite.y;
                    const endX = evalNumberInput(inputs, "x", 0), endY = evalNumberInput(inputs, "y", 0);
                    const startTime = Date.now();
                    while (running) {
                        const t = Math.min(1, (Date.now() - startTime) / (secs * 1000));
                        sprite.x = startX + (endX - startX) * t;
                        sprite.y = startY + (endY - startY) * t;
                        notify();
                        if (t >= 1) break;
                        yield;
                    }
                    break;
                }
                case "motion_point_direction":
                    sprite.direction = clampDirection(evalNumberInput(inputs, "direction", 90));
                    notify();
                    break;
                case "motion_change_x": sprite.x += evalNumberInput(inputs, "dx", 0); notify(); break;
                case "motion_set_x": sprite.x = evalNumberInput(inputs, "x", 0); notify(); break;
                case "motion_change_y": sprite.y += evalNumberInput(inputs, "dy", 0); notify(); break;
                case "motion_set_y": sprite.y = evalNumberInput(inputs, "y", 0); notify(); break;
                case "motion_bounce_edge": {
                    const halfW = stageWidth / 2 - 20, halfH = stageHeight / 2 - 20;
                    if (sprite.x > halfW || sprite.x < -halfW) sprite.direction = clampDirection(180 - sprite.direction);
                    if (sprite.y > halfH || sprite.y < -halfH) sprite.direction = clampDirection(-sprite.direction);
                    sprite.x = Math.max(-halfW, Math.min(halfW, sprite.x));
                    sprite.y = Math.max(-halfH, Math.min(halfH, sprite.y));
                    notify();
                    break;
                }
                case "looks_say_for":
                    sprite.say = String(evalInput(inputs, "text", "")); notify();
                    yield* runBlock({ type: "control_wait", inputs: { secs: inputs.secs } });
                    sprite.say = null; notify();
                    break;
                case "looks_say":
                    sprite.say = String(evalInput(inputs, "text", "")); notify();
                    break;
                case "looks_think_for":
                    sprite.think = String(evalInput(inputs, "text", "")); notify();
                    yield* runBlock({ type: "control_wait", inputs: { secs: inputs.secs } });
                    sprite.think = null; notify();
                    break;
                case "looks_think":
                    sprite.think = String(evalInput(inputs, "text", "")); notify();
                    break;
                case "looks_change_size":
                    sprite.size = Math.max(5, sprite.size + evalNumberInput(inputs, "delta", 0)); notify();
                    break;
                case "looks_set_size":
                    sprite.size = Math.max(5, evalNumberInput(inputs, "size", 100)); notify();
                    break;
                case "looks_show": sprite.visible = true; notify(); break;
                case "looks_hide": sprite.visible = false; notify(); break;
                case "sound_change_volume":
                    sprite.volume = Math.max(0, Math.min(100, (sprite.volume === undefined ? 100 : sprite.volume) + evalNumberInput(inputs, "delta", 0)));
                    notify();
                    break;
                case "sound_set_volume":
                    sprite.volume = Math.max(0, Math.min(100, evalNumberInput(inputs, "volume", 100)));
                    notify();
                    break;
                case "sound_play":
                    // No real audio asset system in NAIL yet -- a visible,
                    // honest no-op rather than a fake beep.
                    break;
                case "event_broadcast":
                    broadcastQueue.push(String(evalInput(inputs, "message", "")));
                    break;
                case "control_wait": {
                    const ms = Math.max(0, evalNumberInput(inputs, "secs", 0)) * 1000;
                    const until = Date.now() + ms;
                    while (running && Date.now() < until) yield;
                    break;
                }
                case "control_repeat": {
                    const times = Math.max(0, Math.round(evalNumberInput(inputs, "times", 0)));
                    for (let i = 0; i < times && running; i++) {
                        yield* runBlock(block.body);
                        yield;
                    }
                    break;
                }
                case "control_forever":
                    while (running) {
                        yield* runBlock(block.body);
                        yield;
                    }
                    break;
                case "control_if":
                    if (evalBooleanInput(inputs, "condition")) yield* runBlock(block.body);
                    break;
                case "control_if_else":
                    if (evalBooleanInput(inputs, "condition")) yield* runBlock(block.body);
                    else yield* runBlock(block.body2);
                    break;
                case "control_wait_until":
                    while (running && !evalBooleanInput(inputs, "condition")) yield;
                    break;
                case "control_repeat_until":
                    while (running && !evalBooleanInput(inputs, "condition")) {
                        yield* runBlock(block.body);
                        yield;
                    }
                    break;
                case "control_stop_all":
                    stopAll();
                    return;
                case "sensing_ask": {
                    const question = String(evalInput(inputs, "question", ""));
                    sprite.say = question; notify();
                    if (options.onAsk) {
                        answer = yield* awaitPromiseAsGenerator(options.onAsk(question));
                    }
                    sprite.say = null; notify();
                    break;
                }
                case "sensing_reset_timer": timerStart = Date.now(); break;
                case "var_set": setVariable(inputs.name, evalNumberInput(inputs, "value", 0)); break;
                case "var_change": setVariable(inputs.name, toNumber(getVariable(inputs.name)) + evalNumberInput(inputs, "value", 0)); break;
                case "var_show": case "var_hide": break; // on-stage variable watchers: not in NAIL v1
                default:
                    break; // Unimplemented block type -- a safe, silent no-op.
            }
            if (block.next) yield* runBlock(block.next);
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

        function startThread(topBlock) {
            activeThreads.push(runBlock(topBlock));
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
                        (broadcastListeners[msg] || []).forEach((hat) => startThread(hat));
                    });
                }
                activeThreads = activeThreads.filter((thread) => {
                    const result = thread.next();
                    return !result.done;
                });
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
                .map((s) => s.block)
                .filter((b) => b && b.type === type);
        }

        function greenFlag() {
            stopAll();
            running = true;
            timerStart = Date.now();
            broadcastListeners = {};
            (project.scripts || []).forEach((s) => {
                if (s.block && s.block.type === "event_when_broadcast") {
                    const msg = (s.block.inputs || {}).message;
                    broadcastListeners[msg] = broadcastListeners[msg] || [];
                    broadcastListeners[msg].push(s.block);
                }
            });
            collectHats("event_flag_clicked").forEach(startThread);
            scheduleTick();
        }

        function keyPressed(keyLabel) {
            if (!running) return;
            collectHats("event_key_pressed").forEach((hat) => {
                if ((hat.inputs || {}).key === keyLabel) startThread(hat);
            });
        }

        function spriteClicked() {
            if (!running) return;
            collectHats("event_sprite_clicked").forEach(startThread);
        }

        function stopAll() {
            running = false;
            activeThreads = [];
            broadcastQueue = [];
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
            mousePos = { x, y };
            mouseDown = isDown;
        }

        return {
            loadProject, greenFlag, stopAll, setKeyState, setMouseState, spriteClicked,
            getSprite: () => sprite, getVariables: () => variables,
            isRunning: () => running,
        };
    }

    window.NailRuntime = { createEngine };
})();
