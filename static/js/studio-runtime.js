(function () {
    const page = document.getElementById("studioPlayPage");
    if (!page) return;
    const projectId = page.dataset.projectId;
    const loggedIn = page.dataset.loggedIn === "1";
    const language = page.dataset.language || "timeskipcode";
    const rawBlocks = JSON.parse(page.dataset.blocks || "[]");
    const scriptCode = JSON.parse(page.dataset.script || "\"\"");

    const canvas = document.getElementById("studioPlayCanvas");
    const ctx = canvas.getContext("2d");
    const coinsEl = document.getElementById("studioPlayCoins");

    const GRAVITY = 0.6;
    const MOVE_SPEED = 3.4;
    const JUMP_POWER = 12;
    const WORLD_W = 2000;
    const WORLD_H = 1400;
    const PLAYER_W = 18;
    const PLAYER_H = 34;

    const showFigure = !window.StudioDSL.figuresDisabled(scriptCode, language);

    // One shared script for the whole game -- each rule names the block it
    // applies to, so a single script can drive any number of blocks.
    const blocks = rawBlocks.map((b) => ({
        id: b.id,
        name: b.name,
        kind: b.kind,
        color: b.color,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        collidable: true,
        opacity: 1,
        rules: [],
        wasTouching: false,
    }));
    const blocksByName = {};
    blocks.forEach((b) => { blocksByName[b.name] = b; });

    const rules = window.StudioDSL.parseStudioScript(scriptCode, language);
    rules.forEach((rule) => {
        const target = blocksByName[rule.target];
        if (!target) return;
        if (rule.canCollide === false) target.collidable = false;
        target.rules.push(rule);
    });

    // Named variables (SET/CHANGE), scoped to this play session. Unset
    // variables read as 0, matching how a fresh number would start.
    const variables = {};
    function getVar(name) {
        return variables[name] || 0;
    }
    function conditionHolds(condition) {
        if (!condition) return true;
        const value = getVar(condition.varName);
        switch (condition.operator) {
            case ">": return value > condition.value;
            case "<": return value < condition.value;
            case ">=": return value >= condition.value;
            case "<=": return value <= condition.value;
            case "!=": return value !== condition.value;
            case "=": return value === condition.value;
            default: return true;
        }
    }

    const spawnBlock = blocks.find((b) => b.kind === "spawn") || blocks[0] || { x: 60, y: 60, width: 0, height: 0 };
    const spawnPoint = {
        x: spawnBlock.x + spawnBlock.width / 2 - PLAYER_W / 2,
        y: spawnBlock.y - PLAYER_H,
    };
    const respawnPoint = { x: spawnPoint.x, y: spawnPoint.y };

    const player = {
        x: spawnPoint.x,
        y: spawnPoint.y,
        w: PLAYER_W,
        h: PLAYER_H,
        vx: 0,
        vy: 0,
        grounded: false,
        facing: 1,
        alive: true,
    };

    let coins = 0;
    let pendingAward = 0;
    let awardTimer = null;

    function flushAward() {
        if (pendingAward <= 0 || !loggedIn) {
            pendingAward = 0;
            return;
        }
        const amount = Math.min(pendingAward, 5000);
        pendingAward = 0;
        fetch(`/api/studio/${projectId}/award`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ amount }),
        }).catch(() => {});
    }

    function giveCoins(amount) {
        if (amount <= 0) return;
        coins += amount;
        coinsEl.textContent = coins;
        pendingAward += amount;
        clearTimeout(awardTimer);
        awardTimer = setTimeout(flushAward, 800);
    }

    function respawnPlayer() {
        player.x = respawnPoint.x;
        player.y = respawnPoint.y;
        player.vx = 0;
        player.vy = 0;
    }

    function overlaps(ax, ay, aw, ah, bx, by, bw, bh) {
        // Inclusive on purpose: a player resting exactly flush on top of a
        // platform (the common case right after collision resolution) has
        // zero interpenetration depth and must still count as "touching".
        return ax <= bx + bw && ax + aw >= bx && ay <= by + bh && ay + ah >= by;
    }

    // Rules with a duration (currently just "move") animate smoothly over
    // that many ms instead of snapping instantly. While an animation is in
    // flight for a rule, re-firing that same rule is ignored -- which is
    // also what makes an ambient + infinit.true move rule read as a
    // continuously sliding platform: as soon as one leg finishes, the next
    // frame's re-fire starts the next leg.
    const activeAnimations = [];

    function startMoveAnimation(block, rule, effect) {
        if (rule._anim) return;
        rule._anim = {
            block,
            startX: block.x,
            startY: block.y,
            targetX: block.x + effect.dx,
            targetY: block.y + effect.dy,
            startTime: performance.now(),
            duration: effect.duration,
        };
        activeAnimations.push(rule);
    }

    function updateAnimations(now) {
        for (let i = activeAnimations.length - 1; i >= 0; i--) {
            const rule = activeAnimations[i];
            const anim = rule._anim;
            if (!anim) {
                activeAnimations.splice(i, 1);
                continue;
            }
            const t = Math.min(1, (now - anim.startTime) / Math.max(1, anim.duration));
            anim.block.x = anim.startX + (anim.targetX - anim.startX) * t;
            anim.block.y = anim.startY + (anim.targetY - anim.startY) * t;
            if (t >= 1) {
                rule._anim = null;
                activeAnimations.splice(i, 1);
            }
        }
    }

    function runEffect(block, rule) {
        const effect = rule.effect;
        if (!effect) return;
        if (!conditionHolds(rule.condition)) return;
        switch (effect.type) {
            case "kill":
                respawnPlayer();
                break;
            case "give":
                giveCoins(effect.amount);
                break;
            case "move":
                if (effect.duration) {
                    startMoveAnimation(block, rule, effect);
                } else {
                    block.x += effect.dx;
                    block.y += effect.dy;
                }
                break;
            case "trampoline":
                player.vy = -Math.abs(effect.power);
                player.grounded = false;
                break;
            case "teleport":
                player.x = effect.x;
                player.y = effect.y;
                player.vy = 0;
                break;
            case "transparents":
                block.opacity = Math.max(0, Math.min(100, effect.percent)) / 100;
                break;
            case "set":
                variables[effect.varName] = effect.value;
                break;
            case "change":
                variables[effect.varName] = getVar(effect.varName) + effect.value;
                break;
        }
    }

    function fireTouchRules(block, touching) {
        for (const rule of block.rules) {
            if (rule.trigger !== "touch") continue;
            if (!touching) continue;
            if (rule.infinite || !block.wasTouching) runEffect(block, rule);
        }
    }

    function fireClickRules(block) {
        for (const rule of block.rules) {
            if (rule.trigger === "click") runEffect(block, rule);
        }
    }

    // Ambient rules need no touch/click at all: infinit.true ones re-fire
    // every frame (a permanent background behavior), non-infinite ones
    // fire exactly once, the first frame they're seen.
    function fireAmbientRules(block) {
        for (const rule of block.rules) {
            if (rule.trigger !== "ambient") continue;
            if (rule.infinite) {
                runEffect(block, rule);
            } else if (!rule._ambientFired) {
                rule._ambientFired = true;
                runEffect(block, rule);
            }
        }
    }

    const keys = {};
    window.addEventListener("keydown", (e) => { keys[e.key.toLowerCase()] = true; });
    window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

    function bindHold(el, onDown, onUp) {
        if (!el) return;
        el.addEventListener("pointerdown", (e) => { e.preventDefault(); onDown(); });
        el.addEventListener("pointerup", onUp);
        el.addEventListener("pointerleave", onUp);
        el.addEventListener("pointercancel", onUp);
    }
    bindHold(document.getElementById("studioTouchLeft"), () => { keys["arrowleft"] = true; }, () => { keys["arrowleft"] = false; });
    bindHold(document.getElementById("studioTouchRight"), () => { keys["arrowright"] = true; }, () => { keys["arrowright"] = false; });
    bindHold(document.getElementById("studioTouchJump"), () => { keys[" "] = true; }, () => { keys[" "] = false; });

    canvas.addEventListener("click", (e) => {
        const rect = canvas.getBoundingClientRect();
        const camX = camera.x;
        const camY = camera.y;
        const clickX = (e.clientX - rect.left) + camX;
        const clickY = (e.clientY - rect.top) + camY;
        for (const b of blocks) {
            if (overlaps(clickX, clickY, 1, 1, b.x, b.y, b.width, b.height)) {
                fireClickRules(b);
            }
        }
    });

    const camera = { x: 0, y: 0 };

    function resize() {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }
    window.addEventListener("resize", resize);
    resize();

    function update() {
        if (!player.alive) return;

        updateAnimations(performance.now());
        for (const b of blocks) fireAmbientRules(b);

        player.vx = 0;
        if (keys["arrowleft"] || keys["a"]) { player.vx = -MOVE_SPEED; player.facing = -1; }
        if (keys["arrowright"] || keys["d"]) { player.vx = MOVE_SPEED; player.facing = 1; }
        if ((keys[" "] || keys["arrowup"] || keys["w"]) && player.grounded) {
            player.vy = -JUMP_POWER;
            player.grounded = false;
        }

        player.vy += GRAVITY;
        if (player.vy > 20) player.vy = 20;

        player.x = Math.max(0, Math.min(WORLD_W - player.w, player.x + player.vx));
        player.y += player.vy;
        player.grounded = false;

        for (const b of blocks) {
            if (!b.collidable) continue;
            if (overlaps(player.x, player.y, player.w, player.h, b.x, b.y, b.width, b.height)) {
                const prevBottom = player.y + player.h - player.vy;
                if (player.vy >= 0 && prevBottom <= b.y + 1) {
                    player.y = b.y - player.h;
                    player.vy = 0;
                    player.grounded = true;
                } else if (player.vy < 0 && player.y - player.vy >= b.y + b.height - 1) {
                    player.y = b.y + b.height;
                    player.vy = 0;
                } else if (player.vx > 0) {
                    player.x = b.x - player.w;
                } else if (player.vx < 0) {
                    player.x = b.x + b.width;
                }
            }
        }

        if (player.y > WORLD_H) respawnPlayer();

        for (const b of blocks) {
            const touching = overlaps(player.x, player.y, player.w, player.h, b.x, b.y, b.width, b.height);
            if (touching && b.kind === "checkpoint") {
                respawnPoint.x = b.x + b.width / 2 - PLAYER_W / 2;
                respawnPoint.y = b.y - PLAYER_H;
            }
            fireTouchRules(b, touching);
            b.wasTouching = touching;
        }

        camera.x = Math.max(0, Math.min(WORLD_W - canvas.width, player.x - canvas.width / 2));
        camera.y = Math.max(0, Math.min(WORLD_H - canvas.height, player.y - canvas.height / 2));
    }

    function draw() {
        ctx.fillStyle = "#0f0f11";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        ctx.translate(-camera.x, -camera.y);

        for (const b of blocks) {
            ctx.globalAlpha = b.opacity;
            ctx.fillStyle = b.color;
            ctx.fillRect(b.x, b.y, b.width, b.height);
            ctx.globalAlpha = 1;
        }

        if (showFigure) {
            const cx = player.x + player.w / 2;
            ctx.strokeStyle = "#fff";
            ctx.fillStyle = "#fff";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(cx, player.y + 7, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(cx, player.y + 13);
            ctx.lineTo(cx, player.y + 24);
            ctx.moveTo(cx - 7, player.y + 17);
            ctx.lineTo(cx + 7, player.y + 17);
            ctx.moveTo(cx, player.y + 24);
            ctx.lineTo(cx - 6, player.y + 34);
            ctx.moveTo(cx, player.y + 24);
            ctx.lineTo(cx + 6, player.y + 34);
            ctx.stroke();
        }

        ctx.restore();
    }

    function loop() {
        update();
        draw();
        requestAnimationFrame(loop);
    }

    window.addEventListener("beforeunload", flushAward);
    requestAnimationFrame(loop);
})();
