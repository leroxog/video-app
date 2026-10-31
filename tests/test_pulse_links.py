"""Satürn: link previews (yipi_links.py and the two routes). The fetching of an address somebody else chose must never reach the inner network of the server: private, loopback and
link-local addresses are refused (also behind a redirect and behind a name that points there), only the usual ports and schemes are fetched, the page is read in pieces, and the answer
is plain text plus the address of a picture that Satürn serves itself."""
import os
import socket
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

import siteauth  # noqa: E402
import yipi  # noqa: E402
import yipi_links  # noqa: E402
from app import app as flask_app, db  # noqa: E402

PASSWORD = "correct horse battery"


@pytest.fixture(autouse=True)
def calm(monkeypatch):
    monkeypatch.setattr(yipi, "generate_password_hash", lambda password: "plain:" + password)
    monkeypatch.setattr(yipi, "check_password_hash", lambda stored, password: stored == "plain:" + password)
    yipi_links.clear()


@pytest.fixture
def client():
    flask_app.config["TESTING"] = True
    flask_app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    yipi._hits.clear()
    siteauth._keys.clear()
    with flask_app.app_context():
        db.create_all()
        yield flask_app.test_client()
        db.drop_all()


def person(handle):
    c = flask_app.test_client()
    assert c.post("/api/yipi/signup", json={"handle": handle, "password": PASSWORD, "adult": True}).status_code == 200
    return c


class FakeResponse:
    def __init__(self, status=200, headers=None, body=b"", encoding="utf-8"):
        self.status_code = status
        self.headers = headers or {"Content-Type": "text/html; charset=utf-8"}
        self.encoding = encoding
        self._body = body
        self.closed = False

    @property
    def is_redirect(self):
        return self.status_code in (301, 302, 303, 307, 308)

    def iter_content(self, size):
        for start in range(0, len(self._body), size):
            yield self._body[start:start + size]

    def close(self):
        self.closed = True


PAGE = b"""<!doctype html><html><head><meta charset="utf-8"><title>Fallback Titel</title>
<meta property="og:title" content="Ein &amp; Titel"><meta property="og:description" content="Beschreibung   mit   Platz">
<meta property="og:image" content="/bild.jpg"><meta property="og:site_name" content="Beispiel"><link rel="icon" href="/icon.png"></head>
<body><script>alert(1)</script><p>Text</p></body></html>"""


def test_only_ordinary_addresses_are_fetched():
    ok = yipi_links.clean_url
    assert ok("https://example.com/a?b=1#frag") == "https://example.com/a?b=1"
    assert ok("http://Example.com") == "http://example.com/"
    for bad in ["ftp://example.com/", "javascript:alert(1)", "https://user:pw@example.com/", "https://example.com:8080/", "http://localhost/", "http://intranet/", "http://printer.local/",
                "http://service.internal/", "https://exa mple.com/", "", None, 5, "https://" + "a" * 3000 + ".com/", "file:///etc/passwd", "http:///nohost"]:
        assert ok(bad) is None, bad


@pytest.mark.parametrize("address", ["127.0.0.1", "10.1.2.3", "192.168.0.7", "172.16.5.5", "169.254.169.254", "0.0.0.0", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "100.64.0.1", "224.0.0.1"])
def test_private_and_special_addresses_are_refused(address):
    with pytest.raises(yipi_links.LinkError) as error:
        yipi_links.public_address(address, 80)
    assert error.value.code == "link_blocked"


def test_a_public_address_is_chosen():
    assert yipi_links.public_address("93.184.216.34", 80) == "93.184.216.34"


def test_a_name_that_points_into_the_inner_network_is_refused_before_anything_is_sent(monkeypatch):
    def lookup(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", port))]
    monkeypatch.setattr(yipi_links.socket, "getaddrinfo", lookup)
    with pytest.raises(yipi_links.LinkError) as error:
        yipi_links.preview("https://evil.example.org/secret")
    assert error.value.code == "link_blocked"
    with pytest.raises(yipi_links.LinkError) as again:                       # (and the refusal is remembered for a while)
        yipi_links.preview("https://evil.example.org/secret")
    assert again.value.code == "link_blocked"


def test_one_private_address_among_public_ones_is_enough_to_refuse(monkeypatch):
    def lookup(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port)), (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))]
    monkeypatch.setattr(yipi_links.socket, "getaddrinfo", lookup)
    with pytest.raises(yipi_links.LinkError):
        yipi_links.public_address("rebind.example.org", 443)


def test_a_redirect_is_checked_like_a_new_request(monkeypatch):
    calls = []

    class Session:
        trust_env = False

        def get(self, url, **kwargs):
            calls.append(url)
            assert kwargs["allow_redirects"] is False and kwargs["stream"] is True and kwargs["timeout"]
            if len(calls) == 1:
                return FakeResponse(302, {"Location": "http://169.254.169.254/latest/meta-data/"})
            raise AssertionError("the second address must not be fetched")

        def close(self):
            pass

    monkeypatch.setattr(yipi_links.requests, "Session", Session)
    with pytest.raises(yipi_links.LinkError) as error:
        yipi_links.preview("https://short.example.org/x")
    assert error.value.code == "bad_link" and calls == ["https://short.example.org/x"], "a bare IP address in a redirect is not an address that may be fetched"


def test_too_many_redirects_end_in_an_error(monkeypatch):
    class Session:
        trust_env = False

        def get(self, url, **kwargs):
            return FakeResponse(301, {"Location": "https://a.example.org/loop"})

        def close(self):
            pass

    monkeypatch.setattr(yipi_links.requests, "Session", Session)
    with pytest.raises(yipi_links.LinkError) as error:
        yipi_links.preview("https://a.example.org/loop")
    assert error.value.code == "link_unreachable"


def serve(monkeypatch, response):
    class Session:
        trust_env = False

        def get(self, url, **kwargs):
            return response

        def close(self):
            pass

    monkeypatch.setattr(yipi_links.requests, "Session", Session)


def test_the_card_has_title_text_site_picture_and_is_plain_text(monkeypatch):
    serve(monkeypatch, FakeResponse(200, {"Content-Type": "text/html; charset=utf-8"}, PAGE))
    card = yipi_links.preview("https://example.org/artikel", "https://nex.test")
    assert card["title"] == "Ein & Titel" and card["description"] == "Beschreibung mit Platz" and card["site"] == "Beispiel"
    assert card["image"] == "https://example.org/bild.jpg" and card["favicon"] == "https://example.org/icon.png"
    assert card["domain"] == "example.org" and card["embeddable"] is True and card["embed"] is None
    assert "<" not in card["title"] + card["description"]


def test_a_page_that_forbids_frames_is_not_embeddable(monkeypatch):
    for headers in ({"X-Frame-Options": "DENY"}, {"X-Frame-Options": "SAMEORIGIN"}, {"Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'"},
                    {"Content-Security-Policy": "frame-ancestors 'self' https://partner.example"}):
        yipi_links.clear()
        serve(monkeypatch, FakeResponse(200, {"Content-Type": "text/html", **headers}, PAGE))
        assert yipi_links.preview("https://example.org/", "https://nex.test")["embeddable"] is False, headers
    yipi_links.clear()
    serve(monkeypatch, FakeResponse(200, {"Content-Type": "text/html", "Content-Security-Policy": "frame-ancestors *"}, PAGE))
    assert yipi_links.preview("https://example.org/", "https://nex.test")["embeddable"] is True
    yipi_links.clear()
    serve(monkeypatch, FakeResponse(200, {"Content-Type": "text/html", "Content-Security-Policy": "frame-ancestors https://nex.test"}, PAGE))
    assert yipi_links.preview("https://example.org/", "https://nex.test")["embeddable"] is True


def test_youtube_links_open_the_nocookie_player(monkeypatch):
    serve(monkeypatch, FakeResponse(200, {"Content-Type": "text/html", "X-Frame-Options": "SAMEORIGIN"}, b"<html><head><title>Ein Video</title></head></html>"))
    card = yipi_links.preview("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5", "https://nex.test")
    assert card["embed"] == "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" and card["embeddable"] is True
    assert card["image"] == "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    assert yipi_links.youtube_id("https://youtu.be/dQw4w9WgXcQ?si=x") == "dQw4w9WgXcQ"
    assert yipi_links.youtube_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert yipi_links.youtube_id("https://www.youtube.com/watch?v=short") is None
    assert yipi_links.youtube_id("https://evil.example/watch?v=dQw4w9WgXcQ") is None


def test_a_huge_page_is_read_only_in_part(monkeypatch):
    serve(monkeypatch, FakeResponse(200, {"Content-Type": "text/html"}, PAGE + b"x" * 5_000_000))
    card = yipi_links.preview("https://example.org/big")
    assert card["title"] == "Ein & Titel"


def test_a_picture_must_be_a_real_picture_and_never_svg(monkeypatch):
    serve(monkeypatch, FakeResponse(200, {"Content-Type": "image/png"}, b"\x89PNG....data"))
    assert yipi_links.image("https://example.org/a.png") == (b"\x89PNG....data", "image/png")
    for kind in ("image/svg+xml", "text/html", "application/octet-stream"):
        yipi_links.clear()
        serve(monkeypatch, FakeResponse(200, {"Content-Type": kind}, b"<svg onload=alert(1)>"))
        with pytest.raises(yipi_links.LinkError):
            yipi_links.image("https://example.org/b")
    yipi_links.clear()
    serve(monkeypatch, FakeResponse(200, {"Content-Type": "image/jpeg"}, b"j" * (yipi_links.MAX_IMAGE + 10)))
    with pytest.raises(yipi_links.LinkError):
        yipi_links.image("https://example.org/huge.jpg")


def test_the_route_needs_a_login_and_hands_out_cards_with_pictures_of_our_own(client, monkeypatch):
    assert client.get("/api/yipi/link-preview?url=https://example.org/").status_code == 401
    assert client.get("/yipi-linkimg?u=https://example.org/a.png").status_code == 401
    ana = person("ana")
    serve(monkeypatch, FakeResponse(200, {"Content-Type": "text/html; charset=utf-8"}, PAGE))
    data = ana.get("/api/yipi/link-preview?url=https://example.org/artikel").get_json()
    assert data["ok"] and data["title"] == "Ein & Titel" and data["domain"] == "example.org"
    assert data["image"].startswith("/yipi-linkimg?u=https%3A%2F%2Fexample.org%2Fbild.jpg"), "the picture is served by Satürn, not hot-linked"
    bad = ana.get("/api/yipi/link-preview?url=http://169.254.169.254/latest/")
    assert bad.status_code == 400 and bad.get_json()["error"] == "bad_link"
    assert ana.get("/api/yipi/link-preview").get_json()["error"] == "bad_link"
    serve(monkeypatch, FakeResponse(200, {"Content-Type": "image/webp"}, b"RIFFxxxxWEBP"))
    image = ana.get("/yipi-linkimg?u=https%3A%2F%2Fexample.org%2Fbild.jpg")
    assert image.status_code == 200 and image.mimetype == "image/webp" and image.headers["X-Content-Type-Options"] == "nosniff"
    assert "default-src 'none'" in image.headers["Content-Security-Policy"]
    assert ana.get("/yipi-linkimg?u=http://127.0.0.1/x.png").status_code == 404


def test_the_router_of_the_page_may_frame_other_sites_but_nothing_else_changed():
    csp = yipi.content_security_policy()
    assert "frame-src https:" in csp and "frame-ancestors 'none'" in csp and "default-src 'self'" in csp and "script-src 'self'" in csp and "img-src 'self' data: blob:" in csp
