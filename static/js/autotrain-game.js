import * as THREE from "./vendor/three.module.js";
import { buildCharacter } from "./autotrain-character.js";

(() => {
  const appEl = document.getElementById("atGameApp");
  const code = appEl.dataset.code;
  const myUserId = parseInt(appEl.dataset.userId, 10);
  const myGender = appEl.dataset.gender === "f" ? "f" : "m";
  const WAGON_TYPES = JSON.parse(appEl.dataset.wagonTypes);
  const WAGON_LENGTH = parseFloat(appEl.dataset.wagonLength);
  const WAGON_WIDTH = parseFloat(appEl.dataset.wagonWidth);
  const WAGON_COUNT = WAGON_TYPES.length;
  const TRAIN_LENGTH = WAGON_COUNT * WAGON_LENGTH;
  const BUILD_SLOTS = 5;
  const RESOURCE_WAGON = { coal: WAGON_TYPES.indexOf("coal"), iron: WAGON_TYPES.indexOf("iron"), wood: WAGON_TYPES.indexOf("wood") };

  const ITEM_LABEL = {
    coal: "Kohle", iron: "Eisen", wood: "Holz", rail: "Schiene",
    crafting_table: "Werkbank", rail_machine: "Schienen-\nmaschine",
    conveyor_belt: "Rollband", worker_spawner: "Mitarbeiter-\nSpawner", chest: "Truhe",
  };
  const ITEM_SHORT = { coal: "K", iron: "E", wood: "H", rail: "S", crafting_table: "WB", rail_machine: "SM", conveyor_belt: "RB", worker_spawner: "MS", chest: "T" };
  const ITEM_COLOR = { coal: "#2b2b33", iron: "#9aa0a8", wood: "#8a5a34", rail: "#c9c9cf", crafting_table: "#a8703f", rail_machine: "#7e22ce", conveyor_belt: "#525252", worker_spawner: "#c084fc", chest: "#b45309" };
  const RECIPES = {
    rail: { inputs: { iron: 1, wood: 1 }, needsStation: false },
    crafting_table: { inputs: { wood: 2 }, needsStation: false },
    rail_machine: { inputs: { iron: 2, wood: 1 }, needsStation: true },
    conveyor_belt: { inputs: { iron: 3 }, needsStation: true },
    worker_spawner: { inputs: { iron: 1, wood: 14 }, needsStation: true },
  };
  const WORKER_COST = { coal_miner: { wood: 32 }, iron_miner: { wood: 32 }, wood_miner: { wood: 32 } };
  const RAIL_PLACER_COST = { wood: 64, iron: 23 };
  const CHEST_COST = { wood: 12 };
  const WORKER_TASK_LABEL = { coal_miner: "Kohle-Miner", iron_miner: "Eisen-Miner", wood_miner: "Holz-Miner", rail_placer: "Schienen-Leger" };

  // --- DOM refs ---
  const canvasHost = document.getElementById("atCanvasHost");
  const speedBar = document.getElementById("atSpeedBar");
  const trackBar = document.getElementById("atTrackBar");
  const fuelBar = document.getElementById("atFuelBar");
  const interactPrompt = document.getElementById("atInteractPrompt");
  const miningBar = document.getElementById("atMiningBar");
  const miningFill = document.getElementById("atMiningFill");
  const hotbarEl = document.getElementById("atHotbar");
  const craftMenu = document.getElementById("atCraftMenu");
  const craftList = document.getElementById("atCraftList");
  const placeMenu = document.getElementById("atPlaceMenu");
  const placeList = document.getElementById("atPlaceList");
  const machineMenu = document.getElementById("atMachineMenu");
  const machineTitle = document.getElementById("atMachineTitle");
  const machineBody = document.getElementById("atMachineBody");
  const endScreen = document.getElementById("atEndScreen");

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => document.getElementById(btn.dataset.close).classList.add("hidden"));
  });

  // --- Three.js scene setup ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0818);
  scene.fog = new THREE.Fog(0x0d0818, 18, 55);

  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasHost.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x6a5a8f, 0.55));
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.15);
  sun.position.set(12, 22, -8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -30; sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30; sun.shadow.camera.bottom = -30;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xa855f7, 0.35);
  fill.position.set(-10, 8, 10);
  scene.add(fill);

  // Ground -- an oversized flat plane the whole train sits on so nothing
  // ever "runs out" beneath the moving-but-visually-stationary train (see
  // module docstring on the "train stays fixed in world space" choice).
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400),
    new THREE.MeshStandardMaterial({ color: 0x241a38, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Wagon geometry ---
  const WAGON_COLORS = {
    locomotive: 0x3a2f52, coal: 0x1c1c22, iron: 0x4a4650, wood: 0x5a3d24, empty: 0x6b4a30,
  };
  const wagonGroup = new THREE.Group();
  scene.add(wagonGroup);
  const buildSlotMarkers = {}; // "wagon:slot" -> THREE.Object3D (position reference)
  const machineMeshes = {}; // "wagon:slot" -> THREE.Object3D (currently placed machine visual)

  function wagonCenterZ(i) { return i * WAGON_LENGTH + WAGON_LENGTH / 2; }
  function slotWorldPos(wagon, slot) {
    const x = -WAGON_WIDTH / 2 + (slot + 0.5) * (WAGON_WIDTH / BUILD_SLOTS);
    return new THREE.Vector3(x, 0.08, wagonCenterZ(wagon));
  }

  WAGON_TYPES.forEach((type, i) => {
    const z = wagonCenterZ(i);
    const floorMat = new THREE.MeshStandardMaterial({ color: WAGON_COLORS[type] || 0x6b4a30, roughness: 0.85 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(WAGON_WIDTH, 0.16, WAGON_LENGTH - 0.3), floorMat);
    floor.position.set(0, -0.08, z);
    floor.receiveShadow = true;
    floor.castShadow = true;
    wagonGroup.add(floor);

    // Low side walls -- no ceiling, per spec ("von oben Sicht").
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x241634, roughness: 0.8 });
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, WAGON_LENGTH - 0.3), wallMat);
      wall.position.set(side * (WAGON_WIDTH / 2), 0.25, z);
      wall.castShadow = true;
      wagonGroup.add(wall);
    }

    if (type === "locomotive") {
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(WAGON_WIDTH - 0.6, 1.6, WAGON_LENGTH - 2), new THREE.MeshStandardMaterial({ color: 0x2a2040, roughness: 0.6, metalness: 0.2 }));
      cabin.position.set(0, 0.8, z - 1.5);
      cabin.castShadow = true;
      wagonGroup.add(cabin);
      const furnace = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.9, 16), new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.5, emissive: 0x552200, emissiveIntensity: 0.4 }));
      furnace.position.set(0, 0.5, z + WAGON_LENGTH / 2 - 1.1);
      furnace.castShadow = true;
      furnace.userData.isFurnace = true;
      wagonGroup.add(furnace);
      wagonGroup.userData.furnacePos = furnace.position.clone();
      for (let wheel = -1; wheel <= 1; wheel += 2) {
        // decorative only
      }
    } else if (type === "coal" || type === "iron" || type === "wood") {
      const pileColor = type === "coal" ? 0x161616 : type === "iron" ? 0x8f97a3 : 0x6b4326;
      const pile = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1, 0), new THREE.MeshStandardMaterial({ color: pileColor, roughness: 0.9, flatShading: true }));
      pile.position.set(0, 0.5, z);
      pile.scale.set(1.6, 0.75, 1.3);
      pile.castShadow = true;
      pile.receiveShadow = true;
      wagonGroup.add(pile);
    } else {
      // Buildable wagon: mark the 5 slot positions with faint ring outlines.
      for (let slot = 0; slot < BUILD_SLOTS; slot++) {
        const pos = slotWorldPos(i, slot);
        const marker = new THREE.Mesh(
          new THREE.RingGeometry(0.32, 0.4, 24),
          new THREE.MeshBasicMaterial({ color: 0xc084fc, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
        );
        marker.rotation.x = -Math.PI / 2;
        marker.position.copy(pos);
        wagonGroup.add(marker);
        buildSlotMarkers[`${i}:${slot}`] = pos;
      }
    }
  });

  // Rails: a fixed-length strip in front of the locomotive whose visible
  // length reflects the server's track_ahead value -- shrinks as the
  // train "moves" (see module docstring: the train mesh itself never
  // translates, this is the honest stand-in for that motion).
  const railMat = new THREE.MeshStandardMaterial({ color: 0xbfae8f, roughness: 0.6 });
  const railGroup = new THREE.Group();
  scene.add(railGroup);
  const RAIL_GAUGE = 1.1;
  let railMeshes = [];
  function rebuildRails(trackAhead) {
    railGroup.clear();
    railMeshes = [];
    const len = Math.max(0.4, trackAhead);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, len), railMat);
      rail.position.set(side * RAIL_GAUGE / 2, -0.05, -len / 2);
      rail.receiveShadow = true;
      railGroup.add(rail);
    }
    // Sleepers
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
    for (let d = 0.5; d < len; d += 1.1) {
      const sleeper = new THREE.Mesh(new THREE.BoxGeometry(RAIL_GAUGE + 0.5, 0.06, 0.22), sleeperMat);
      sleeper.position.set(0, -0.08, -d);
      railGroup.add(sleeper);
    }
  }
  rebuildRails(40);

  // --- Local + remote players ---
  const myCharacter = buildCharacter(myGender);
  scene.add(myCharacter);
  const myPos = new THREE.Vector3(0, 0, wagonCenterZ(1));
  let myFacing = 0;
  myCharacter.position.copy(myPos);

  const remotePlayers = new Map(); // user_id -> { mesh, targetPos, targetFacing }

  function ensureRemote(userId, gender) {
    let entry = remotePlayers.get(userId);
    if (entry) return entry;
    const mesh = buildCharacter(gender || "m");
    scene.add(mesh);
    entry = { mesh, targetPos: new THREE.Vector3(), targetFacing: 0 };
    remotePlayers.set(userId, entry);
    return entry;
  }

  // --- Camera: fixed high-angle follow, Brawl-Stars style ---
  const CAM_OFFSET = new THREE.Vector3(0, 8.5, 6.5);
  const camTarget = new THREE.Vector3();
  function updateCamera(dt) {
    const desired = myPos.clone().add(CAM_OFFSET);
    camera.position.lerp(desired, Math.min(1, dt * 4));
    camTarget.lerp(myPos.clone().add(new THREE.Vector3(0, 0.9, 0)), Math.min(1, dt * 6));
    camera.lookAt(camTarget);
  }

  // --- Input ---
  const keys = { up: false, down: false, left: false, right: false, mine: false };
  const KEY_MAP = { KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right", KeyF: "mine" };
  document.addEventListener("keydown", (e) => {
    if (KEY_MAP[e.code]) { keys[KEY_MAP[e.code]] = true; e.preventDefault(); }
    if (e.code === "KeyE") onInteractPressed();
    if (e.code === "KeyC") openCraftMenu();
    if (e.code === "KeyB") openPlaceMenu();
    if (e.code === "Escape") { craftMenu.classList.add("hidden"); placeMenu.classList.add("hidden"); machineMenu.classList.add("hidden"); }
  });
  document.addEventListener("keyup", (e) => {
    if (KEY_MAP[e.code]) { keys[KEY_MAP[e.code]] = false; e.preventDefault(); }
  });

  // --- Networking ---
  const socket = io();
  let latestSnapshot = null;
  let myInventory = [null, null, null, null, null];

  socket.on("connect", () => socket.emit("at_join_lobby", { code }));

  socket.on("at_snapshot", (snap) => {
    latestSnapshot = snap;
    if (snap.ended) {
      endScreen.classList.remove("hidden");
      return;
    }
    const me = snap.players[String(myUserId)];
    if (me) {
      myInventory = me.inventory;
      renderHotbar();
      updateMiningUi(me.mining);
    }
    updateTrainHud(snap.train);
    syncMachines(snap.machines);
  });

  socket.on("at_player_moved", (data) => {
    const entry = ensureRemote(data.user_id);
    entry.targetPos.set(data.x, 0, data.z);
    entry.targetFacing = data.facing || 0;
  });

  socket.on("at_player_left", (data) => {
    const entry = remotePlayers.get(data.user_id);
    if (entry) { scene.remove(entry.mesh); remotePlayers.delete(data.user_id); }
  });

  socket.on("at_craft_result", (res) => {
    window.leroxGamesSounds[res.ok ? "solved" : "wrong"]();
    if (!res.ok) showToast(craftFailMessage(res.reason));
  });
  socket.on("at_place_result", (res) => { if (!res.ok) showToast(placeFailMessage(res.reason)); });
  socket.on("at_spawn_result", (res) => { if (!res.ok) showToast("Nicht genug Materialien."); });
  socket.on("at_buy_chest_result", (res) => { if (!res.ok) showToast("Nicht genug Materialien."); });

  function craftFailMessage(reason) {
    if (reason === "needs_station") return "Dafür musst du in der Nähe einer Werkbank sein.";
    if (reason === "missing_materials") return "Nicht genug Materialien.";
    if (reason === "inventory_full") return "Inventar ist voll.";
    return "Geht gerade nicht.";
  }
  function placeFailMessage(reason) {
    if (reason === "occupied") return "Da steht schon etwas.";
    if (reason === "missing_item") return "Das hast du nicht im Inventar.";
    return "Geht gerade nicht.";
  }

  let toastTimer = null;
  function showToast(text) {
    let el = document.getElementById("atToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "atToast";
      el.className = "at-toast";
      document.getElementById("atGameApp").appendChild(el);
    }
    el.textContent = text;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 2200);
  }

  // --- HUD ---
  function updateTrainHud(train) {
    const speedPct = Math.min(100, (train.speed / 3.2) * 100);
    const trackPct = Math.min(100, (train.track_ahead / 40) * 100);
    const fuelPct = Math.min(100, train.fuel);
    speedBar.style.width = speedPct + "%";
    trackBar.style.width = trackPct + "%";
    trackBar.classList.toggle("danger", train.track_ahead < 8);
    fuelBar.style.width = fuelPct + "%";
    fuelBar.classList.toggle("danger", train.fuel <= 0);
    rebuildRails(train.track_ahead);
  }

  function renderHotbar() {
    hotbarEl.innerHTML = "";
    myInventory.forEach((slot, i) => {
      const el = document.createElement("div");
      el.className = "at-hotbar-slot";
      if (slot) {
        el.style.setProperty("--slot-color", ITEM_COLOR[slot.item] || "#666");
        el.innerHTML = `<span class="at-hotbar-icon">${ITEM_SHORT[slot.item] || "?"}</span><span class="at-hotbar-count">${slot.count > 1 ? slot.count : ""}</span>`;
        el.title = ITEM_LABEL[slot.item];
      }
      hotbarEl.appendChild(el);
    });
  }

  function updateMiningUi(mining) {
    if (!mining) { miningBar.classList.add("hidden"); return; }
    const elapsed = (Date.now() / 1000) - mining.started_at;
    const pct = Math.min(100, (elapsed / 12) * 100);
    miningFill.style.width = pct + "%";
    miningBar.classList.remove("hidden");
  }

  // --- Machines: sync visuals from snapshot ---
  function machineMesh(type) {
    if (type === "crafting_table") {
      return new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: 0xa8703f, roughness: 0.7 }));
    }
    if (type === "rail_machine") {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 0.7), new THREE.MeshStandardMaterial({ color: 0x7e22ce, roughness: 0.5, metalness: 0.2 })));
      const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.4, 8), new THREE.MeshStandardMaterial({ color: 0x4a2070 }));
      chimney.position.set(0.2, 0.55, 0.2);
      g.add(chimney);
      return g;
    }
    if (type === "conveyor_belt") {
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.15, 0.5), new THREE.MeshStandardMaterial({ color: 0x525252, roughness: 0.6 }));
      belt.position.y = 0.15;
      return belt;
    }
    if (type === "worker_spawner") {
      return new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.8, 6), new THREE.MeshStandardMaterial({ color: 0xc084fc, roughness: 0.5, emissive: 0x4a1d80, emissiveIntensity: 0.3 }));
    }
    if (type === "chest") {
      return new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.7 }));
    }
    return new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x888 }));
  }

  function syncMachines(machines) {
    for (const key of Object.keys(machineMeshes)) {
      if (!machines[key]) { wagonGroup.remove(machineMeshes[key]); delete machineMeshes[key]; }
    }
    for (const [key, m] of Object.entries(machines)) {
      if (machineMeshes[key]) continue;
      const [wagon, slot] = key.split(":").map(Number);
      const mesh = machineMesh(m.type);
      const pos = slotWorldPos(wagon, slot);
      mesh.position.set(pos.x, m.type === "conveyor_belt" ? 0.3 : 0.35, pos.z);
      mesh.castShadow = true;
      wagonGroup.add(mesh);
      machineMeshes[key] = mesh;
    }
  }

  // --- Movement + interaction detection ---
  function currentWagon() {
    return Math.max(0, Math.min(WAGON_COUNT - 1, Math.floor(myPos.z / WAGON_LENGTH)));
  }

  function collidesWithMachine(x, z) {
    for (const key of Object.keys(machineMeshes)) {
      const pos = machineMeshes[key].position;
      if (Math.abs(pos.x - x) < 0.35 && Math.abs(pos.z - z) < 0.35) return true;
    }
    return false;
  }

  const MOVE_SPEED = 3.4;
  let lastMoveEmit = 0;
  function updateMovement(dt) {
    let dx = 0, dz = 0;
    if (keys.up) dz -= 1;
    if (keys.down) dz += 1;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    if (dx || dz) {
      const len = Math.hypot(dx, dz);
      dx = (dx / len) * MOVE_SPEED * dt;
      dz = (dz / len) * MOVE_SPEED * dt;
      const nx = Math.min(WAGON_WIDTH / 2 - 0.25, Math.max(-WAGON_WIDTH / 2 + 0.25, myPos.x + dx));
      const nz = Math.min(TRAIN_LENGTH - 0.3, Math.max(0.3, myPos.z + dz));
      if (!collidesWithMachine(nx, myPos.z)) myPos.x = nx;
      if (!collidesWithMachine(myPos.x, nz)) myPos.z = nz;
      myFacing = Math.atan2(dx, dz);
      myCharacter.position.copy(myPos);
      myCharacter.rotation.y = myFacing;

      const now = performance.now();
      if (now - lastMoveEmit > 66) {
        socket.emit("at_move", { x: myPos.x, z: myPos.z, wagon: currentWagon(), facing: myFacing });
        lastMoveEmit = now;
      }
    }
  }

  // --- F to mine ---
  let mining = false;
  function updateMining() {
    const wagon = currentWagon();
    const resource = Object.keys(RESOURCE_WAGON).find((r) => RESOURCE_WAGON[r] === wagon);
    if (keys.mine && resource && !mining) {
      mining = true;
      socket.emit("at_mine_start", { resource });
    } else if ((!keys.mine || !resource) && mining) {
      mining = false;
      socket.emit("at_mine_cancel");
    }
  }

  // --- E to interact (furnace / machines) ---
  function nearestMachineKey() {
    let best = null, bestDist = 1.1;
    for (const key of Object.keys(machineMeshes)) {
      const pos = machineMeshes[key].position;
      const d = Math.hypot(pos.x - myPos.x, pos.z - myPos.z);
      if (d < bestDist) { bestDist = d; best = key; }
    }
    return best;
  }

  function nearFurnace() {
    const fp = wagonGroup.userData.furnacePos;
    if (!fp) return false;
    return Math.hypot(fp.x - myPos.x, fp.z - myPos.z) < 1.3;
  }

  function updateInteractPrompt() {
    if (nearFurnace()) {
      interactPrompt.textContent = "E: Kohle in den Ofen legen";
      interactPrompt.classList.remove("hidden");
      return;
    }
    const key = nearestMachineKey();
    if (key && latestSnapshot && latestSnapshot.machines[key]) {
      interactPrompt.textContent = "E: " + (ITEM_LABEL[latestSnapshot.machines[key].type] || "Maschine");
      interactPrompt.classList.remove("hidden");
      return;
    }
    interactPrompt.classList.add("hidden");
  }

  function onInteractPressed() {
    if (nearFurnace()) {
      socket.emit("at_feed_furnace");
      window.leroxGamesSounds.click();
      return;
    }
    const key = nearestMachineKey();
    if (key) openMachineMenu(key);
  }

  function stationNearby() {
    for (const key of Object.keys(machineMeshes)) {
      const pos = machineMeshes[key].position;
      const isTable = latestSnapshot && latestSnapshot.machines[key] && latestSnapshot.machines[key].type === "crafting_table";
      if (isTable && Math.hypot(pos.x - myPos.x, pos.z - myPos.z) < 2.2) return true;
    }
    return false;
  }

  // --- Crafting menu ---
  function openCraftMenu() {
    craftList.innerHTML = "";
    for (const [item, recipe] of Object.entries(RECIPES)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "at-recipe-btn";
      const need = Object.entries(recipe.inputs).map(([k, v]) => `${v}× ${ITEM_LABEL[k]}`).join(" + ");
      btn.innerHTML = `<b>${ITEM_LABEL[item]}</b><span>${need}</span>${recipe.needsStation ? '<span class="station">Werkbank nötig</span>' : ""}`;
      btn.addEventListener("click", () => {
        socket.emit("at_craft", { output_item: item, station_nearby: stationNearby() });
        window.leroxGamesSounds.click();
      });
      craftList.appendChild(btn);
    }
    craftMenu.classList.remove("hidden");
    placeMenu.classList.add("hidden");
    machineMenu.classList.add("hidden");
  }

  // --- Place menu ---
  function nearestEmptySlotInCurrentWagon() {
    const wagon = currentWagon();
    if (WAGON_TYPES[wagon] !== "empty") return null;
    let best = null, bestDist = Infinity;
    for (let slot = 0; slot < BUILD_SLOTS; slot++) {
      const key = `${wagon}:${slot}`;
      if (latestSnapshot && latestSnapshot.machines[key]) continue;
      const pos = slotWorldPos(wagon, slot);
      const d = Math.hypot(pos.x - myPos.x, pos.z - myPos.z);
      if (d < bestDist) { bestDist = d; best = { wagon, slot }; }
    }
    return best;
  }

  function openPlaceMenu() {
    placeList.innerHTML = "";
    const placeable = myInventory.filter((s) => s && ["crafting_table", "rail_machine", "conveyor_belt", "worker_spawner", "chest"].includes(s.item));
    if (placeable.length === 0) {
      placeList.innerHTML = '<p class="at-empty-hint">Nichts zum Platzieren im Inventar.</p>';
    }
    for (const slot of placeable) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "at-recipe-btn";
      btn.innerHTML = `<b>${ITEM_LABEL[slot.item]}</b>`;
      btn.addEventListener("click", () => {
        const target = nearestEmptySlotInCurrentWagon();
        if (!target) { showToast("Kein leerer Bauplatz in der Nähe -- geh auf einen freien Wagon."); return; }
        socket.emit("at_place_block", { wagon: target.wagon, slot: target.slot, block_type: slot.item });
        placeMenu.classList.add("hidden");
      });
      placeList.appendChild(btn);
    }
    placeMenu.classList.remove("hidden");
    craftMenu.classList.add("hidden");
    machineMenu.classList.add("hidden");
  }

  // --- Machine interaction menu ---
  function openMachineMenu(key) {
    const machine = latestSnapshot.machines[key];
    if (!machine) return;
    const [wagon, slot] = key.split(":").map(Number);
    machineTitle.textContent = ITEM_LABEL[machine.type];
    machineBody.innerHTML = "";

    if (machine.type === "rail_machine") {
      const info = document.createElement("p");
      info.className = "at-machine-info";
      info.textContent = `Eisen: ${machine.input.iron || 0}/2 · Holz: ${machine.input.wood || 0}/1 · Fertig: ${machine.output}/5`;
      machineBody.appendChild(info);
      for (const item of ["iron", "wood"]) {
        const btn = document.createElement("button");
        btn.className = "at-recipe-btn";
        btn.textContent = `1× ${ITEM_LABEL[item]} einfüllen`;
        btn.addEventListener("click", () => socket.emit("at_feed_machine", { wagon, slot, item }));
        machineBody.appendChild(btn);
      }
      const collect = document.createElement("button");
      collect.className = "at-recipe-btn primary";
      collect.textContent = "Schienen sammeln";
      collect.addEventListener("click", () => socket.emit("at_collect_machine", { wagon, slot }));
      machineBody.appendChild(collect);
    } else if (machine.type === "conveyor_belt") {
      const info = document.createElement("p");
      info.className = "at-machine-info";
      info.textContent = "Richtung: " + (machine.direction === "forward" ? "vorwärts" : "rückwärts");
      machineBody.appendChild(info);
      const toggle = document.createElement("button");
      toggle.className = "at-recipe-btn";
      toggle.textContent = "Richtung wechseln";
      toggle.addEventListener("click", () => socket.emit("at_toggle_belt", { wagon, slot }));
      machineBody.appendChild(toggle);
    } else if (machine.type === "worker_spawner") {
      for (const task of ["coal_miner", "iron_miner", "wood_miner"]) {
        const btn = document.createElement("button");
        btn.className = "at-recipe-btn";
        btn.innerHTML = `<b>${WORKER_TASK_LABEL[task]}</b><span>${WORKER_COST[task].wood}× Holz</span>`;
        btn.addEventListener("click", () => socket.emit("at_spawn_worker", { wagon, slot, task }));
        machineBody.appendChild(btn);
      }
      const railPlacerBtn = document.createElement("button");
      railPlacerBtn.className = "at-recipe-btn";
      railPlacerBtn.innerHTML = `<b>${WORKER_TASK_LABEL.rail_placer}</b><span>${RAIL_PLACER_COST.wood}× Holz + ${RAIL_PLACER_COST.iron}× Eisen</span>`;
      railPlacerBtn.addEventListener("click", () => socket.emit("at_spawn_worker", { wagon, slot, task: "rail_placer" }));
      machineBody.appendChild(railPlacerBtn);
      const chestBtn = document.createElement("button");
      chestBtn.className = "at-recipe-btn";
      chestBtn.innerHTML = `<b>Truhe kaufen</b><span>${CHEST_COST.wood}× Holz</span>`;
      chestBtn.addEventListener("click", () => socket.emit("at_buy_chest", { wagon, slot }));
      machineBody.appendChild(chestBtn);
    } else if (machine.type === "chest") {
      const info = document.createElement("p");
      info.className = "at-machine-info";
      info.textContent = `Filter: ${machine.filter ? ITEM_LABEL[machine.filter] : "keiner"} · Inhalt: ${machine.items}`;
      machineBody.appendChild(info);
      for (const item of ["coal", "iron", "wood", "rail"]) {
        const btn = document.createElement("button");
        btn.className = "at-recipe-btn";
        btn.textContent = "Filter: " + ITEM_LABEL[item];
        btn.addEventListener("click", () => socket.emit("at_set_chest_filter", { wagon, slot, item }));
        machineBody.appendChild(btn);
      }
      const collect = document.createElement("button");
      collect.className = "at-recipe-btn primary";
      collect.textContent = "Inhalt sammeln";
      collect.addEventListener("click", () => socket.emit("at_collect_machine", { wagon, slot }));
      machineBody.appendChild(collect);
    } else {
      machineBody.innerHTML = '<p class="at-machine-info">Nichts zu tun hier.</p>';
    }
    machineMenu.classList.remove("hidden");
    craftMenu.classList.add("hidden");
    placeMenu.classList.add("hidden");
  }

  // --- Main loop ---
  let last = performance.now();
  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;

    updateMovement(dt);
    updateMining();
    updateInteractPrompt();
    if (latestSnapshot && latestSnapshot.players[String(myUserId)]) {
      updateMiningUi(latestSnapshot.players[String(myUserId)].mining);
    }
    for (const entry of remotePlayers.values()) {
      entry.mesh.position.lerp(entry.targetPos, Math.min(1, dt * 8));
      entry.mesh.rotation.y += (entry.targetFacing - entry.mesh.rotation.y) * Math.min(1, dt * 8);
    }
    updateCamera(dt);
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  window.addEventListener("beforeunload", () => socket.emit("at_leave_lobby"));
})();
