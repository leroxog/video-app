"""Subtitles and a spoken translation for every video of Satürn (2026-10-31).

What happens: when a video is uploaded (and, for older videos, the first time somebody asks), the server sends the sound of the video to Groq's speech recognition (Whisper), which says which language
is spoken and writes down what is said, with the time of every sentence. That text is kept (table yipi_caption, one row for the original language). When somebody wants the subtitles or the spoken
translation in another language, Groq's language model translates the sentences (once; the translation is kept too). The page shows the sentences as subtitles, and for the spoken track the browser of the
viewer reads the translated sentences aloud with a voice of the device at the right moment (the original sound is turned down meanwhile). Nothing is spoken by the server: Groq has no voices for most languages.

Women and men: the browser of the person who uploads the video measures the pitch of the voice (a number every tenth of a second, no sound) and sends it along; the server keeps it (a row "_pitch") and marks
every sentence "f" or "m" by its median pitch (below 165 Hz is a man, above a woman; "" when it cannot tell). The viewer's browser then picks a female or a male voice for that sentence.

Rules: the languages are LANGUAGES (German and English and twenty others); a video longer than Groq takes (25 MB) or without speech gets no subtitles; a failed request is tried again after a few minutes;
one Groq request per video and language, never more; the rate of the requests of a person is limited."""
import json
import logging
import os
import re
import statistics
import threading
import time

import requests
from flask import current_app, jsonify, request
from sqlalchemy.exc import IntegrityError

import yipi

log = logging.getLogger("nex.captions")

WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
WHISPER_MODELS = list(dict.fromkeys([os.environ.get("GROQ_WHISPER_MODEL", "whisper-large-v3"), "whisper-large-v3-turbo"]))       # the big model hears best; the fast one takes over when the big one does not answer
MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_SEGMENTS = 150
MAX_PITCH_POINTS = 420                  # one number per tenth of a second: 42 seconds
RETRY_AFTER = 600                       # seconds: a failed transcription is tried again after this
UNSURE = -0.45                          # average log probability of what was heard: below this the recogniser is unsure, and a second try in the language of the uploader's device is made
FEMALE_ABOVE = 165                      # Hz: a median pitch above this is a woman's voice

# (code, name in German, language tag for the voice of the device)
LANGUAGES = [
    ("de", "Deutsch", "de-DE"), ("en", "Englisch", "en-US"), ("es", "Spanisch", "es-ES"), ("fr", "Französisch", "fr-FR"), ("it", "Italienisch", "it-IT"),
    ("pt", "Portugiesisch", "pt-BR"), ("nl", "Niederländisch", "nl-NL"), ("pl", "Polnisch", "pl-PL"), ("tr", "Türkisch", "tr-TR"), ("ru", "Russisch", "ru-RU"),
    ("uk", "Ukrainisch", "uk-UA"), ("ar", "Arabisch", "ar-SA"), ("hi", "Hindi", "hi-IN"), ("ja", "Japanisch", "ja-JP"), ("ko", "Koreanisch", "ko-KR"),
    ("zh", "Chinesisch", "zh-CN"), ("sv", "Schwedisch", "sv-SE"), ("da", "Dänisch", "da-DK"), ("no", "Norwegisch", "nb-NO"), ("fi", "Finnisch", "fi-FI"),
    ("el", "Griechisch", "el-GR"), ("cs", "Tschechisch", "cs-CZ"),
]
NAMES = {code: name for code, name, _ in LANGUAGES}
ENGLISH = {"de": "German", "en": "English", "es": "Spanish", "fr": "French", "it": "Italian", "pt": "Portuguese", "nl": "Dutch", "pl": "Polish", "tr": "Turkish", "ru": "Russian",
           "uk": "Ukrainian", "ar": "Arabic", "hi": "Hindi", "ja": "Japanese", "ko": "Korean", "zh": "Chinese", "sv": "Swedish", "da": "Danish", "no": "Norwegian", "fi": "Finnish",
           "el": "Greek", "cs": "Czech"}
WHISPER_CODES = {name.lower(): code for code, name in ENGLISH.items()}
WHISPER_CODES.update({"hungarian": "hu", "romanian": "ro", "bulgarian": "bg", "croatian": "hr", "slovak": "sk", "serbian": "sr", "slovenian": "sl", "catalan": "ca", "hebrew": "he", "persian": "fa",
                      "thai": "th", "vietnamese": "vi", "indonesian": "id", "malay": "ms", "urdu": "ur", "bengali": "bn", "tamil": "ta", "swahili": "sw", "lithuanian": "lt", "latvian": "lv",
                      "estonian": "et", "icelandic": "is", "albanian": "sq", "macedonian": "mk", "afrikaans": "af", "filipino": "tl", "tagalog": "tl", "nynorsk": "nn"})
HALLUCINATIONS = re.compile(r"^(thank you\.?|thanks for watching[.!]?|vielen dank\.?|danke\.?|untertitel.*|subtitles? (by|from).*|amara\.org.*|www\..*|\.+|you)$", re.I)

_work = {}                              # media id -> thread that is transcribing it (or a lock for a translation: (media id, lang))
_work_lock = threading.Lock()
_cool = {"until": 0.0}                  # Groq said "too many requests": no new request until then
clock = time.time                       # the tests replace it


def runner(app, media_id, hint="", force=""):
    """Starts the transcription of a video in the background (the tests run it at once)."""
    threading.Thread(target=_thread, args=(app, media_id, hint, force), daemon=True).start()


def _thread(app, media_id, hint="", force=""):
    with app.app_context():
        try:
            ensure_source(media_id, hint, force)
        except Exception:  # noqa: BLE001
            log.exception("captions: the transcription of a video failed")
        finally:
            yipi.db.session.remove()


def later(media_id, hint="", force=""):
    """Asks for the transcription of a video without waiting for it (nothing happens without a key for Groq). `hint` is the language of the device of the uploader (two letters, or ""); `force`
    is the language the uploader says is spoken in the video (then nobody guesses)."""
    if not os.environ.get("GROQ_API_KEY"):
        return
    with _work_lock:
        if media_id in _work:
            return
        _work[media_id] = True
    RUNNER_BOX[0](current_app._get_current_object(), media_id, hint, force)


RUNNER_BOX = [runner]                   # (a list so that a test can swap the function)


# ------------------------------------------------------------------------------------------------------------------ what comes from the browser
def clean_pitch(raw):
    """The pitch contour a browser sends (a JSON list of whole Hz, 0 = no voice, one per tenth of a second) or None when it is not one."""
    if not isinstance(raw, str) or len(raw) > 4000:
        return None
    try:
        values = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(values, list) or not 1 <= len(values) <= MAX_PITCH_POINTS:
        return None
    out = []
    for value in values:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return None
        value = int(round(value))
        if value != 0 and not 50 <= value <= 500:
            return None
        out.append(value)
    return out


def keep_pitch(media_id, raw):
    pitch = clean_pitch(raw)
    if pitch is None or not any(pitch):
        return False
    yipi.db.session.add(yipi.YipiCaption(media_id=media_id, lang="_pitch", kind="pitch", status="ready", data=json.dumps(pitch)))
    try:
        yipi.db.session.commit()
    except IntegrityError:
        yipi.db.session.rollback()
        return False
    return True


def gender_of(pitch, start, end):
    """"f", "m" or "" for the sentence between `start` and `end` seconds."""
    if not pitch:
        return ""
    first, last = int(start * 10), int(end * 10) + 1
    voiced = [value for value in pitch[first:last] if value]
    if len(voiced) < 3:
        return ""
    return "f" if statistics.median(voiced) > FEMALE_ABOVE else "m"


# ------------------------------------------------------------------------------------------------------------------ Groq
class Unavailable(Exception):
    """Groq did not answer (no key, too many requests, an error)."""


def _recognise(data, name, content_type, model, language="", prompt=""):
    """One request to the speech recognition: (language as Whisper names it, segments). Raises Unavailable."""
    key = os.environ.get("GROQ_API_KEY")
    fields = {"model": model, "response_format": "verbose_json", "temperature": "0"}
    if language:
        fields["language"] = language
    if prompt:
        fields["prompt"] = prompt[:400]
    try:
        reply = requests.post(WHISPER_URL, headers={"Authorization": f"Bearer {key}"}, files={"file": (name, data, content_type)}, data=fields, timeout=180)
    except requests.RequestException as error:
        raise Unavailable(str(error)) from error
    if reply.status_code == 429:
        _cool["until"] = clock() + 60
        raise Unavailable("too many requests")
    if reply.status_code != 200:
        raise Unavailable(f"status {reply.status_code}: {reply.text[:200]}")
    body = reply.json()
    return str(body.get("language") or "").lower(), list(body.get("segments") or [])


def quality(segments):
    """How sure the recogniser was: the average log probability of the sentences that are speech, weighted by how long they are (0 is certain, -1 is a guess); -3 when nothing was heard."""
    total = weight = 0.0
    for segment in segments:
        if float(segment.get("no_speech_prob") or 0) > 0.6:
            continue
        length = max(0.2, float(segment.get("end") or 0) - float(segment.get("start") or 0))
        total += float(segment.get("avg_logprob") or -1) * length
        weight += length
    return total / weight if weight else -3.0


def transcribe(data, name, content_type, hint="", prompt="", force=""):
    """(language as Whisper names it, [{"start", "end", "text", "no_speech_prob", "avg_logprob"}]) for the sound of a video. The big model is asked first (the fast one when the big one fails);
    when it is unsure and the language it found is not `hint` (the language of the device of the uploader), it listens a second time in that language and the surer answer is kept. Raises Unavailable."""
    if not os.environ.get("GROQ_API_KEY"):
        raise Unavailable("no key")
    if clock() < _cool["until"]:
        raise Unavailable("cooling down")
    failure = None
    for model in WHISPER_MODELS:
        try:
            language, segments = _recognise(data, name, content_type, model, language=force, prompt=prompt)
        except Unavailable as error:
            failure = error
            if "too many" in str(error):
                raise
            continue
        if hint and not force and WHISPER_CODES.get(language) != hint and quality(segments) < UNSURE:
            try:
                second_language, second = _recognise(data, name, content_type, model, language=hint, prompt=prompt)
                if quality(second) > quality(segments) + 0.1:
                    return second_language or language, second
            except Unavailable:
                pass
        return language, segments
    raise failure or Unavailable("no model")


def translate(texts, target, source_name):
    """The sentences in another language: a list of the same length. `target` is a code of LANGUAGES. Raises Unavailable."""
    import ai_assistant
    wanted = ENGLISH[target]
    out = []
    for start in range(0, len(texts), 40):
        batch = texts[start:start + 40]
        system = (f"You translate subtitles from {source_name} into {wanted}. You get a JSON array of strings, one per spoken sentence. Translate each one naturally and briefly, keep the meaning, "
                  f"names and numbers; do not explain anything. Answer with a JSON array of exactly {len(batch)} strings in {wanted} and nothing else.")
        for attempt in range(2):
            try:
                answer = ai_assistant.generate_text(system, json.dumps(batch, ensure_ascii=False), max_tokens=2500, temperature=0.2)
            except Exception as error:  # noqa: BLE001
                raise Unavailable(str(error)) from error
            found = _json_list(answer)
            if found is not None and len(found) == len(batch):
                out.extend(found)
                break
        else:
            raise Unavailable("the translation does not fit")
    return out


def _json_list(text):
    text = str(text or "")
    first, last = text.find("["), text.rfind("]")
    if first < 0 or last <= first:
        return None
    try:
        value = json.loads(text[first:last + 1])
    except ValueError:
        return None
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        return None
    return [item.strip()[:300] for item in value]


def source_segments(raw_segments, pitch):
    """The sentences worth showing: not silence, not what Whisper makes up for noise (the rules of Whisper itself: no speech and unsure, or a text that repeats itself); sentences that were
    cut in the middle are put together again; each with its start, end, text and "f"/"m"/""."""
    kept = []
    for segment in raw_segments[:MAX_SEGMENTS * 3]:
        words = re.sub(r"\s+", " ", str(segment.get("text") or "")).strip()
        start, end = float(segment.get("start") or 0), float(segment.get("end") or 0)
        if not words or end <= start or HALLUCINATIONS.match(words):
            continue
        logprob, silence = float(segment.get("avg_logprob") or 0), float(segment.get("no_speech_prob") or 0)
        if silence > 0.85 or (silence > 0.6 and logprob < -1.0) or logprob < -1.9 or float(segment.get("compression_ratio") or 0) > 2.4:
            continue
        kept.append({"s": start, "e": end, "t": words})
    merged = []
    for piece in kept:
        last = merged[-1] if merged else None
        if last and not re.search(r"[.!?\u2026\u3002\uff01\uff1f]$", last["t"]) and piece["s"] - last["e"] < 0.7 and len(last["t"]) + len(piece["t"]) < 170 and piece["e"] - last["s"] < 10:
            last["t"] = last["t"] + " " + piece["t"]
            last["e"] = piece["e"]
        else:
            merged.append(dict(piece))
    return [{"s": round(p["s"], 2), "e": round(p["e"], 2), "t": p["t"][:300], "g": gender_of(pitch, p["s"], p["e"])} for p in merged[:MAX_SEGMENTS]]


# ------------------------------------------------------------------------------------------------------------------ the rows
def row(media_id, lang):
    return yipi.YipiCaption.query.filter_by(media_id=media_id, lang=lang).first()


def original(media_id):
    return yipi.YipiCaption.query.filter_by(media_id=media_id, original=True).first()


def put(media_id, lang, status, data, is_original=False):
    entry = yipi.YipiCaption(media_id=media_id, lang=lang, kind="text", original=is_original, status=status, data=json.dumps(data, ensure_ascii=False))
    yipi.db.session.add(entry)
    try:
        yipi.db.session.commit()
    except IntegrityError:
        yipi.db.session.rollback()
        return row(media_id, lang)
    return entry


def title_prompt(item):
    """The name the uploader gave the video, as a hint for the recogniser (names and special words are heard better), or ""."""
    words = re.sub(r"#\w+", " ", item.alt or "").split()
    return " ".join(words)[:200] if len(words) >= 3 else ""


def ensure_source(media_id, hint="", force=""):
    """Makes the row of the original language of a video (text and time of every sentence), or a row that says why not. Called in the background."""
    try:
        if original(media_id) is not None:
            return
        item = yipi.db.session.get(yipi.YipiMedia, media_id)
        if item is None or not item.content_type.startswith("video/"):
            return
        old = row(media_id, "_error")
        if old is not None and (yipi.utcnow() - old.created_at).total_seconds() < RETRY_AFTER:
            return
        if item.size > MAX_AUDIO_BYTES:
            put(media_id, "_none", "none", {"why": "too big"}, True)
            return
        data = yipi.load_bytes(yipi.YipiMedia, item)
        extension = {"video/mp4": "mp4", "video/quicktime": "mp4", "video/webm": "webm"}.get(item.content_type, "mp4")
        try:
            language, raw = transcribe(data, f"video.{extension}", "video/webm" if extension == "webm" else "video/mp4", hint=hint or "de", prompt=title_prompt(item), force=force)
        except Unavailable as error:
            log.warning("captions: no transcription (%s)", error)
            if old is not None:
                old.created_at = yipi.utcnow()                           # (tried again after RETRY_AFTER)
            else:
                yipi.db.session.add(yipi.YipiCaption(media_id=media_id, lang="_error", kind="text", status="error", data="{}"))
            try:
                yipi.db.session.commit()
            except IntegrityError:
                yipi.db.session.rollback()
            return
        if old is not None:
            yipi.db.session.delete(old)
            yipi.db.session.commit()
        pitch_row = row(media_id, "_pitch")
        pitch = json.loads(pitch_row.data) if pitch_row is not None else None
        segments = source_segments(raw, pitch)
        code = WHISPER_CODES.get(language) or (language[:12] if language else "und")
        name = NAMES.get(code) or (language.capitalize() if language else "?")
        if not segments:
            put(media_id, "_none", "none", {"why": "no speech"}, True)
            return
        put(media_id, code, "ready", {"name": name, "english": ENGLISH.get(code) or language.capitalize(), "segments": segments}, True)
    finally:
        with _work_lock:
            _work.pop(media_id, None)


def translation(media_id, source, target):
    """The row of the sentences of a video in the language `target` (made now when it is missing). Raises Unavailable."""
    existing = row(media_id, target)
    if existing is not None:
        return existing
    key = (media_id, target)
    with _work_lock:
        lock = _work.setdefault(key, threading.Lock())
    try:
        with lock:
            existing = row(media_id, target)
            if existing is not None:
                return existing
            data = json.loads(source.data)
            texts = [segment["t"] for segment in data["segments"]]
            translated = translate(texts, target, data.get("english") or data.get("name") or "the original language")
            segments = [{"s": segment["s"], "e": segment["e"], "t": text, "g": segment["g"]} for segment, text in zip(data["segments"], translated)]
            return put(media_id, target, "ready", {"name": NAMES[target], "segments": segments})
    finally:
        with _work_lock:
            _work.pop(key, None)


def purge_orphans():
    """Subtitles of videos that are gone are removed (called when the site starts)."""
    gone = ~yipi.YipiCaption.media_id.in_(yipi.select(yipi.YipiMedia.id))
    removed = yipi.YipiCaption.query.filter(gone).delete(synchronize_session=False)
    yipi.db.session.commit()
    return removed


# ------------------------------------------------------------------------------------------------------------------ the route
def register(route, need_user, body):
    fail = yipi.fail
    limiter = yipi.limiter

    @route("/api/yipi/videos/<media_id>/captions/redo", methods=["POST"], endpoint="yipi_captions_redo")
    def yipi_captions_redo(media_id):
        """The one who made the video says which language is spoken in it: what was written down is dropped and the sound is heard again in that language."""
        user, problem = need_user()
        if problem:
            return problem
        data, problem = body()
        if problem:
            return problem
        lang = data.get("lang")
        if lang not in NAMES:
            return fail("bad_language", 400)
        if not re.fullmatch(r"[0-9a-f]{32}", media_id):
            return fail("not_found", 404)
        item = yipi.db.session.get(yipi.YipiMedia, media_id)
        if item is None or not item.content_type.startswith("video/"):
            return fail("not_found", 404)
        if item.owner_id != user.id:
            return fail("forbidden", 403)
        if limiter.too_many("caption-redo", str(user.id)):
            return fail("too_many", 429)
        if not os.environ.get("GROQ_API_KEY"):
            return jsonify({"ok": True, "status": "unavailable"})
        yipi.YipiCaption.query.filter(yipi.YipiCaption.media_id == media_id, yipi.YipiCaption.kind == "text").delete(synchronize_session=False)
        yipi.db.session.commit()
        later(media_id, lang, lang)
        return jsonify({"ok": True, "status": "pending"})

    @route("/api/yipi/videos/<media_id>/captions")
    def yipi_captions(media_id):
        user, problem = need_user()
        if problem:
            return problem
        if not re.fullmatch(r"[0-9a-f]{32}", media_id):
            return fail("not_found", 404)
        lang = request.args.get("lang", "orig")
        if lang != "orig" and lang not in NAMES:
            return fail("bad_language", 400)
        if limiter.too_many("caption", str(user.id)):
            return fail("too_many", 429)
        item = yipi.db.session.get(yipi.YipiMedia, media_id)
        if item is None or not item.content_type.startswith("video/"):
            return fail("not_found", 404)
        source = original(media_id)
        if source is None:
            if not os.environ.get("GROQ_API_KEY"):
                return jsonify({"ok": True, "status": "unavailable"})
            failed = row(media_id, "_error")
            if failed is not None and (yipi.utcnow() - failed.created_at).total_seconds() < RETRY_AFTER:
                return jsonify({"ok": True, "status": "error"})
            later(media_id)
            return jsonify({"ok": True, "status": "pending"})
        if source.status == "none":
            return jsonify({"ok": True, "status": "none"})
        data = json.loads(source.data)
        info = {"code": source.lang, "name": data.get("name", "")}
        if lang == "orig" or lang == source.lang:
            return jsonify({"ok": True, "status": "ready", "original": info, "lang": source.lang, "segments": data["segments"]})
        try:
            made = translation(media_id, source, lang)
        except Unavailable as error:
            log.warning("captions: no translation (%s)", error)
            return jsonify({"ok": True, "status": "error", "original": info})
        return jsonify({"ok": True, "status": "ready", "original": info, "lang": lang, "segments": json.loads(made.data)["segments"]})
