#!/usr/bin/env python3
"""Download the ACE-Step 1.5 weights ONCE, from one pinned revision, and verify every file.

    python download_model.py [--dest <ACE-Step-1.5>\\checkpoints]

* Only the files listed in model_manifest.json are fetched (no language-model folder, no extras), always
  from the pinned commit of ACE-Step/Ace-Step1.5 on huggingface.co -- never "latest".
* Big files are checked against the SHA-256 that Hugging Face publishes for that commit, small files
  against their git blob id. A file that doesn't match is deleted and the program stops.
* Downloads resume where they stopped (a ".part" file), redirects are only followed over https.
* Standard library only. Afterwards the model server runs completely offline (see serve_model.py).
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "model_manifest.json"
DEFAULT_DEST = Path(os.environ.get("YSOUND_AI_DIR", Path.home() / "ysound-ai")) / "ACE-Step-1.5" / "checkpoints"
CHUNK = 1 << 20


class _HttpsOnlyRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith("https://"):
            raise urllib.error.URLError(f"redirect to a non-https address refused: {newurl[:80]}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


OPENER = urllib.request.build_opener(_HttpsOnlyRedirects)


def sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def git_blob_id(path):
    """The id git gives a file: sha1 of 'blob <size>' + NUL + content."""
    digest = hashlib.sha1(f"blob {os.path.getsize(path)}\0".encode())
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(CHUNK), b""):
            digest.update(block)
    return digest.hexdigest()


def verify(path, info):
    """True if the finished file is exactly what the pinned revision contains."""
    if not path.exists() or path.stat().st_size != info["size"]:
        return False
    if info.get("sha256"):
        return sha256_of(path) == info["sha256"]
    return bool(info.get("git_blob")) and git_blob_id(path) == info["git_blob"]


def fetch(url, part, expected_size):
    have = part.stat().st_size if part.exists() else 0
    request = urllib.request.Request(url, headers={"Range": f"bytes={have}-"} if have else {})
    with OPENER.open(request, timeout=60) as response:
        if have and response.status != 206:             # the server ignored the Range header: start over
            have = 0
        mode = "ab" if have else "wb"
        with open(part, mode) as out:
            done = have
            while True:
                block = response.read(CHUNK)
                if not block:
                    break
                out.write(block)
                done += len(block)
                if done > expected_size:
                    raise OSError("the file is larger than the manifest says")
                print(f"\r  {done / 1e6:8.1f} / {expected_size / 1e6:.1f} MB", end="", flush=True)
    print()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dest", default=str(DEFAULT_DEST))
    args = parser.parse_args(argv)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    dest = Path(args.dest)
    total = sum(info["size"] for info in manifest["files"].values())
    print(f"{manifest['repo']} @ {manifest['revision'][:12]}  ({len(manifest['files'])} files, {total / 1e9:.2f} GB, license {manifest['license']})")
    for name, info in manifest["files"].items():
        target = dest / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if verify(target, info):
            print(f"ok      {name}")
            continue
        part = target.with_name(target.name + ".part")
        print(f"loading {name}")
        url = f"https://huggingface.co/{manifest['repo']}/resolve/{manifest['revision']}/{name}"
        for attempt in range(1, 4):
            try:
                fetch(url, part, info["size"])
                break
            except OSError as exc:
                print(f"  attempt {attempt} failed: {exc}")
                if attempt == 3:
                    return 1
        if not verify(part, info):
            part.unlink(missing_ok=True)
            print(f"FAILED  {name}: the downloaded file does not match the pinned revision -- deleted.", file=sys.stderr)
            return 1
        os.replace(part, target)
        print(f"verified {name}")
    print("All files present and verified.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
