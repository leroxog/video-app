"""Pure server-side simulation for AutoTrain (LEROX Games): an accelerating
train that six wagons long, that players ride while mining coal/iron/wood,
crafting rails and machines, and keeping the track ahead of the
locomotive supplied so it doesn't run out and derail. No Flask/DB/Socket.IO
imports here on purpose -- app.py owns the Socket.IO event wiring and the
per-lobby tick loop (see _at_lobbies/_at_tick_loop there); this module is
just the rules of the simulation itself, kept testable without a running
server, same separation kampumion.py/pcwar.py already use.

Wagon layout is fixed for every lobby (index 0 is the front):
    0 locomotive -- has the furnace, burns coal for... nothing mechanical
      yet (see module docstring in app.py's autotrain section) beyond
      being the coal sink -- it's the flavor reason coal matters.
    1 coal   -- mineable coal pile
    2 empty  -- buildable, 5 slots across, adjacent to wagons 1 and 3
    3 iron   -- mineable iron pile
    4 empty  -- buildable, 5 slots across, adjacent to wagons 3 and 5
    5 wood   -- mineable wood pile
That adjacency is deliberate: a Rail Machine (needs iron+wood) placed in
wagon 4 sits directly next to both of its own ingredients.
"""
import time
import uuid

WAGON_TYPES = ["locomotive", "coal", "empty", "iron", "empty", "wood"]
WAGON_COUNT = len(WAGON_TYPES)
WAGON_LENGTH = 9.0
WAGON_WIDTH = 4.0
BUILD_SLOTS_PER_WAGON = 5

RESOURCE_WAGONS = {"coal": 1, "iron": 3, "wood": 5}
# Which buildable (empty) wagon sits next to each resource wagon -- powers
# the "mining feeds an adjacent machine directly" rule.
ADJACENT_EMPTY_WAGON = {1: 2, 3: (2, 4), 5: 4}

MINE_SECONDS = 12.0
MACHINE_PROCESS_SECONDS = 6.0
WORKER_WALK_SPEED = 2.2  # world units/second
WORKER_MINE_SECONDS = MINE_SECONDS

INVENTORY_SLOTS = 5
STACKABLE_CAP = 32
TOOL_ITEMS = {"crafting_table", "rail_machine", "conveyor_belt", "worker_spawner", "chest"}

# Train physics: starts almost stationary and ramps up very slowly, capped
# well short of anything twitchy -- the whole point is an unhurried early
# game that only gets tense once speed (and therefore track consumption)
# has climbed for a while.
TRAIN_ACCEL = 0.012  # units/sec^2
TRAIN_MAX_SPEED = 3.2  # units/sec
STARTING_TRACK_AHEAD = 40.0  # units of pre-laid track before anyone must place more
RAIL_PLACEMENT_LENGTH = 6.0  # units of track one placed rail adds

# The furnace (locomotive, feed with coal via "E") gives coal a real
# mechanical purpose beyond flavor: let it run dry and the train's
# effective speed drops sharply until it's fed again. base_speed (the
# pure accel-over-time number) never regresses while starved -- only the
# effective train["speed"] used for actual movement does -- so refueling
# immediately restores full speed instead of having "lost" progress.
FUEL_PER_COAL = 25.0
FUEL_DRAIN_PER_SECOND = 1.0
FUEL_STARVED_SPEED_MULT = 0.4

WORKER_TASKS = ("coal_miner", "iron_miner", "wood_miner", "rail_placer")

RECIPES = {
    # output_item: {"inputs": {item: count}, "needs_station": bool}
    "rail": {"inputs": {"iron": 1, "wood": 1}, "needs_station": False},
    "crafting_table": {"inputs": {"wood": 2}, "needs_station": False},
    "rail_machine": {"inputs": {"iron": 2, "wood": 1}, "needs_station": True},
    "conveyor_belt": {"inputs": {"iron": 3}, "needs_station": True},
    "worker_spawner": {"inputs": {"iron": 1, "wood": 14}, "needs_station": True},
}

# Costs paid *at* a placed worker_spawner machine (not inventory crafting)
# -- see spawn_worker()/buy_chest() below.
WORKER_COST = {"coal_miner": {"wood": 32}, "iron_miner": {"wood": 32}, "wood_miner": {"wood": 32}}
RAIL_PLACER_COST = {"wood": 64, "iron": 23}
CHEST_COST = {"wood": 12}

MACHINE_RECIPES = {
    # What a placed machine of this type turns raw materials into, and
    # what it accepts as input -- rail_machine is the only processing
    # machine right now (matches the spec: "Rollband" moves items, it
    # doesn't itself transform them; a worker_spawner isn't a processor;
    # a chest just stores).
    "rail_machine": {"input": {"iron": 2, "wood": 1}, "output": ("rail", 1)},
}


def new_inventory():
    return [None for _ in range(INVENTORY_SLOTS)]


def stack_cap(item):
    return 1 if item in TOOL_ITEMS else STACKABLE_CAP


def add_to_inventory(inventory, item, count=1):
    """Mutates `inventory` in place. Tries existing matching stacks first,
    then the first empty slot, matching Minecraft-style hotbar behavior.
    Returns how many of `count` were actually added -- callers (see
    app.py's mining-completion handler) treat "less than requested" as
    "the rest was lost, inventory was full," per this game's explicit
    "voll -> Gegenstand wird gelöscht statt aufbewahrt" design."""
    remaining = count
    cap = stack_cap(item)
    if cap > 1:
        for slot in inventory:
            if remaining <= 0:
                break
            if slot and slot["item"] == item and slot["count"] < cap:
                take = min(cap - slot["count"], remaining)
                slot["count"] += take
                remaining -= take
    for i, slot in enumerate(inventory):
        if remaining <= 0:
            break
        if slot is None:
            take = min(cap, remaining) if cap > 1 else 1
            inventory[i] = {"item": item, "count": take}
            remaining -= take
    return count - remaining


def remove_from_inventory(inventory, item, count):
    """True/False for "had enough and removed it" -- never partially
    removes on failure, so a caller can check-then-act without needing a
    separate has_items() call first."""
    have = sum(slot["count"] for slot in inventory if slot and slot["item"] == item)
    if have < count:
        return False
    remaining = count
    for i, slot in enumerate(inventory):
        if remaining <= 0:
            break
        if slot and slot["item"] == item:
            take = min(slot["count"], remaining)
            slot["count"] -= take
            remaining -= take
            if slot["count"] <= 0:
                inventory[i] = None
    return True


def has_items(inventory, requirements):
    counts = {}
    for slot in inventory:
        if slot:
            counts[slot["item"]] = counts.get(slot["item"], 0) + slot["count"]
    return all(counts.get(item, 0) >= need for item, need in requirements.items())


def craft(inventory, output_item, station_nearby):
    """Attempts to craft `output_item` from RECIPES, consuming inputs from
    `inventory` in place. Returns (ok, reason) -- reason is only set on
    failure, for the caller to relay back to the client ("needs a nearby
    crafting table", "not enough materials", "unknown recipe")."""
    recipe = RECIPES.get(output_item)
    if recipe is None:
        return False, "unknown_recipe"
    if recipe["needs_station"] and not station_nearby:
        return False, "needs_station"
    if not has_items(inventory, recipe["inputs"]):
        return False, "missing_materials"
    for item, need in recipe["inputs"].items():
        remove_from_inventory(inventory, item, need)
    added = add_to_inventory(inventory, output_item, 1)
    if added == 0:
        # Inventory was full at the exact moment of crafting -- materials
        # already spent, matches this game's "full inventory just loses
        # the item" stance rather than silently refunding the recipe.
        return False, "inventory_full"
    return True, None


def new_train_state(now=None):
    now = now if now is not None else time.time()
    return {
        "started_at": now, "base_speed": 0.0, "speed": 0.0, "distance": 0.0,
        "track_ahead": STARTING_TRACK_AHEAD, "fuel": 100.0,
    }


def tick_train(train, dt):
    """Advances the train by `dt` seconds. Returns True if it just ran out
    of track (derailed) -- the caller (app.py) ends the round on that."""
    train["base_speed"] = min(TRAIN_MAX_SPEED, train["base_speed"] + TRAIN_ACCEL * dt)
    train["fuel"] = max(0.0, train["fuel"] - FUEL_DRAIN_PER_SECOND * dt)
    train["speed"] = train["base_speed"] * (1.0 if train["fuel"] > 0 else FUEL_STARVED_SPEED_MULT)
    advance = train["speed"] * dt
    train["distance"] += advance
    train["track_ahead"] -= advance
    if train["track_ahead"] <= 0:
        train["track_ahead"] = 0
        return True
    return False


def feed_furnace(train, coal_count=1):
    train["fuel"] = min(100.0, train["fuel"] + FUEL_PER_COAL * coal_count)


def place_rail(train):
    """A placed rail immediately extends the track-ahead buffer -- there's
    no separate "walk it to the front" step for a player-placed rail
    (that's what the rail_placer worker exists to automate instead)."""
    train["track_ahead"] += RAIL_PLACEMENT_LENGTH


def new_machine(machine_type, direction=None):
    machine = {"id": uuid.uuid4().hex[:10], "type": machine_type}
    if machine_type == "rail_machine":
        machine["input"] = {}
        machine["output"] = 0
        machine["progress"] = 0.0
    elif machine_type == "conveyor_belt":
        machine["direction"] = direction or "forward"
    elif machine_type == "chest":
        machine["filter"] = None
        machine["items"] = 0
    return machine


def tick_machine(machine, dt):
    """Only rail_machine actually processes anything over time -- returns
    True if it just finished producing one output item this tick (purely
    informational, e.g. for a client-side "ping" sound)."""
    if machine["type"] != "rail_machine":
        return False
    recipe = MACHINE_RECIPES["rail_machine"]
    if machine["output"] >= 5:
        return False
    if not all(machine["input"].get(item, 0) >= need for item, need in recipe["input"].items()):
        return False
    machine["progress"] += dt
    if machine["progress"] >= MACHINE_PROCESS_SECONDS:
        machine["progress"] = 0.0
        for item, need in recipe["input"].items():
            machine["input"][item] -= need
        machine["output"] += 1
        return True
    return False


def feed_machine(machine, item, count=1):
    """Manual or auto-feed of raw material into a machine's input buffer
    -- silently a no-op for machine types that don't accept input (chest/
    conveyor/worker_spawner), callers don't need to type-check first."""
    if machine["type"] != "rail_machine":
        return False
    recipe = MACHINE_RECIPES["rail_machine"]
    if item not in recipe["input"]:
        return False
    machine["input"][item] = machine["input"].get(item, 0) + count
    return True


def adjacent_machine_wagon(resource_wagon):
    """Which buildable wagon(s) sit next to a resource wagon -- for wagon
    3 (iron) there are two (2 and 4), since it's flanked by both empty
    wagons; app.py checks both when deciding whether a mined item should
    auto-feed a machine instead of landing in the miner's own inventory."""
    slot = ADJACENT_EMPTY_WAGON.get(resource_wagon)
    if slot is None:
        return ()
    return slot if isinstance(slot, tuple) else (slot,)


def new_worker(task, wagon):
    return {
        "id": uuid.uuid4().hex[:10], "task": task, "home_wagon": wagon,
        "state": "walking", "progress": 0.0, "carrying": None,
    }


def spawn_worker(inventory, task):
    if task == "rail_placer":
        if not has_items(inventory, RAIL_PLACER_COST):
            return None, "missing_materials"
        for item, need in RAIL_PLACER_COST.items():
            remove_from_inventory(inventory, item, need)
        return new_worker("rail_placer", wagon=0), None
    cost = WORKER_COST.get(task)
    if cost is None:
        return None, "unknown_task"
    if not has_items(inventory, cost):
        return None, "missing_materials"
    for item, need in cost.items():
        remove_from_inventory(inventory, item, need)
    wagon = RESOURCE_WAGONS[task.replace("_miner", "")]
    return new_worker(task, wagon=wagon), None


def buy_chest(inventory):
    if not has_items(inventory, CHEST_COST):
        return False
    for item, need in CHEST_COST.items():
        remove_from_inventory(inventory, item, need)
    return True
