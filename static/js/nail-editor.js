// NAIL editor: palette + drag-and-drop script canvas + stage, built on
// top of nail-blocks.js (block vocabulary) and nail-runtime.js (execution).
// Blocks are plain rounded-rect rows (not true jigsaw/puzzle-piece SVG
// shapes -- that's a real follow-up, this focuses on the interaction
// model actually working end to end: drag from the palette, blocks snap
// above/below each other and into C-shaped bodies, reporter/boolean
// blocks plug into other blocks' input slots, Save persists it, the
// green flag actually runs it on the stage).
(function () {
    const page = document.getElementById("nailEditorPage");
    if (!page) return;
    const projectId = page.dataset.projectId;
    const isReadOnly = page.dataset.readOnly === "true";

    const paletteEl = document.getElementById("nailPalette");
    const categoryListEl = document.getElementById("nailCategoryList");
    const canvasEl = document.getElementById("nailCanvas");
    const stageEl = document.getElementById("nailStage");
    const spriteEl = document.getElementById("nailSprite");
    const speechEl = document.getElementById("nailSpeechBubble");
    const flagBtn = document.getElementById("nailGreenFlag");
    const stopBtn = document.getElementById("nailStopBtn");
    const saveBtn = document.getElementById("nailSaveBtn");
    const nameInput = document.getElementById("nailProjectName");
    const newVarBtn = document.getElementById("nailNewVariableBtn");
    const variableListEl = document.getElementById("nailVariableList");
    const newListBtn = document.getElementById("nailNewListBtn");
    const listListEl = document.getElementById("nailListList");
    const username = page.dataset.username || "";

    let state = { variables: {}, lists: {}, sprite: { x: 0, y: 0, direction: 90, size: 100, visible: true }, scripts: [] };
    try {
        const initial = JSON.parse(page.dataset.projectJson || "{}");
        state.variables = initial.variables || {};
        state.lists = initial.lists || {};
        state.sprite = Object.assign(state.sprite, initial.sprite || {});
        state.scripts = initial.scripts || [];
    } catch (e) { /* starts from the empty default above */ }

    let idCounter = 1;
    function newId() { return `b${Date.now()}_${idCounter++}`; }

    // ---------- Palette ----------
    function buildPaletteBlockList() {
        const blocks = NailBlocks.BLOCKS.slice();
        Object.keys(state.variables).forEach((name) => {
            blocks.push({
                type: `var_get:${name}`, category: "variables", shape: "reporter",
                label: [name], _variableName: name,
            });
        });
        Object.keys(state.lists).forEach((name) => {
            blocks.push({
                type: `list_get:${name}`, category: "variables", shape: "reporter",
                label: [name], _listName: name,
            });
        });
        return blocks;
    }

    function renderPalette() {
        paletteEl.innerHTML = "";
        categoryListEl.innerHTML = "";
        const list = buildPaletteBlockList();
        NailBlocks.CATEGORIES.forEach((cat) => {
            const catBtn = document.createElement("button");
            catBtn.type = "button";
            catBtn.className = "nail-category-btn";
            catBtn.style.setProperty("--nail-cat-color", cat.color);
            catBtn.innerHTML = `<span class="nail-category-dot"></span>${cat.name}`;
            catBtn.addEventListener("click", () => {
                const section = paletteEl.querySelector(`[data-cat-section="${cat.key}"]`);
                if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
            });
            categoryListEl.appendChild(catBtn);

            const section = document.createElement("div");
            section.className = "nail-palette-section";
            section.dataset.catSection = cat.key;
            const heading = document.createElement("h3");
            heading.textContent = cat.name;
            heading.style.color = cat.color;
            section.appendChild(heading);

            list.filter((b) => b.category === cat.key).forEach((def) => {
                section.appendChild(renderPaletteBlock(def, cat.color));
            });
            paletteEl.appendChild(section);
        });
    }

    function renderPaletteBlock(def, color) {
        const el = renderBlockShape(def, {}, color, { interactive: false });
        el.classList.add("nail-palette-block");
        if (!isReadOnly) {
            el.addEventListener("mousedown", (event) => {
                event.preventDefault();
                const blockRect = el.getBoundingClientRect();
                const block = instantiateBlock(def.type);
                startDrag(block, event.clientX, event.clientY, { x: event.clientX - blockRect.left, y: event.clientY - blockRect.top });
            });
        }
        return el;
    }

    function instantiateBlock(type) {
        let def = NailBlocks.BLOCKS_BY_TYPE[type];
        if (!def && type.indexOf("var_get:") === 0) {
            def = { type, category: "variables", shape: "reporter", label: [type.slice(8)] };
        }
        if (!def && type.indexOf("list_get:") === 0) {
            def = { type, category: "variables", shape: "reporter", label: [type.slice(9)] };
        }
        const block = { id: newId(), type: def.type, inputs: {}, next: null };
        (def.label || []).forEach((part) => {
            if (typeof part === "object" && part.input) {
                if (part.type === "boolean") return; // stays empty until a boolean block is dropped in
                block.inputs[part.input] = part.default !== undefined ? part.default : "";
                if (part.type === "variable") {
                    block.inputs[part.input] = Object.keys(state.variables)[0] || "";
                }
                if (part.type === "list") {
                    block.inputs[part.input] = Object.keys(state.lists)[0] || "";
                }
            }
        });
        if (def.shape === "c") block.body = null;
        if (def.shape === "c2") { block.body = null; block.body2 = null; }
        return block;
    }

    // ---------- Rendering a block (palette preview or live canvas block) ----------
    function renderBlockShape(def, inputValues, color, opts) {
        opts = opts || {};
        const wrap = document.createElement("div");
        wrap.className = `nail-block nail-block-${def.shape}`;
        wrap.style.setProperty("--nail-block-color", color);
        const row = document.createElement("div");
        row.className = "nail-block-row";
        (def.label || []).forEach((part) => {
            if (typeof part === "string") {
                const span = document.createElement("span");
                span.className = "nail-block-text";
                span.textContent = part;
                row.appendChild(span);
            } else if (part.input) {
                row.appendChild(renderInputSlot(part, inputValues, opts));
            }
        });
        wrap.appendChild(row);
        if (def.shape === "c" || def.shape === "c2") {
            const body = document.createElement("div");
            body.className = "nail-block-body";
            body.dataset.slotBody = "body";
            wrap.appendChild(body);
            if (def.shape === "c2") {
                const elseLabel = document.createElement("div");
                elseLabel.className = "nail-block-row nail-block-else-label";
                elseLabel.textContent = "sonst";
                wrap.appendChild(elseLabel);
                const body2 = document.createElement("div");
                body2.className = "nail-block-body";
                body2.dataset.slotBody = "body2";
                wrap.appendChild(body2);
            }
            const foot = document.createElement("div");
            foot.className = "nail-block-foot";
            wrap.appendChild(foot);
        }
        return wrap;
    }

    function renderInputSlot(part, inputValues, opts) {
        const slot = document.createElement("span");
        slot.className = "nail-input-slot";
        slot.dataset.slotName = part.input;
        slot.dataset.slotType = part.type;
        const value = inputValues[part.input];
        if (value && typeof value === "object" && value.blockRef) {
            const nestedDef = NailBlocks.BLOCKS_BY_TYPE[value.blockRef.type] ||
                { type: value.blockRef.type, category: "variables", shape: "reporter", label: [nestedRefLabel(value.blockRef.type)] };
            const nestedColor = NailBlocks.CATEGORIES.find((c) => c.key === nestedDef.category).color;
            const nestedEl = renderBlockShape(nestedDef, value.blockRef.inputs || {}, nestedColor, opts);
            nestedEl.classList.add("nail-nested-block");
            if (!opts.readOnlyOnly && !isReadOnly) {
                nestedEl.addEventListener("mousedown", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const nestedRect = nestedEl.getBoundingClientRect();
                    const detached = value.blockRef;
                    delete inputValues[part.input];
                    scheduleRerender();
                    startDrag(detached, event.clientX, event.clientY, {
                        x: event.clientX - nestedRect.left,
                        y: event.clientY - nestedRect.top,
                    });
                });
            }
            slot.appendChild(nestedEl);
            return slot;
        }
        if (part.type === "select") {
            const select = document.createElement("select");
            (part.options || []).forEach((opt) => {
                const o = document.createElement("option");
                o.value = opt; o.textContent = opt;
                if (opt === value) o.selected = true;
                select.appendChild(o);
            });
            if (!isReadOnly) select.addEventListener("change", () => { inputValues[part.input] = select.value; saveDirty(); });
            slot.appendChild(select);
        } else if (part.type === "variable") {
            const select = document.createElement("select");
            Object.keys(state.variables).forEach((name) => {
                const o = document.createElement("option");
                o.value = name; o.textContent = name;
                if (name === value) o.selected = true;
                select.appendChild(o);
            });
            if (!isReadOnly) select.addEventListener("change", () => { inputValues[part.input] = select.value; saveDirty(); });
            slot.appendChild(select);
        } else if (part.type === "list") {
            const select = document.createElement("select");
            Object.keys(state.lists).forEach((name) => {
                const o = document.createElement("option");
                o.value = name; o.textContent = name;
                if (name === value) o.selected = true;
                select.appendChild(o);
            });
            if (!isReadOnly) select.addEventListener("change", () => { inputValues[part.input] = select.value; saveDirty(); });
            slot.appendChild(select);
        } else if (part.type === "boolean") {
            slot.classList.add("nail-input-slot-empty-boolean");
        } else {
            const input = document.createElement("input");
            input.type = part.type === "number" ? "number" : "text";
            input.value = value === undefined ? "" : value;
            input.className = "nail-input-field";
            if (!isReadOnly) {
                input.addEventListener("mousedown", (e) => e.stopPropagation());
                input.addEventListener("change", () => {
                    inputValues[part.input] = part.type === "number" ? toNum(input.value) : input.value;
                    saveDirty();
                });
            } else {
                input.disabled = true;
            }
            slot.appendChild(input);
        }
        return slot;
    }
    function toNum(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
    function nestedRefLabel(type) {
        if (!type) return "";
        if (type.indexOf("var_get:") === 0) return type.slice(8);
        if (type.indexOf("list_get:") === 0) return type.slice(9);
        return type;
    }

    // ---------- Rendering the live canvas (real block tree, with drag handles) ----------
    function colorFor(type) {
        const def = NailBlocks.BLOCKS_BY_TYPE[type] || { category: "variables" };
        return NailBlocks.CATEGORIES.find((c) => c.key === def.category).color;
    }
    function defFor(block) {
        return NailBlocks.BLOCKS_BY_TYPE[block.type] ||
            { type: block.type, category: "variables", shape: "reporter", label: [nestedRefLabel(block.type)] };
    }

    function renderCanvasBlock(block) {
        const def = defFor(block);
        const el = renderBlockShape(def, block.inputs || {}, colorFor(block.type), {});
        el.dataset.blockId = block.id;
        if (!isReadOnly) {
            el.querySelector(".nail-block-row").addEventListener("mousedown", (event) => {
                if (event.target.closest("input, select")) return;
                event.preventDefault();
                event.stopPropagation();
                const blockRect = el.getBoundingClientRect();
                const detached = detachBlock(block.id);
                if (!detached) return;
                startDrag(detached.block, event.clientX, event.clientY, {
                    x: event.clientX - blockRect.left,
                    y: event.clientY - blockRect.top,
                });
            });
        }
        if (def.shape === "c" || def.shape === "c2") {
            const bodyEl = el.querySelector('[data-slot-body="body"]');
            if (block.body) bodyEl.appendChild(renderChain(block.body));
            if (def.shape === "c2") {
                const body2El = el.querySelector('[data-slot-body="body2"]');
                if (block.body2) body2El.appendChild(renderChain(block.body2));
            }
        }
        return el;
    }

    function renderChain(firstBlock) {
        const frag = document.createDocumentFragment();
        let cur = firstBlock;
        while (cur) {
            frag.appendChild(renderCanvasBlock(cur));
            cur = cur.next;
        }
        return frag;
    }

    function renderCanvas() {
        canvasEl.querySelectorAll(".nail-script").forEach((el) => el.remove());
        state.scripts.forEach((script) => {
            const wrap = document.createElement("div");
            wrap.className = "nail-script";
            wrap.style.left = `${script.x || 20}px`;
            wrap.style.top = `${script.y || 20}px`;
            wrap.appendChild(renderChain(script.block));
            canvasEl.appendChild(wrap);
        });
    }

    let rerenderQueued = false;
    function scheduleRerender() {
        if (rerenderQueued) return;
        rerenderQueued = true;
        requestAnimationFrame(() => { rerenderQueued = false; renderCanvas(); renderVariableList(); renderListList(); renderPalette(); });
    }

    // ---------- Detach / find helpers on the block tree ----------
    function findAndUnlink(node, id, onFound) {
        if (!node) return null;
        for (const key of ["next"]) {
            if (node[key] && node[key].id === id) {
                const found = node[key];
                node[key] = found.next;
                found.next = null;
                onFound(found);
                return found;
            }
        }
        for (const key of ["body", "body2"]) {
            if (node[key]) {
                if (node[key].id === id) {
                    const found = node[key];
                    node[key] = found.next;
                    found.next = null;
                    onFound(found);
                    return found;
                }
                const inner = findAndUnlink(node[key], id, onFound);
                if (inner) return inner;
            }
        }
        return node.next ? findAndUnlink(node.next, id, onFound) : null;
    }

    function detachBlock(id) {
        for (let i = 0; i < state.scripts.length; i++) {
            const script = state.scripts[i];
            if (script.block.id === id) {
                state.scripts.splice(i, 1);
                scheduleRerender();
                return { block: script.block };
            }
            const found = findAndUnlink(script.block, id, () => {});
            if (found) {
                scheduleRerender();
                return { block: found };
            }
        }
        return null;
    }

    // ---------- Drag & drop ----------
    let dragEl = null, dragBlock = null, dragOffset = { x: 0, y: 0 };

    function startDrag(block, clientX, clientY, offset) {
        dragBlock = block;
        dragOffset = offset;
        const def = defFor(block);
        dragEl = renderBlockShape(def, block.inputs || {}, colorFor(block.type), { readOnlyOnly: true });
        dragEl.classList.add("nail-dragging-block");
        document.body.appendChild(dragEl);
        positionDragEl(clientX, clientY);
        document.addEventListener("mousemove", onDragMove);
        document.addEventListener("mouseup", onDragEnd);
    }
    function positionDragEl(clientX, clientY) {
        dragEl.style.left = `${clientX - dragOffset.x}px`;
        dragEl.style.top = `${clientY - dragOffset.y}px`;
    }
    function onDragMove(event) {
        if (!dragEl) return;
        positionDragEl(event.clientX, event.clientY);
        clearDropHighlight();
        const target = findDropTarget(event.clientX, event.clientY);
        if (target) target.el.classList.add("nail-drop-highlight");
    }
    function clearDropHighlight() {
        canvasEl.querySelectorAll(".nail-drop-highlight").forEach((el) => el.classList.remove("nail-drop-highlight"));
    }

    function findDropTarget(clientX, clientY) {
        const def = defFor(dragBlock);
        const isValue = def.shape === "reporter" || def.shape === "boolean";
        if (isValue) {
            const slots = canvasEl.querySelectorAll(".nail-input-slot");
            for (const slot of slots) {
                const r = slot.getBoundingClientRect();
                if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
                    const wantsBoolean = def.shape === "boolean";
                    const slotIsBoolean = slot.dataset.slotType === "boolean";
                    if (wantsBoolean !== slotIsBoolean) continue;
                    if (slot.closest(`[data-block-id="${dragBlock.id}"]`)) continue;
                    return { kind: "input", el: slot, slotName: slot.dataset.slotName, blockId: slot.closest("[data-block-id]") ? slot.closest("[data-block-id]").dataset.blockId : null };
                }
            }
            return null;
        }
        // Stack blocks: look for the bottom edge of another stack block, or
        // an empty C-body slot, to snap onto/into.
        const rows = canvasEl.querySelectorAll(".nail-block-row");
        for (const row of rows) {
            const blockEl = row.closest(".nail-block");
            if (blockEl.dataset.blockId === undefined) continue;
            if (blockEl.closest(`[data-block-id="${dragBlock.id}"]`)) continue;
            const r = row.getBoundingClientRect();
            if (clientX >= r.left - 10 && clientX <= r.right + 10 && clientY >= r.bottom - 10 && clientY <= r.bottom + 14) {
                return { kind: "after", blockId: blockEl.dataset.blockId };
            }
        }
        const bodySlots = canvasEl.querySelectorAll("[data-slot-body]");
        for (const slot of bodySlots) {
            if (slot.closest(`[data-block-id="${dragBlock.id}"]`)) continue;
            const r = slot.getBoundingClientRect();
            if (clientX >= r.left && clientX <= r.right && clientY >= r.top - 4 && clientY <= r.bottom + 4) {
                return { kind: "body", el: slot, slotKey: slot.dataset.slotBody, blockId: slot.closest("[data-block-id]").dataset.blockId };
            }
        }
        return null;
    }

    function findBlockById(id) {
        for (const script of state.scripts) {
            const found = findNode(script.block, id);
            if (found) return found;
        }
        return null;
    }
    function findNode(node, id) {
        if (!node) return null;
        if (node.id === id) return node;
        return findNode(node.next, id) || (node.body ? findNode(node.body, id) : null) || (node.body2 ? findNode(node.body2, id) : null);
    }

    function chainEnd(block) {
        let cur = block;
        while (cur.next) cur = cur.next;
        return cur;
    }

    function onDragEnd(event) {
        document.removeEventListener("mousemove", onDragMove);
        document.removeEventListener("mouseup", onDragEnd);
        clearDropHighlight();
        if (dragEl) dragEl.remove();
        const target = findDropTarget(event.clientX, event.clientY);
        const rect = canvasEl.getBoundingClientRect();
        if (!target) {
            const withinCanvas = event.clientX >= rect.left && event.clientX <= rect.right &&
                event.clientY >= rect.top && event.clientY <= rect.bottom;
            if (withinCanvas) {
                state.scripts.push({
                    x: Math.max(0, event.clientX - rect.left - dragOffset.x),
                    y: Math.max(0, event.clientY - rect.top - dragOffset.y),
                    block: dragBlock,
                });
            }
            // Dropped outside the canvas entirely -- the block (and
            // anything picked up with it) is simply discarded, matching
            // dragging a block back onto the palette in real Scratch.
        } else if (target.kind === "input") {
            const owner = target.blockId ? findBlockById(target.blockId) : null;
            const inputs = owner ? owner.inputs : findScriptInputsFallback(target.el);
            if (inputs) inputs[target.slotName] = { blockRef: dragBlock };
        } else if (target.kind === "after") {
            const after = findBlockById(target.blockId);
            if (after) {
                const end = chainEnd(dragBlock);
                end.next = after.next;
                after.next = dragBlock;
            }
        } else if (target.kind === "body") {
            const owner = findBlockById(target.blockId);
            if (owner) {
                const end = chainEnd(dragBlock);
                end.next = owner[target.slotKey];
                owner[target.slotKey] = dragBlock;
            }
        }
        dragEl = null; dragBlock = null;
        scheduleRerender();
        saveDirty();
    }
    function findScriptInputsFallback() { return null; }

    // ---------- Variables ----------
    function renderVariableList() {
        variableListEl.innerHTML = "";
        Object.keys(state.variables).forEach((name) => {
            const chip = document.createElement("span");
            chip.className = "nail-variable-chip";
            chip.textContent = name;
            variableListEl.appendChild(chip);
        });
    }
    if (newVarBtn && !isReadOnly) {
        newVarBtn.addEventListener("click", () => {
            const name = window.prompt("Name der neuen Variable:");
            if (!name || !name.trim()) return;
            const clean = name.trim();
            if (!(clean in state.variables)) state.variables[clean] = 0;
            scheduleRerender();
            saveDirty();
        });
    }

    // ---------- Lists ----------
    function renderListList() {
        if (!listListEl) return;
        listListEl.innerHTML = "";
        Object.keys(state.lists).forEach((name) => {
            const chip = document.createElement("span");
            chip.className = "nail-variable-chip";
            chip.textContent = name;
            listListEl.appendChild(chip);
        });
    }
    if (newListBtn && !isReadOnly) {
        newListBtn.addEventListener("click", () => {
            const name = window.prompt("Name der neuen Liste:");
            if (!name || !name.trim()) return;
            const clean = name.trim();
            if (!(clean in state.lists)) state.lists[clean] = [];
            scheduleRerender();
            saveDirty();
        });
    }

    // ---------- Stage rendering ----------
    const BACKDROP_COLORS = { "Weiß": "#ffffff", "Himmel": "#8ecdf0", "Wiese": "#8bc34a", "Nacht": "#151a33" };
    const COSTUME_HUES = [0, 130, 250];
    let engine = null;
    let cloneEls = new Map();
    let watchersEl = null;

    function spriteFilter(sprite) {
        const hue = (COSTUME_HUES[sprite.costumeIndex || 0] || 0) + (sprite.colorEffect || 0);
        const opacity = Math.max(0, 1 - (sprite.ghostEffect || 0) / 100);
        return `hue-rotate(${hue}deg) opacity(${opacity})`;
    }
    function transformFor(sprite) {
        const scale = (sprite.size || 100) / 100;
        return `translate(-50%, -50%) translate(${sprite.x}px, ${-sprite.y}px) rotate(${sprite.direction - 90}deg) scale(${scale})`;
    }

    function paintSprite(sprite) {
        spriteEl.style.transform = transformFor(sprite);
        spriteEl.style.visibility = sprite.visible ? "visible" : "hidden";
        spriteEl.style.filter = spriteFilter(sprite);
        spriteEl.classList.toggle("nail-sprite-draggable", !!sprite.draggable);
        if (sprite.say || sprite.think) {
            speechEl.textContent = sprite.say || sprite.think;
            speechEl.className = "nail-speech-bubble " + (sprite.think ? "nail-speech-think" : "nail-speech-say");
            speechEl.style.display = "block";
            speechEl.style.left = `calc(50% + ${sprite.x}px)`;
            speechEl.style.top = `calc(50% - ${sprite.y}px - 70px)`;
        } else {
            speechEl.style.display = "none";
        }
    }

    function paintBackdrop(backdropIndex) {
        if (!stageEl) return;
        const name = (NailRuntime.BACKDROPS || [])[backdropIndex] || "Weiß";
        stageEl.style.background = BACKDROP_COLORS[name] || "#ffffff";
    }

    function paintClones(clones) {
        if (!stageEl) return;
        const seen = new Set();
        clones.forEach((clone) => {
            seen.add(clone.id);
            let el = cloneEls.get(clone.id);
            if (!el) {
                el = spriteEl.cloneNode(true);
                el.removeAttribute("id");
                el.classList.add("nail-clone-sprite");
                stageEl.appendChild(el);
                cloneEls.set(clone.id, el);
            }
            el.style.transform = transformFor(clone.sprite);
            el.style.visibility = clone.sprite.visible ? "visible" : "hidden";
            el.style.filter = spriteFilter(clone.sprite);
        });
        cloneEls.forEach((el, id) => {
            if (!seen.has(id)) { el.remove(); cloneEls.delete(id); }
        });
    }

    function ensureWatchersEl() {
        if (watchersEl || !stageEl) return watchersEl;
        watchersEl = document.createElement("div");
        watchersEl.className = "nail-watchers";
        stageEl.appendChild(watchersEl);
        return watchersEl;
    }
    function paintWatchers(variables, extras) {
        const el = ensureWatchersEl();
        if (!el) return;
        el.innerHTML = "";
        (extras.shownVariables || []).forEach((name) => {
            const row = document.createElement("div");
            row.className = "nail-watcher-row";
            row.innerHTML = `<span class="nail-watcher-name">${name}</span><span class="nail-watcher-value">${variables[name]}</span>`;
            el.appendChild(row);
        });
        (extras.shownLists || []).forEach((name) => {
            const box = document.createElement("div");
            box.className = "nail-watcher-list";
            const title = document.createElement("div");
            title.className = "nail-watcher-name";
            title.textContent = name;
            box.appendChild(title);
            (extras.lists[name] || []).forEach((item, i) => {
                const row = document.createElement("div");
                row.className = "nail-watcher-list-item";
                row.textContent = `${i + 1}. ${item}`;
                box.appendChild(row);
            });
            el.appendChild(box);
        });
    }

    function ensureEngine() {
        if (engine) return engine;
        engine = NailRuntime.createEngine({
            stageWidth: 480, stageHeight: 360,
            username,
            onStateChange: (sprite, variables, extras) => {
                paintSprite(sprite);
                paintBackdrop(extras.backdropIndex);
                paintClones(extras.clones || []);
                paintWatchers(variables, {
                    shownVariables: Array.from(extras.shownVariables || []),
                    shownLists: Array.from(extras.shownLists || []),
                    lists: extras.lists || {},
                });
            },
            onStop: () => { flagBtn.classList.remove("is-running"); },
            onAsk: (question) => new Promise((resolve) => {
                const answer = window.prompt(question) || "";
                resolve(answer);
            }),
        });
        return engine;
    }

    if (flagBtn) {
        flagBtn.addEventListener("click", () => {
            const eng = ensureEngine();
            eng.loadProject(state);
            eng.greenFlag();
            flagBtn.classList.add("is-running");
        });
    }
    if (stopBtn) {
        stopBtn.addEventListener("click", () => {
            if (engine) engine.stopAll();
            flagBtn.classList.remove("is-running");
        });
    }
    let draggingSprite = false;
    let dragSpriteOffset = { x: 0, y: 0 };
    if (stageEl) {
        stageEl.addEventListener("mousemove", (event) => {
            if (!engine) return;
            const r = stageEl.getBoundingClientRect();
            engine.setMouseState(event.clientX - r.left - r.width / 2, r.height / 2 - (event.clientY - r.top));
            if (draggingSprite) {
                engine.setSpritePosition(event.clientX - r.left - r.width / 2 - dragSpriteOffset.x, r.height / 2 - (event.clientY - r.top) - dragSpriteOffset.y);
            }
        });
        stageEl.addEventListener("mousedown", (event) => {
            if (engine) engine.setMouseState(undefined, undefined, true);
            const onSprite = spriteEl.contains(event.target) || event.target === spriteEl;
            if (engine && onSprite) {
                const sprite = engine.getSprite();
                if (sprite && sprite.draggable) {
                    draggingSprite = true;
                    const r = stageEl.getBoundingClientRect();
                    dragSpriteOffset = {
                        x: event.clientX - r.left - r.width / 2 - sprite.x,
                        y: r.height / 2 - (event.clientY - r.top) - sprite.y,
                    };
                }
            }
        });
        stageEl.addEventListener("mouseup", () => {
            if (engine) engine.setMouseState(undefined, undefined, false);
            draggingSprite = false;
        });
    }
    if (spriteEl) {
        spriteEl.addEventListener("click", () => { if (engine && !draggingSprite) engine.spriteClicked(); });
    }
    document.addEventListener("keydown", (event) => {
        if (!engine) return;
        const map = { " ": "Leertaste", ArrowUp: "Pfeil hoch", ArrowDown: "Pfeil runter", ArrowLeft: "Pfeil links", ArrowRight: "Pfeil rechts" };
        const label = map[event.key] || (event.key.length === 1 ? event.key.toLowerCase() : null);
        if (label) engine.setKeyState(label, true);
    });
    document.addEventListener("keyup", (event) => {
        if (!engine) return;
        const map = { " ": "Leertaste", ArrowUp: "Pfeil hoch", ArrowDown: "Pfeil runter", ArrowLeft: "Pfeil links", ArrowRight: "Pfeil rechts" };
        const label = map[event.key] || (event.key.length === 1 ? event.key.toLowerCase() : null);
        if (label) engine.setKeyState(label, false);
    });

    // ---------- Save ----------
    let saveTimer = null;
    function saveDirty() {
        if (isReadOnly) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(doSave, 900);
    }
    function doSave() {
        if (isReadOnly || !projectId) return;
        fetch(`/api/nail/${projectId}/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                project_json: JSON.stringify(state),
                name: nameInput ? nameInput.value : undefined,
            }),
        }).catch(() => {});
    }
    if (saveBtn) saveBtn.addEventListener("click", doSave);
    if (nameInput) nameInput.addEventListener("change", saveDirty);

    // ---------- Init ----------
    renderPalette();
    renderVariableList();
    renderListList();
    renderCanvas();
    paintSprite(state.sprite);
    paintBackdrop(0);
})();
