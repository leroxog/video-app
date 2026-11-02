"""Satürn: the videos of the account "Short_Stories7k" (scripts/short_stories.py).

Two steps:
  1. `build`   makes the list (manifest.json) of the videos of a folder: it reads the length and the picture size of every MP4 from its own header, and makes the name and the description:
               name         "<Person> in <N> Sekunden"
               description  "Glückwunsch du hast das Leben von <Person> in <N> Sekunden verstanden!!!"
               N is the length in SECONDS (never minutes: 78 seconds stay "78 Sekunden"), rounded to a whole second.
  2. `upload`   signs in as the account (YOU type the password: it is asked for here, or read from the variable SATUERN_PASSWORD, and it is never written anywhere; with --signup the account is
               made first: you choose the password and say how old you are) and puts one video
               after the other online, as a post: the first line of the text is the name, the second the description. The site lets one account upload 40 files an hour; when it says "too many", the
               script waits and goes on. What is online is written to uploaded.json, so a second run continues where the first one stopped.

Examples:
  python scripts/short_stories.py build  --source short_stories_source.json --videos DIR_WITH_THE_MP4S --out ..\\short-stories-7k
  python scripts/short_stories.py upload --folder ..\\short-stories-7k --login Short_Stories7k --site https://nexai.up.railway.app
The account has to exist before the upload: sign up on the site, or add --signup (a name has at most 15 letters, digits or _)."""
import argparse
import getpass
import json
import os
import re
import shutil
import struct
import sys
import time

MAX_POST = 280                                           # the characters of a post (yipi.py: MAX_POST)
RETRY_WAIT = 150                                         # seconds to wait when the site says "too many" (the upload limit is 40 an hour)


# ------------------------------------------------------------------------------------------------------------------ what is in an MP4
def _boxes(data, start, end):
    """(kind, body_start, body_end) of the boxes between two places of the file."""
    i = start
    while i + 8 <= end:
        size, kind = struct.unpack(">I4s", data[i:i + 8])
        header = 8
        if size == 1 and i + 16 <= end:
            size = struct.unpack(">Q", data[i + 8:i + 16])[0]
            header = 16
        elif size == 0:
            size = end - i
        if size < header:
            return
        yield kind, i + header, min(end, i + size)
        i += size


def mp4_facts(data):
    """{seconds, width, height} of an MP4 (from the movie header and the header of the first track with a picture), or None."""
    moov = next(((a, b) for kind, a, b in _boxes(data, 0, len(data)) if kind == b"moov"), None)
    if moov is None:
        return None
    seconds, width, height = None, 0, 0
    for kind, a, b in _boxes(data, *moov):
        if kind == b"mvhd" and b - a >= 20:
            if data[a] == 1 and b - a >= 32:
                scale, length = struct.unpack(">IQ", data[a + 20:a + 32])
            else:
                scale, length = struct.unpack(">II", data[a + 12:a + 20])
            seconds = length / scale if scale else None
        elif kind == b"trak" and not width:
            for inner, c, d in _boxes(data, a, b):
                if inner == b"tkhd":
                    offset = 88 if data[c] == 1 else 76                       # the picture size: two numbers of 16.16 at the end of the header
                    if d - c >= offset + 8:
                        width, height = (round(v / 65536) for v in struct.unpack(">II", data[c + offset:c + offset + 8]))
    if seconds is None:
        return None
    return {"seconds": seconds, "width": int(width), "height": int(height)}


# ------------------------------------------------------------------------------------------------------------------ the texts
def whole_seconds(exact):
    """The length in whole seconds (at least 1): 49.7 -> 50. Never minutes."""
    return max(1, int(round(float(exact))))


def texts(person, seconds):
    """(name, description) of a video: "<Person> in <N> Sekunden" and the line of congratulation. `seconds` is a whole number of seconds, however long the video is (78, not 1 minute 18)."""
    person = re.sub(r"\s+", " ", str(person)).strip()
    return f"{person} in {seconds} Sekunden", f"Glückwunsch du hast das Leben von {person} in {seconds} Sekunden verstanden!!!"


def post_text(name, description):
    """The text of the post: the name on the first line, the description on the second."""
    return f"{name}\n{description}"


def slug(person):
    return re.sub(r"[^A-Za-z0-9]+", "_", person).strip("_") or "video"


# ------------------------------------------------------------------------------------------------------------------ step 1: the list
def build_manifest(source, videos, out):
    """Copies the videos (named by their `blob` in the folder `videos`, with .mp4) into `out/videos` and writes `out/manifest.json`. `source` is a list of {n, name, blob}. Returns the list."""
    os.makedirs(os.path.join(out, "videos"), exist_ok=True)
    rows = []
    for item in sorted(source, key=lambda row: row["n"]):
        origin = os.path.join(videos, f"{item['blob']}.mp4")
        if not os.path.exists(origin):
            raise FileNotFoundError(f"{item['name']}: {origin} is missing")
        with open(origin, "rb") as handle:
            facts = mp4_facts(handle.read())
        if not facts:
            raise ValueError(f"{item['name']}: no length found in {origin}")
        seconds = whole_seconds(facts["seconds"])
        name, description = texts(item["name"], seconds)
        text = post_text(name, description)
        if len(text) > MAX_POST:
            raise ValueError(f"{item['name']}: the text has {len(text)} characters, a post may have {MAX_POST}")
        target = f"{item['n']:02d}_{slug(item['name'])}.mp4"
        shutil.copyfile(origin, os.path.join(out, "videos", target))
        rows.append({"n": item["n"], "person": item["name"], "file": f"videos/{target}", "exact_seconds": round(facts["seconds"], 3), "seconds": seconds, "width": facts["width"], "height": facts["height"],
                     "name": name, "description": description})
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as handle:
        json.dump(rows, handle, ensure_ascii=False, indent=2)
    return rows


# ------------------------------------------------------------------------------------------------------------------ step 2: the upload
class Site:
    """The few calls of the site that the upload needs. `session` is a requests.Session (or anything with post(url, json=, data=, files=) that answers .status_code and .json())."""

    def __init__(self, session, base):
        self.session, self.base = session, base.rstrip("/")

    def post(self, path, **kwargs):
        reply = self.session.post(f"{self.base}/api/yipi{path}", **kwargs)
        try:
            data = reply.json()
        except ValueError:
            data = {}
        return reply.status_code, data

    def login(self, handle, password):
        status, data = self.post("/login", json={"login": handle, "password": password})
        if status != 200 or not data.get("ok"):
            raise SystemExit(f"Sign-in failed ({status}: {data.get('error', 'unknown')}). Does the account {handle} exist, and is the password right?")
        return data.get("me") or {}

    def upload_video(self, path, row):
        with open(path, "rb") as handle:
            return self.post("/media", files={"file": (os.path.basename(path), handle, "video/mp4")},
                             data={"alt": row["name"], "width": str(row["width"]), "height": str(row["height"]), "captions": "1", "lang": "de"})

    def signup(self, handle, password, age, parents=False):
        payload = {"handle": handle, "password": password, "age": age}
        if parents:
            payload["parents"] = True
        return self.post("/signup", json=payload)

    def create_post(self, text, media_id):
        return self.post("/posts", json={"text": text, "media": [media_id]})


SIGNUP_ERRORS = {"bad_handle": "Der Name darf 3 bis 15 Zeichen haben: Buchstaben, Zahlen und _.", "reserved_handle": "Diesen Namen kann man nicht nehmen.",
                  "bad_password": "Das Passwort braucht mindestens 8 Zeichen.", "too_young": "Satürn ist erst ab 13 Jahren.", "need_parents": "Unter 16 geht Satürn nur mit der Erlaubnis der Eltern.",
                  "bad_birthday": "Mit dem Alter stimmt etwas nicht.", "too_many": "Zu viele Versuche, warte ein paar Minuten."}


def make_account(site, handle, ask=input, secret=getpass.getpass, log=print):
    """Makes the account (the person who runs the script chooses the password, types it twice and says how old they are; nothing of it is kept or printed here).
    Answers the password, or None when the account exists already (then the caller signs in)."""
    log(f"Das Konto @{handle} wird angelegt.")
    password = secret("Wähle ein Passwort (mindestens 8 Zeichen): ")
    if secret("Noch einmal dasselbe Passwort: ") != password:
        raise SystemExit("Die beiden Passwörter sind nicht gleich. Nichts wurde angelegt.")
    try:
        age = int(str(ask("Wie alt bist du? ")).strip())
    except ValueError:
        raise SystemExit("Das war keine Zahl. Nichts wurde angelegt.")
    parents = False
    if 13 <= age < 16:
        parents = str(ask("Haben deine Eltern es erlaubt? (j/n) ")).strip().lower() in ("j", "ja", "y", "yes")
    status, data = site.signup(handle, password, age, parents)
    if status == 409 and data.get("error") == "handle_taken":
        log(f"Das Konto @{handle} gibt es schon: es wird angemeldet statt neu angelegt.")
        return None
    if status != 200 or not data.get("ok"):
        raise SystemExit(f"Das Konto konnte nicht angelegt werden ({status}): {SIGNUP_ERRORS.get(data.get('error'), data.get('error', 'unbekannter Fehler'))}")
    log(f"Das Konto @{handle} ist angelegt und angemeldet.")
    return password


def upload_all(site, folder, handle, wait=time.sleep, log=print, retry_wait=RETRY_WAIT, only=None):
    """Puts every video of the manifest online (the ones in uploaded.json are skipped). Returns {file: address}."""
    with open(os.path.join(folder, "manifest.json"), encoding="utf-8") as handle_file:
        rows = json.load(handle_file)
    done_path = os.path.join(folder, "uploaded.json")
    done = {}
    if os.path.exists(done_path):
        with open(done_path, encoding="utf-8") as handle_file:
            done = json.load(handle_file)
    for row in rows:
        if only and row["n"] not in only:
            continue
        if row["file"] in done:
            log(f"{row['n']:02d} {row['name']}: already online")
            continue
        text = post_text(row["name"], row["description"])
        for attempt in range(40):
            status, data = site.upload_video(os.path.join(folder, row["file"]), row)
            if status == 429:
                log(f"{row['n']:02d} {row['name']}: the site says 'too many', waiting {retry_wait} seconds")
                wait(retry_wait)
                continue
            if status != 200 or not data.get("ok"):
                raise SystemExit(f"{row['n']:02d} {row['name']}: the upload failed ({status}: {data.get('error', 'unknown')}). Nothing else was uploaded after this one.")
            media_id = data["media"]["id"]
            for attempt2 in range(40):
                status, data = site.create_post(text, media_id)
                if status == 429:
                    wait(retry_wait)
                    continue
                break
            if status not in (200, 201) or not data.get("ok"):
                raise SystemExit(f"{row['n']:02d} {row['name']}: the post failed ({status}: {data.get('error', 'unknown')}).")
            post = data.get("post") or {}
            address = f"{site.base}/{handle}/status/{post.get('id')}"
            done[row["file"]] = address
            with open(done_path, "w", encoding="utf-8") as handle_file:
                json.dump(done, handle_file, ensure_ascii=False, indent=2)
            log(f"{row['n']:02d} {row['name']}: online -> {address}")
            break
        else:
            raise SystemExit(f"{row['n']:02d} {row['name']}: the site kept saying 'too many'; run the script again later, it continues here.")
    return done


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser("build", help="make manifest.json from the videos")
    build.add_argument("--source", required=True, help="json list of {n, name, blob}")
    build.add_argument("--videos", required=True, help="folder with <blob>.mp4")
    build.add_argument("--out", required=True, help="folder for videos/ and manifest.json")
    up = sub.add_parser("upload", help="put the videos online")
    up.add_argument("--folder", required=True)
    up.add_argument("--login", required=True, help="the name of the account, e.g. Short_Stories7k")
    up.add_argument("--site", default="https://nexai.up.railway.app")
    up.add_argument("--signup", action="store_true", help="make the account first (asks for a password and the age)")
    up.add_argument("--only", help="numbers to upload, e.g. 1,2,3 (a test with a few)")
    up.add_argument("--dry-run", action="store_true", help="only show the names and descriptions")
    args = parser.parse_args(argv)
    if args.command == "build":
        with open(args.source, encoding="utf-8") as handle:
            rows = build_manifest(json.load(handle), args.videos, args.out)
        for row in rows:
            print(f"{row['n']:02d}  {row['name']}   ({row['exact_seconds']} s, {row['width']}x{row['height']})")
        print(f"{len(rows)} videos, list in {os.path.join(args.out, 'manifest.json')}")
        return 0
    only = {int(n) for n in args.only.split(",")} if args.only else None
    if args.dry_run:
        with open(os.path.join(args.folder, "manifest.json"), encoding="utf-8") as handle:
            for row in json.load(handle):
                if not only or row["n"] in only:
                    print(f"{row['n']:02d}  {row['name']}\n    {row['description']}")
        return 0
    import requests
    session = requests.Session()
    site = Site(session, args.site)
    made = make_account(site, args.login) if args.signup else None             # (a new account is signed in already)
    if made is None:
        password = os.environ.get("SATUERN_PASSWORD") or getpass.getpass(f"Passwort von {args.login}: ")
        site.login(args.login, password)
    done = upload_all(site, args.folder, args.login, only=only)
    print(f"{len(done)} videos are online.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
