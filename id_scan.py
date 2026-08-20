"""OCR-based best-effort read of a scanned/photographed ID document for
Mini Job's verification step -- NOT a real, legally-binding identity
verification. There is no forgery detection, no liveness/selfie check, no
connection to any government registry -- this only reads printed text off
whatever image it's given and guesses at a name/birthdate within it. Uses
Tesseract (via pytesseract), a genuinely free, locally-running OCR engine
-- no API key, no external service, matching this app's "use a real free
service, or say so honestly" pattern (Pollinations for images, Wikipedia/
Open-Meteo for facts). Deployed via railpack.json's deploy.aptPackages
(tesseract-ocr, tesseract-ocr-deu); for local dev without that binary
installed, extract_text() raises TesseractNotFoundError, which
app.py's minijob_verify() catches and falls back to "type it in by hand".

The uploaded image itself is never written to disk or R2 anywhere in this
pipeline -- app.py's minijob_verify() reads the upload straight into
memory, calls extract_text() on those bytes, and lets the bytes get
garbage-collected once the request ends. Only the guessed name/birthdate
text survives, and even that is shown back to the user to confirm or
correct by hand before it's saved -- OCR against a photographed ID card
(skew, glare, varying fonts/layouts) is genuinely unreliable, and this
module's whole design assumes its guesses will sometimes be wrong."""
import io
import re
from datetime import datetime

import pytesseract
from PIL import Image

# Matches DD.MM.YYYY / DD-MM-YYYY / DD/MM/YYYY, the date format printed on
# a German Personalausweis (and most EU ID cards) -- deliberately not
# trying to also match ISO YYYY-MM-DD, since that's not what's printed on
# the physical document this is reading from.
_DATE_PATTERN = re.compile(r"\b(\d{2})[.\-/](\d{2})[.\-/](\d{4})\b")

# A crude but workable heuristic for "the printed name" on an ID card
# without knowing that document's exact field layout: the longest line
# that's plausibly a name (letters/spaces/hyphens only, including German
# umlauts/ß, no digits or symbols OCR would have picked up from a MRZ
# line, a barcode, or a field label).
_NAME_LINE = re.compile(r"[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß \-]{3,}")


def extract_text(image_bytes):
    """Runs OCR over raw uploaded image bytes, returns the raw text
    (possibly empty or garbled -- callers must treat this as a hint, not
    a fact). Raises pytesseract.TesseractNotFoundError if the tesseract
    binary itself isn't installed/on PATH, and PIL.UnidentifiedImageError
    if the upload isn't a real image -- both are the caller's job to
    catch and degrade gracefully from, not swallowed here, so "OCR isn't
    available at all" is never silently confused with "found no text"."""
    image = Image.open(io.BytesIO(image_bytes))
    return pytesseract.image_to_string(image, lang="deu+eng")


def guess_birthdate(raw_text):
    """Best-effort: the first DD.MM.YYYY-shaped date found. A German ID
    card prints several dates (issue date, expiry date, birthdate) with no
    reliable way to tell them apart from OCR text alone -- this is a
    starting guess for the user to confirm or correct, never applied
    without that confirmation. Returns None if nothing date-shaped (or no
    plausible calendar date) was found at all."""
    for match in _DATE_PATTERN.finditer(raw_text):
        day, month, year = match.groups()
        try:
            candidate = datetime.strptime(f"{day}.{month}.{year}", "%d.%m.%Y").date()
        except ValueError:
            continue
        if 1900 <= candidate.year <= datetime.now().year:
            return candidate
    return None


def guess_name(raw_text):
    """Best-effort: German ID cards print the surname and given name(s) as
    their own short mixed-case lines, surrounded by ALL-CAPS document
    headers/field labels ("BUNDESREPUBLIK DEUTSCHLAND", "PERSONALAUSWEIS")
    that are usually the *longest* lines on the card -- picking the
    longest name-shaped line outright (an earlier version of this
    function did that) mostly just returns the header instead of the
    actual name. Excluding all-caps lines fixes that for the common case;
    the two longest surviving candidates (typically surname + given name
    on separate lines) are joined together. Returns None if nothing
    plausible survives."""
    candidates = []
    for line in raw_text.splitlines():
        cleaned = line.strip()
        match = _NAME_LINE.fullmatch(cleaned)
        if not match:
            continue
        if cleaned == cleaned.upper():
            continue  # likely a header/field label, not a name
        candidates.append(cleaned)
    if not candidates:
        return None
    candidates.sort(key=len, reverse=True)
    return " ".join(candidates[:2])


def read_id_photo(image_bytes):
    """The one function app.py's minijob_verify() actually calls -- runs
    the whole pipeline and turns every failure mode into a plain result
    dict instead of an exception, so the route doesn't need to know
    anything about pytesseract/PIL internals. Always returns a dict with:
      - "ocr_available" (bool): False if the tesseract binary itself isn't
        installed (see this module's own docstring on railpack.json)
      - "image_readable" (bool): False if the upload wasn't a real image
        at all (only meaningful when ocr_available is True)
      - "name" / "birthdate" (str/date or None): best-effort guesses,
        never to be saved without the user confirming them first"""
    try:
        raw_text = extract_text(image_bytes)
    except pytesseract.TesseractNotFoundError:
        return {"ocr_available": False, "image_readable": None, "name": None, "birthdate": None}
    except Exception:
        return {"ocr_available": True, "image_readable": False, "name": None, "birthdate": None}
    return {
        "ocr_available": True,
        "image_readable": True,
        "name": guess_name(raw_text),
        "birthdate": guess_birthdate(raw_text),
    }
