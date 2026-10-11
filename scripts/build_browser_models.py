"""Makes static/data/browser-models.json: the few models that the chat page of KI-Regal can run inside the visitor's browser.

These are not any models from the big list: they have to be in the ONNX format that Transformers.js (static/vendor/transformers) can run,
small enough for a normal PC, and good enough to talk to.  For each model the sizes are read from Hugging Face (what the browser has
to download for each variant), so that the page can say it honestly.  Only metadata is asked for; no model file is downloaded here.

Run:  python scripts/build_browser_models.py
"""
import datetime
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "static", "data", "browser-models.json")
API = "https://huggingface.co/api/models/"
LIBRARY = {"name": "Transformers.js", "version": "4.3.0"}
SMALL_FILES = ("config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "chat_template.jinja",
               "added_tokens.json", "merges.txt", "vocab.json", "tokenizer.model")

# The order is the order on the page.  `commercial` is only a hint (read the licence); `gpu` says that the model needs a graphics card with
# WebGPU (it has no variant that a normal processor can run).
MODELS = [
    {"id": "onnx-community/gemma-3-1b-it-ONNX", "name": "Gemma 3", "maker": "Google", "params": "1 Mrd.", "tag": "Empfohlen",
     "note": "Antwortet für seine Größe ordentlich und flüssig, auch auf Deutsch. Der beste Einstieg.",
     "german": "gut", "license": "Gemma-Nutzungsbedingungen", "commercial": True},
    {"id": "onnx-community/Llama-3.2-1B-Instruct-ONNX", "name": "Llama 3.2", "maker": "Meta", "params": "1 Mrd.", "tag": "Allrounder",
     "note": "Kann mehrere Sprachen, darunter Deutsch, und schreibt flüssig.",
     "german": "gut", "license": "Llama-3.2-Lizenz", "commercial": True},
    {"id": "onnx-community/Qwen2.5-1.5B-Instruct", "name": "Qwen 2.5", "maker": "Alibaba", "params": "1,5 Mrd.", "tag": "Etwas größer",
     "note": "Mehr Wissen als die 1-Mrd.-Modelle, dafür ein größerer Download.",
     "german": "ok", "license": "Apache 2.0", "commercial": True},
    {"id": "onnx-community/Qwen2.5-Coder-1.5B-Instruct", "name": "Qwen 2.5 Coder", "maker": "Alibaba", "params": "1,5 Mrd.", "tag": "Zum Programmieren",
     "note": "Schreibt und erklärt Code in vielen Sprachen. Für Alltagsfragen nimm lieber eins der anderen.",
     "german": "ok", "license": "Apache 2.0", "commercial": True},
    {"id": "onnx-community/Phi-3.5-mini-instruct-onnx-web", "name": "Phi 3.5 mini", "maker": "Microsoft", "params": "3,8 Mrd.", "tag": "Am stärksten, große Datei",
     "note": "Das stärkste Modell hier, besonders bei Logik und Programmieren. Braucht eine Grafikkarte mit WebGPU und viel Speicher; Deutsch ist nicht seine Stärke.",
     "german": "einfach", "license": "MIT", "commercial": True, "gpu": True},
    {"id": "onnx-community/Qwen2.5-0.5B-Instruct", "name": "Qwen 2.5 winzig", "maker": "Alibaba", "params": "0,5 Mrd.", "tag": "Nur für schwache Geräte",
     "note": "Sehr klein und schnell, aber auf Deutsch oft ungenau und bei längeren Antworten unzuverlässig. Nimm es nur, wenn die anderen nicht laufen.",
     "german": "einfach", "license": "Apache 2.0", "commercial": True},
]
DTYPES = ("q4f16", "q4")


def get(model_id):
    request = urllib.request.Request(f"{API}{model_id}?blobs=true", headers={"User-Agent": "ki-regal-build/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def size_of(sibling):
    return int(sibling.get("size") or (sibling.get("lfs") or {}).get("size") or 0)


def variants(info):
    """{dtype: {"bytes": what the browser downloads for this variant (the model file, its data files, the tokenizer and the settings),
    "files": the big files (the model and its data): the page knows that a variant is in the browser when all of them are}}."""
    files = {s["rfilename"]: size_of(s) for s in info["siblings"]}
    small = sum(size for name, size in files.items() if name in SMALL_FILES)
    result = {}
    for dtype in DTYPES:
        main = f"onnx/model_{dtype}.onnx"
        if main not in files:
            continue
        pattern = re.compile(rf"^onnx/model_{dtype}\.onnx(_data(_\d+)?)?$")
        names = sorted(name for name in files if pattern.match(name))
        result[dtype] = {"bytes": small + sum(files[name] for name in names), "files": names}
    return result


def main():
    models = []
    for spec in MODELS:
        info = get(spec["id"])
        if info.get("gated") or info.get("private"):
            sys.exit(f"{spec['id']} needs a login: not usable")
        sizes = variants(info)
        if not sizes:
            sys.exit(f"{spec['id']}: no q4f16 or q4 file")
        if spec.get("gpu") is None and "q4" not in sizes:
            spec = {**spec, "gpu": True}
        models.append({**spec, "dtypes": {k: v["bytes"] for k, v in sizes.items()}, "files": {k: v["files"] for k, v in sizes.items()}, "updated": (info.get("lastModified") or "")[:10]})
        print(spec["id"], {k: (round(v["bytes"] / 1e6), len(v["files"])) for k, v in sizes.items()})
    data = {"generated": datetime.date.today().isoformat(), "library": LIBRARY, "models": models}
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, separators=(",", ":"))
    print(f"written {len(models)} models to {OUT}")


if __name__ == "__main__":
    main()
