"""NRS Suche: a small but real search engine -- crawler, inverted index and BM25 ranking.

It indexes the intros of the most-read German Wikipedia articles (fetched through
Wikimedia's official APIs), not the whole web. Wikipedia text is CC BY-SA 4.0,
so every result links back to its source article.
"""
import logging
import math
import re
import threading
import time
import unicodedata
import urllib.parse
from datetime import date

import requests
from markupsafe import Markup, escape
from sqlalchemy import func, insert
from sqlalchemy.exc import IntegrityError

from models import db, SearchDoc, SearchPosting

logger = logging.getLogger(__name__)

WIKI_API = "https://de.wikipedia.org/w/api.php"
PAGEVIEWS_TOP = "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/de.wikipedia/all-access/{year}/{month:02d}/all-days"
HEADERS = {"User-Agent": "NRS-Suche/1.0 (hobby search engine; https://nexai.up.railway.app)"}

TITLE_WEIGHT = 3
EXTRACT_MAX_CHARS = 1500
K1 = 1.2
B = 0.75
MAX_QUERY_TERMS = 8

_STOPWORDS_RAW = """
der die das den dem des ein eine einer einem einen eines und oder aber ist sind war waren wird werden wurde wurden
im in an am auf aus bei mit nach von vor zu zum zur uber fur um als auch es sich nicht noch nur wie wo wer was
hat haben hatte sein seine ihr ihre dass diese dieser dieses the of and to a is are
"""


def _fold(text):
    text = text.lower().replace("ß", "ss")
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if not unicodedata.combining(c))


_STOPWORDS = frozenset(_fold(_STOPWORDS_RAW).split())
_WORD_RE = re.compile(r"[a-z0-9]+")


def tokenize(text):
    """Lowercase, fold umlauts/accents, split into words, drop stopwords and 1-letter tokens."""
    return [t[:48] for t in _WORD_RE.findall(_fold(text)) if len(t) >= 2 and t not in _STOPWORDS]


def doc_count():
    return db.session.query(func.count(SearchDoc.id)).scalar() or 0


def index_document(url, title, extract, source="wikipedia"):
    """Add a page to the index. Returns the SearchDoc, or None if the URL is already indexed.
    The caller commits."""
    if SearchDoc.query.filter_by(url=url).first() is not None:
        return None
    counts = {}
    for term in tokenize(extract):
        counts[term] = counts.get(term, 0) + 1
    for term in tokenize(title):
        counts[term] = counts.get(term, 0) + TITLE_WEIGHT
    doc = SearchDoc(
        url=url[:400], title=title[:200], extract=extract, source=source,
        doc_len=max(1, sum(counts.values())),
    )
    db.session.add(doc)
    db.session.flush()
    if counts:
        db.session.execute(
            insert(SearchPosting),
            [{"term": term, "doc_id": doc.id, "tf": tf} for term, tf in counts.items()],
        )
    return doc


def _postings(term, n_docs):
    """doc_id -> (tf, doc_len) for a term; falls back to terms that start with it
    (so "berlin" also finds "berliner") when the exact term isn't indexed."""
    base = db.session.query(SearchPosting.doc_id, SearchPosting.tf, SearchDoc.doc_len).join(
        SearchDoc, SearchDoc.id == SearchPosting.doc_id)
    rows = base.filter(SearchPosting.term == term).all()
    if not rows and len(term) >= 4:
        rows = base.filter(SearchPosting.term.like(term + "%")).limit(5000).all()
    merged = {}
    for doc_id, tf, doc_len in rows:
        old_tf = merged.get(doc_id, (0, doc_len))[0]
        merged[doc_id] = (old_tf + tf, doc_len)
    return merged


def _bm25(tf, doc_len, avg_len, idf):
    # Postgres returns AVG() as a Decimal, which can't be divided into a float -- hence float().
    norm = tf + K1 * (1 - B + B * doc_len / float(avg_len))
    return idf * tf * (K1 + 1) / norm


def search(query, limit=50):
    """Rank indexed pages for a query with BM25. Returns (results, total_matches); each
    result is {"id", "title", "url", "source", "snippet"}."""
    terms = list(dict.fromkeys(tokenize(query[:200])))[:MAX_QUERY_TERMS]
    n_docs = doc_count()
    if not terms or not n_docs:
        return [], 0
    avg_len = db.session.query(func.avg(SearchDoc.doc_len)).scalar() or 1
    scores = {}
    matched = {}
    for term in terms:
        postings = _postings(term, n_docs)
        df = len(postings)
        if not df:
            continue
        idf = math.log(1 + (n_docs - df + 0.5) / (df + 0.5))
        for doc_id, (tf, doc_len) in postings.items():
            scores[doc_id] = scores.get(doc_id, 0.0) + _bm25(tf, doc_len, avg_len, idf)
            matched[doc_id] = matched.get(doc_id, 0) + 1
    if not scores:
        return [], 0
    candidates = sorted(scores, key=lambda d: (matched[d], scores[d]), reverse=True)[:limit * 2]
    docs = {d.id: d for d in SearchDoc.query.filter(SearchDoc.id.in_(candidates)).all()}
    for doc_id, doc in docs.items():
        title_terms = tokenize(doc.title)
        if title_terms == terms:
            scores[doc_id] += 10
        elif all(t in title_terms for t in terms):
            scores[doc_id] += 2
    ranked = sorted(docs.values(), key=lambda d: (matched[d.id], scores[d.id]), reverse=True)[:limit]
    results = [
        {"id": d.id, "title": d.title, "url": d.url, "source": d.source, "snippet": make_snippet(d.extract, terms)}
        for d in ranked
    ]
    return results, len(scores)


def _word_matches(word, terms):
    folded = tokenize(word)
    if not folded:
        return False
    token = folded[0]
    return any(token == t or (len(t) >= 4 and token.startswith(t)) for t in terms)


def make_snippet(extract, terms, width=220):
    """A window of the text around the first hit, with matching words wrapped in <mark>.
    Everything else is HTML-escaped, so the result is safe to render."""
    text = " ".join(extract.split())
    hit = next((m for m in re.finditer(r"\w+", text) if _word_matches(m.group(), terms)), None)
    start = 0
    if hit and hit.start() > width // 2:
        start = max(0, hit.start() - width // 3)
        space = text.find(" ", start)
        start = space + 1 if 0 <= space < hit.start() else start
    window = text[start:start + width]
    pieces = []
    for part in re.split(r"(\w+)", window):
        if part and re.fullmatch(r"\w+", part) and _word_matches(part, terms):
            pieces.append(Markup("<mark>%s</mark>") % part)
        else:
            pieces.append(escape(part))
    prefix = "… " if start else ""
    suffix = " …" if start + width < len(text) else ""
    return Markup(prefix) + Markup("").join(pieces) + Markup(suffix)


# ---------------------------------------------------------------- crawler

def fetch_popular_titles(months=12, today=None):
    """Titles of the most-read German Wikipedia articles over the last `months` months,
    most-read first. Namespace pages (Spezial:, Wikipedia:, ...) are skipped."""
    today = today or date.today()
    year, month = today.year, today.month
    views = {}
    for _ in range(months):
        month -= 1
        if month == 0:
            year, month = year - 1, 12
        try:
            r = requests.get(PAGEVIEWS_TOP.format(year=year, month=month), headers=HEADERS, timeout=20)
            articles = r.json()["items"][0]["articles"] if r.status_code == 200 else []
        except (requests.RequestException, ValueError, KeyError, IndexError):
            articles = []
        for a in articles:
            title = a["article"]
            if ":" not in title:
                views[title] = views.get(title, 0) + a["views"]
        time.sleep(0.3)
    return [t for t, _ in sorted(views.items(), key=lambda kv: -kv[1])]


def fetch_extracts(titles):
    """[(title, intro text)] for up to 20 titles (the API's limit for intro extracts)."""
    r = requests.get(WIKI_API, headers=HEADERS, timeout=30, params={
        "action": "query", "prop": "extracts", "exintro": 1, "explaintext": 1, "exlimit": 20,
        "redirects": 1, "format": "json", "formatversion": 2, "titles": "|".join(titles),
    })
    pages = r.json().get("query", {}).get("pages", [])
    return [(p["title"], p["extract"].strip()) for p in pages if p.get("extract") and not p.get("missing")]


def article_url(title):
    return "https://de.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))


def crawl_wikipedia(limit=4000, months=12):
    """Index popular German Wikipedia articles until the index holds `limit` pages.
    Safe to rerun: pages that are already indexed are skipped. Needs an app context."""
    titles = fetch_popular_titles(months)[:limit * 2]
    for i in range(0, len(titles), 20):
        if doc_count() >= limit:
            break
        try:
            pages = fetch_extracts(titles[i:i + 20])
        except (requests.RequestException, ValueError):
            logger.warning("Suchindex: Abruf fehlgeschlagen, überspringe diesen Block.")
            time.sleep(2)
            continue
        for title, extract in pages:
            if len(extract) >= 80:
                index_document(article_url(title), title, extract[:EXTRACT_MAX_CHARS])
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
        time.sleep(0.4)
    logger.info("Suchindex: %d Seiten.", doc_count())


_crawl_lock = threading.Lock()


def start_background_crawl(app, limit=4000):
    """Fill the index in a background thread after startup, unless it is already big enough."""
    def run():
        time.sleep(5)
        if not _crawl_lock.acquire(blocking=False):
            return
        try:
            with app.app_context():
                if doc_count() < limit:
                    crawl_wikipedia(limit)
        except Exception:
            logger.exception("Suchindex: Crawler abgebrochen.")
        finally:
            _crawl_lock.release()
    threading.Thread(target=run, name="nrs-crawler", daemon=True).start()
