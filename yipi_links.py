"""Link previews for Satürn (2026-10-30): a link in a post, a video, a comment or a chat gets a card (picture, title, text, site) and opens in a window of Satürn itself, without leaving the page.

The server does the fetching, never the browser of the reader (the site that is linked does not see who looks at it, and the page keeps its strict content security policy: the
pictures of the cards are served by us too). Fetching an address that somebody else chose is dangerous, so:

* only http and https on the usual ports, no user name in the address, no `localhost`-like names;
* every connection goes to an address that was looked up and checked in that very moment: private, loopback, link-local, reserved and multicast addresses are refused (a host with even
  one such address is refused, and a redirect is checked like a new request, at most three of them), so Satürn cannot be made to read its own network;
* only the first 300 KB of a page are read, at most 1.5 MB of a picture, a few seconds of time, no cookies, no proxy;
* what comes back is plain text (cut to length), an address of a picture that is served by us afterwards, and never HTML of the other site.
The answers are kept in memory for a few hours (a failed address for ten minutes) so that a popular link is fetched once."""
import ipaddress
import logging
import re
import socket
import threading
import time
import urllib.parse
from collections import OrderedDict
from html.parser import HTMLParser

import requests
import urllib3.util.connection as _connection

MAX_HTML = 300_000
MAX_IMAGE = 1_500_000
TIMEOUT = (4, 6)
REDIRECTS = 3
TTL = 6 * 3600
NEGATIVE_TTL = 600
USER_AGENT = "Mozilla/5.0 (compatible; NexLinkPreview/1.0)"
IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/x-icon", "image/vnd.microsoft.icon"}
PORTS = {None, 80, 443}
YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"}
YOUTUBE_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

log = logging.getLogger("nex.links")
_guard = threading.local()
_lock = threading.Lock()
_pages = OrderedDict()                      # url -> (time, result or error code)
_images = OrderedDict()                     # url -> (time, bytes, content type)
_image_bytes = [0]
MAX_PAGES = 600
MAX_IMAGES = 80
MAX_IMAGE_CACHE = 16_000_000


class LinkError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


# ------------------------------------------------------------------------------------------------------------------ the address and the connection
def clean_url(raw):
    """The address in its clean form (no fragment), or None when it is not one that may be fetched."""
    if not isinstance(raw, str):
        return None
    raw = raw.strip()
    if not 8 <= len(raw) <= 2000 or any(ch.isspace() or ord(ch) < 32 for ch in raw):
        return None
    try:
        parts = urllib.parse.urlsplit(raw)
        port = parts.port
    except ValueError:
        return None
    host = (parts.hostname or "").lower().rstrip(".")
    if parts.scheme not in ("http", "https") or not host or parts.username or parts.password or port not in PORTS:
        return None
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet")) or "." not in host and ":" not in host:
        return None
    try:                                                       # an address that is written as numbers has to be a public one right here (and is checked once more when connecting)
        literal = ipaddress.ip_address(host)
        if literal.version == 6 and literal.ipv4_mapped is not None:
            literal = literal.ipv4_mapped
        if not literal.is_global or literal.is_multicast:
            return None
    except ValueError:
        pass
    netloc = host if ":" not in host else f"[{host}]"
    if port:
        netloc += f":{port}"
    return urllib.parse.urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))


def public_address(host, port):
    """The address to connect to: every address of the host has to be a public one."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError):
        raise LinkError("link_unreachable")
    chosen = None
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if ip.version == 6 and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped
        if not ip.is_global or ip.is_multicast:
            raise LinkError("link_blocked")
        chosen = chosen or info[4][0]
    if chosen is None:
        raise LinkError("link_unreachable")
    return chosen


_original_connect = _connection.create_connection


def _guarded_connect(address, *args, **kwargs):
    if getattr(_guard, "on", False):
        host, port = address
        return _original_connect((public_address(str(host).strip("[]"), port), port), *args, **kwargs)
    return _original_connect(address, *args, **kwargs)


_connection.create_connection = _guarded_connect


def fetch(url, limit, accept):
    """GET with every protection above: (response, body bytes cut at `limit`, final address). Raises LinkError."""
    session = requests.Session()
    session.trust_env = False
    _guard.on = True
    try:
        for _ in range(REDIRECTS + 1):
            url = clean_url(url)
            if url is None:
                raise LinkError("bad_link")
            try:
                response = session.get(url, headers={"User-Agent": USER_AGENT, "Accept": accept, "Accept-Language": "de,en;q=0.7"}, timeout=TIMEOUT, stream=True, allow_redirects=False)
            except LinkError:
                raise
            except requests.RequestException as error:
                inner = error.args[0] if error.args else None
                chain = [error, getattr(inner, "reason", None), getattr(inner, "__cause__", None)]
                if any(isinstance(item, LinkError) for item in chain):
                    raise next(item for item in chain if isinstance(item, LinkError))
                log.info("link not reachable: %s: %s", type(error).__name__, str(error)[:200])
                raise LinkError("link_unreachable")
            if response.status_code in (301, 302, 303, 307, 308) and response.headers.get("Location"):
                url = urllib.parse.urljoin(url, response.headers["Location"])
                response.close()
                continue
            if response.status_code >= 400:
                response.close()
                raise LinkError("link_unreachable")
            body = bytearray()
            try:
                for chunk in response.iter_content(16384):
                    body.extend(chunk)
                    if len(body) > limit:
                        break
            except requests.RequestException:
                pass
            finally:
                response.close()
            return response, bytes(body[:limit + 1]), url
        raise LinkError("link_unreachable")
    finally:
        _guard.on = False
        session.close()


# ------------------------------------------------------------------------------------------------------------------ reading a page
class _Head(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}
        self.title = ""
        self.icons = []
        self.done = False
        self._title = False

    def handle_starttag(self, tag, attrs):
        a = {key: (value or "") for key, value in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or "").lower()
            if key and a.get("content") and key not in self.meta:
                self.meta[key] = a["content"]
        elif tag == "title":
            self._title = True
        elif tag == "link":
            if "icon" in a.get("rel", "").lower().split() and a.get("href"):
                self.icons.append(a["href"])
        elif tag == "body":
            self.done = True

    def handle_endtag(self, tag):
        if tag == "title":
            self._title = False
        elif tag == "head":
            self.done = True

    def handle_data(self, data):
        if self._title and len(self.title) < 400:
            self.title += data


def _clip(text, limit):
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def _decode(response, body):
    charset = response.encoding if response.encoding and "charset" in response.headers.get("Content-Type", "").lower() else None
    if charset is None:
        match = re.search(rb"<meta[^>]+charset=[\"']?([A-Za-z0-9_-]+)", body[:4096], re.I)
        charset = match.group(1).decode("ascii", "ignore") if match else "utf-8"
    try:
        return body.decode(charset, "replace")
    except LookupError:
        return body.decode("utf-8", "replace")


def frame_allowed(headers, origin):
    """May the page be shown inside a frame of Satürn? Not when it says so itself (X-Frame-Options, or a `frame-ancestors` that does not name everybody or us)."""
    if headers.get("X-Frame-Options"):
        return False
    match = re.search(r"frame-ancestors([^;,]*)", headers.get("Content-Security-Policy", ""), re.I)
    if match:
        sources = match.group(1).split()
        return "*" in sources or "https:" in sources or origin in sources
    return True


def youtube_id(url):
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower()
    if host not in YOUTUBE_HOSTS:
        return None
    if host.endswith("youtu.be"):
        candidate = parts.path.strip("/").split("/")[0]
    elif parts.path.startswith(("/shorts/", "/embed/", "/live/")):
        candidate = parts.path.split("/")[2] if len(parts.path.split("/")) > 2 else ""
    else:
        candidate = urllib.parse.parse_qs(parts.query).get("v", [""])[0]
    return candidate if YOUTUBE_ID.match(candidate or "") else None


def image_address(base, value):
    """The address of a picture of the page (http or https only), or None."""
    if not value:
        return None
    absolute = urllib.parse.urljoin(base, value.strip())
    return absolute if clean_url(absolute) else None


def describe(url, origin):
    """What a card shows for the address: {url, domain, site, title, description, image, favicon, embeddable, embed}."""
    response, body, final = fetch(url, MAX_HTML, "text/html,application/xhtml+xml,*/*;q=0.5")
    parts = urllib.parse.urlsplit(final)
    host = parts.hostname or ""
    kind = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
    result = {"url": final, "domain": host[4:] if host.startswith("www.") else host, "site": "", "title": "", "description": "", "image": None, "favicon": None,
              "embeddable": False, "embed": None}
    video = youtube_id(final)
    if kind in ("text/html", "application/xhtml+xml", ""):
        head = _Head()
        try:
            head.feed(_decode(response, body))
        except Exception:  # noqa: BLE001  (a broken page still gets a card)
            pass
        meta = head.meta
        result["title"] = _clip(meta.get("og:title") or meta.get("twitter:title") or head.title, 160)
        result["description"] = _clip(meta.get("og:description") or meta.get("twitter:description") or meta.get("description"), 300)
        result["site"] = _clip(meta.get("og:site_name") or result["domain"], 60)
        result["image"] = image_address(final, meta.get("og:image") or meta.get("twitter:image") or meta.get("og:image:url"))
        result["favicon"] = image_address(final, head.icons[0] if head.icons else "/favicon.ico")
        result["embeddable"] = frame_allowed(response.headers, origin)
    else:
        result["site"] = result["domain"]
        result["title"] = _clip(urllib.parse.unquote(parts.path.rsplit("/", 1)[-1]) or result["domain"], 160)
        if kind in IMAGE_TYPES:
            result["image"] = final
        result["embeddable"] = (kind in IMAGE_TYPES or kind == "application/pdf") and frame_allowed(response.headers, origin)
    if video:
        result["embed"] = f"https://www.youtube-nocookie.com/embed/{video}"
        result["embeddable"] = True
        result["image"] = result["image"] or f"https://i.ytimg.com/vi/{video}/hqdefault.jpg"
    return result


# ------------------------------------------------------------------------------------------------------------------ the memory
def _remember(store, key, value, limit):
    with _lock:
        store[key] = value
        store.move_to_end(key)
        while len(store) > limit:
            old_key, old = store.popitem(last=False)
            if store is _images:
                _image_bytes[0] -= len(old[1])


def preview(raw, origin=""):
    """The card for an address (from memory when it is fresh). Raises LinkError("bad_link" | "link_blocked" | "link_unreachable")."""
    url = clean_url(raw)
    if url is None:
        raise LinkError("bad_link")
    now = time.monotonic()
    with _lock:
        cached = _pages.get(url)
    if cached and now - cached[0] < (TTL if isinstance(cached[1], dict) else NEGATIVE_TTL):
        if isinstance(cached[1], dict):
            return cached[1]
        raise LinkError(cached[1])
    try:
        result = describe(url, origin)
    except LinkError as error:
        _remember(_pages, url, (now, error.code), MAX_PAGES)
        raise
    _remember(_pages, url, (now, result), MAX_PAGES)
    return result


def image(raw):
    """A picture of a card: (bytes, content type). Only real pictures of a known kind (never SVG), at most 1.5 MB."""
    url = clean_url(raw)
    if url is None:
        raise LinkError("bad_link")
    now = time.monotonic()
    with _lock:
        cached = _images.get(url)
    if cached and now - cached[0] < TTL:
        return cached[1], cached[2]
    response, body, _ = fetch(url, MAX_IMAGE, "image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5")
    kind = response.headers.get("Content-Type", "").split(";")[0].strip().lower()
    if kind not in IMAGE_TYPES or not body or len(body) > MAX_IMAGE:
        raise LinkError("link_unreachable")
    with _lock:
        _image_bytes[0] += len(body)
    _remember(_images, url, (now, body, kind), MAX_IMAGES)
    while _image_bytes[0] > MAX_IMAGE_CACHE and len(_images) > 1:
        with _lock:
            old_key, old = _images.popitem(last=False)
            _image_bytes[0] -= len(old[1])
    return body, kind


def clear():
    with _lock:
        _pages.clear()
        _images.clear()
        _image_bytes[0] = 0
