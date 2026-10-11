"""Builds the catalog of the KI-Regal: more than a thousand free AI models that people can download to their own computer.

    python scripts/build_catalog.py             # needs only Python and an internet connection; takes about ten minutes

The models are not stored on our server (that would be many terabytes).  They live at Hugging Face (huggingface.co), the usual public
place for free models.  This script asks its public list (only data about models, no model files) for the most downloaded models of
every kind, looks at each one's files and their sizes, throws away what people should not be sent to (models that need a login, models
for adults, models that exist only as old "pickle" files, test repositories) and writes what is left to static/data/models.json.
The page then works from that file and sends nothing to anybody.  Run the script again to refresh the list.
Everything it learns is kept in a cache in the temp folder, so an interrupted run goes on where it stopped.
"""
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "data", "models.json")
CACHE = os.path.join(tempfile.gettempdir(), "ki-regal-catalog-cache-v2.json")
API = "https://huggingface.co/api"
AGENT = "ki-regal-catalog/1.0 (a list of free models; metadata only)"
PAUSE = 0.2
WORKERS = 2

# key, label, [queries]; a query: what to ask, how many to take, at most how many of one author, the least likes and downloads.
CATEGORIES = [
    ("chat", "Chat & Schreiben", [
        dict(pipeline_tag="text-generation", filter="gguf", want=240, per_author=16, min_downloads=800),
        dict(pipeline_tag="text-generation", filter="safetensors", want=110, per_author=8, min_likes=40, min_size=300e6),
    ]),
    ("vision", "Bilder verstehen", [
        dict(pipeline_tag="image-text-to-text", want=90, per_author=8, min_likes=8, min_size=200e6),
    ]),
    ("image", "Bilder erzeugen", [
        dict(pipeline_tag="text-to-image", want=210, per_author=10, min_likes=12, min_size=150e6),
    ]),
    ("image-edit", "Bilder bearbeiten", [
        dict(pipeline_tag="image-to-image", want=80, per_author=8, min_likes=8, min_size=20e6),
    ]),
    ("video", "Videos erzeugen", [
        dict(pipeline_tag="text-to-video", want=60, per_author=8, min_likes=3, min_size=200e6),
        dict(pipeline_tag="image-to-video", want=60, per_author=8, min_likes=3, min_size=200e6),
    ]),
    ("music", "Musik & Klänge", [
        dict(pipeline_tag="text-to-audio", want=90, per_author=8, min_likes=3, min_size=20e6),
    ]),
    ("speech", "Sprache vorlesen", [
        dict(pipeline_tag="text-to-speech", want=110, per_author=8, min_likes=8, min_size=5e6),
    ]),
    ("listen", "Sprache zu Text", [
        dict(pipeline_tag="automatic-speech-recognition", want=80, per_author=10, min_likes=8, min_size=20e6),
    ]),
    ("audio-edit", "Stimmen & Audio verändern", [
        dict(pipeline_tag="audio-to-audio", want=45, per_author=8, min_likes=3, min_size=5e6),
    ]),
    ("detect", "Bilder analysieren", [
        dict(pipeline_tag="object-detection", want=45, per_author=8, min_likes=8, min_size=5e6),
        dict(pipeline_tag="image-segmentation", want=45, per_author=8, min_likes=8, min_size=5e6),
        dict(pipeline_tag="depth-estimation", want=25, per_author=6, min_likes=5, min_size=5e6),
    ]),
    ("translate", "Übersetzen", [
        dict(pipeline_tag="translation", want=45, per_author=8, min_likes=15, min_size=20e6),
    ]),
    ("embed", "Texte durchsuchen", [
        dict(pipeline_tag="sentence-similarity", want=28, per_author=6, min_likes=40, min_size=20e6),
        dict(pipeline_tag="feature-extraction", want=28, per_author=6, min_likes=40, min_size=20e6),
    ]),
    ("3d", "3D-Modelle", [
        dict(pipeline_tag="image-to-3d", want=25, per_author=6, min_likes=3, min_size=20e6),
        dict(pipeline_tag="text-to-3d", want=15, per_author=6, min_likes=3, min_size=20e6),
    ]),
]

BANNED_NAME = re.compile(r"\b(nsfw|uncensored|abliterated|porn\w*|hentai|lewd|erotic\w*|nude|undress\w*|deepfake\w*|jailbreak\w*|lolita|loli|sexy|waifu)\b", re.I)
BANNED_TAGS = {"not-for-all-audiences", "nsfw", "lora", "adapter"}
SAFE_EXT = (".gguf", ".safetensors", ".onnx", ".tflite")
OLD_EXT = (".bin", ".pt", ".pth", ".ckpt", ".pkl", ".h5", ".msgpack", ".npz", ".mlmodel")
CODE_NAME = re.compile(r"(coder|codestral|starcoder|codellama|code-?llama|deepseek-coder|codegemma|granite-code|qwen.*-code|\bcode\b)", re.I)
SHARD = re.compile(r"^(?P<head>.*?)(?P<idx>\d+)-of-(?P<n>\d+)(?P<tail>\.[A-Za-z0-9_.]+)$")
GGUF_PREFERENCE = ("Q4_K_M", "Q4_K_S", "Q5_K_M", "Q4_0", "Q5_K_S", "Q8_0", "IQ4_XS", "Q3_K_M", "Q6_K")


def get(path, params=None, tries=6):
    url = f"{API}{path}" + (f"?{urllib.parse.urlencode(params, doseq=True)}" if params else "")
    for attempt in range(tries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "application/json"})
            with urllib.request.urlopen(request, timeout=40) as response:
                data = json.load(response)
            time.sleep(PAUSE)
            return data
        except urllib.error.HTTPError as error:
            if error.code in (404, 401, 403):
                return None
            wait = int(error.headers.get("Retry-After", "0") or 0) or 10 * (attempt + 1)
            print(f"  HTTP {error.code} for {path}: waiting {wait}s", flush=True)
            time.sleep(wait)
        except Exception as error:                                                       # the network hiccups now and then
            print(f"  {error!r} for {path}: trying again", flush=True)
            time.sleep(5 * (attempt + 1))
    return None


def usable(item, query, seen_authors):
    """The cheap tests that need no page of the model: not private, not gated, not for adults, enough likes and downloads."""
    model_id = item.get("id") or item.get("modelId")
    tags = set(item.get("tags") or [])
    if not model_id or item.get("private") or item.get("gated") or BANNED_NAME.search(model_id) or tags & BANNED_TAGS:
        return None
    if (item.get("likes") or 0) < query.get("min_likes", 0) or (item.get("downloads") or 0) < query.get("min_downloads", 0):
        return None
    author = model_id.split("/")[0]
    if seen_authors.get(author, 0) >= query["per_author"] * 2:
        return None
    seen_authors[author] = seen_authors.get(author, 0) + 1
    return model_id


def fetch_one(model_id, cache):
    info = get(f"/models/{model_id}", {"blobs": "true"})
    cache[model_id] = raw_facts(info) if info and not info.get("gated") else None


def prefetch(listed, query, cache):
    """Asks for the pages of the models that are likely to be taken, several at once (the answers are kept in the cache)."""
    from concurrent.futures import ThreadPoolExecutor
    authors, wanted = {}, []
    for item in listed:
        model_id = usable(item, query, authors)
        if model_id and model_id not in cache:
            wanted.append(model_id)
        if len(wanted) >= int(query["want"] * 1.35):
            break
    with ThreadPoolExecutor(WORKERS) as pool:
        for n, _ in enumerate(pool.map(lambda m: fetch_one(m, cache), wanted), 1):
            if n % 50 == 0:
                print(f"  {n} of {len(wanted)} pages asked for", flush=True)
    with open(CACHE, "w", encoding="utf-8") as handle:
        json.dump(cache, handle)


def candidates(query):
    params = {"pipeline_tag": query["pipeline_tag"], "sort": "downloads", "direction": "-1", "limit": query.get("limit", 700),
              "expand[]": ["downloads", "likes", "tags", "gated", "lastModified", "createdAt", "library_name", "pipeline_tag", "private"]}
    if query.get("filter"):
        params["filter"] = query["filter"]
    return get("/models", params) or []


def license_of(tags):
    for tag in tags:
        if tag.startswith("license:"):
            return tag[8:]
    return ""


def group_files(weights):
    """[(path, size)] -> [[path, size, parts]]: the pieces of a split model count as one file (path is the first piece, size all of them)."""
    singles, shards = [], {}
    for path, size in weights:
        m = SHARD.match(path)
        if m and int(m["n"]) > 1:
            key = (m["head"], m["n"], m["tail"])
            entry = shards.setdefault(key, {"first": None, "size": 0, "seen": 0, "n": int(m["n"])})
            entry["size"] += size
            entry["seen"] += 1
            if int(m["idx"]) == 1:
                entry["first"] = path
        else:
            singles.append([path, size, 1])
    for entry in shards.values():
        if entry["first"] and entry["seen"] == entry["n"]:                             # all pieces are there; a piece alone is never a file
            singles.append([entry["first"], entry["size"], entry["n"]])
    return singles


def pick_main(files, formats):
    """Which file (or group) is the one to start with, and so how big the download is."""
    if "gguf" in formats:
        usable = [f for f in files if f[0].lower().endswith(".gguf") and "mmproj" not in f[0].lower() and "imatrix" not in f[0].lower()]
        for wanted in GGUF_PREFERENCE:
            for f in usable:
                if wanted.lower() in f[0].lower():
                    return f
        return min(usable, key=lambda f: f[1]) if usable else None
    if "safetensors" in formats:
        plain = [f for f in files if f[0].lower().endswith(".safetensors")]
        return plain
    return files


def raw_facts(info):
    """What the page of a model says that matters (kept in the cache, so that the rules below can change without asking again)."""
    siblings = info.get("siblings") or []
    weights = []
    for s in siblings:
        path = s.get("rfilename", "")
        size = s.get("size") or (s.get("lfs") or {}).get("size") or 0
        if path.lower().endswith(SAFE_EXT) and size:
            weights.append([path, int(size)])
    params = None
    for key in ("safetensors", "gguf"):
        block = info.get(key)
        if isinstance(block, dict) and block.get("total"):
            params = int(block["total"])
            break
    return {"w": weights, "params": params}


def describe(model_id, raw):
    """The facts of one model from what its page said (or None when it is not fit for the list)."""
    weights = [tuple(w) for w in raw["w"]]
    if not weights:
        return None                                                                    # only old pickle files (they can run code), or none
    formats = sorted({p.rsplit(".", 1)[-1].lower() for p, _ in weights})
    files = group_files(weights)
    if not files:
        return None
    if "gguf" in formats:
        main = pick_main(files, formats)
        if not main:
            return None
        size, shown = main[1], sorted([f for f in files if f[0].lower().endswith(".gguf")], key=lambda f: f[1])
        low = min((f[1] for f in shown if "mmproj" not in f[0].lower()), default=size)
        high = max((f[1] for f in shown if "mmproj" not in f[0].lower()), default=size)
    else:
        plain = [f for f in files if f[0].lower().endswith(".safetensors")] or files
        variants = re.compile(r"\.(fp16|bf16|fp32|int8|fp8|ema|non_ema|no_ema)\.|[-_.](fp16|bf16|fp8|ema)\b", re.I)
        base = [f for f in plain if not variants.search(f[0])]
        chosen = base or plain
        size = sum(f[1] for f in chosen)
        shown = sorted(plain, key=lambda f: -f[1])[:24]
        low = high = size
    params = raw["params"]
    if params and not 0.08 <= size / params <= 10:                                      # the page counted only a part (or the wrong thing): better no number than a wrong one
        params = None
    return {"formats": formats, "size": int(size), "low": int(low), "high": int(high), "files": [[f[0], int(f[1]), f[2]] for f in shown[:30]], "params": params}


def build():
    cache = {}
    if os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as handle:
            cache = json.load(handle)
    models, seen = [], set()
    started = time.time()
    for key, label, queries in CATEGORIES:
        taken_in_category = 0
        for query in queries:
            print(f"[{key}] {query['pipeline_tag']}{' + ' + query['filter'] if query.get('filter') else ''}", flush=True)
            listed = candidates(query)
            prefetch(listed, query, cache)
            per_author, taken = {}, 0
            for item in listed:
                if taken >= query["want"]:
                    break
                model_id = item.get("id") or item.get("modelId")
                tags = set(item.get("tags") or [])
                if not model_id or model_id in seen or item.get("private") or item.get("gated"):
                    continue
                if BANNED_NAME.search(model_id) or tags & BANNED_TAGS:
                    continue
                if (item.get("likes") or 0) < query.get("min_likes", 0) or (item.get("downloads") or 0) < query.get("min_downloads", 0):
                    continue
                author = model_id.split("/")[0]
                if per_author.get(author, 0) >= query["per_author"]:
                    continue
                if model_id not in cache:
                    fetch_one(model_id, cache)
                facts = describe(model_id, cache[model_id]) if cache[model_id] else None
                if not facts or facts["size"] < query.get("min_size", 0):
                    continue
                seen.add(model_id)
                per_author[author] = per_author.get(author, 0) + 1
                taken += 1
                category = "code" if key == "chat" and CODE_NAME.search(model_id) else key
                models.append({
                    "id": model_id, "k": category, "d": item.get("downloads") or 0, "l": item.get("likes") or 0,
                    "lic": license_of(item.get("tags") or []), "lib": item.get("library_name") or "",
                    "c": (item.get("createdAt") or "")[:10], "u": (item.get("lastModified") or "")[:10], "task": query["pipeline_tag"],
                    "fmt": facts["formats"], "s": facts["size"], "lo": facts["low"], "hi": facts["high"], "p": facts["params"], "f": facts["files"],
                })
            taken_in_category += taken
            print(f"  -> {taken} of {query['want']} wanted ({len(listed)} looked at)", flush=True)
        print(f"[{key}] {taken_in_category} models", flush=True)
    with open(CACHE, "w", encoding="utf-8") as handle:
        json.dump(cache, handle)
    labels = {key: label for key, label, _ in CATEGORIES}
    labels["code"] = "Programmieren"
    return models, labels


def main():
    models, labels = build()
    models.sort(key=lambda m: -m["d"])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    data = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "source": "huggingface.co", "count": len(models), "labels": labels, "models": models}
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
    by = {}
    for m in models:
        by[m["k"]] = by.get(m["k"], 0) + 1
    print(f"written {len(models)} models to {OUT} ({os.path.getsize(OUT) // 1024} kB)")
    print(by)
    return 0


if __name__ == "__main__":
    sys.exit(main())
