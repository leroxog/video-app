"""Nex Ai's home page (five server-side AI agents): the file it is made of puts nothing the model writes on the page as HTML, runs no
foreign code, and talks only to its own server (never directly to Groq or anywhere else -- the browser never sees the Groq key or
Groq's address, only regal.py does). regal-agents.js reuses regal-core.js, regal-ui.js and regal-chat-core.js's text-formatting
helpers as they are (checked in test_regal_frontend.py / regal_chat_core.test.js); this file checks only what regal-agents.js and
regal-agents.css add."""
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


JS = read("static", "js", "regal-agents.js")
CSS = read("static", "css", "regal.css")
CHAT_CSS = read("static", "css", "regal-chat.css")
AGENTS_CSS = read("static", "css", "regal-agents.css")


def code_of(source):
    return re.sub(r"/\*.*?\*/|(?<![:\"'])//[^\n]*", "", source, flags=re.S)


def test_it_is_valid_javascript():
    import shutil
    node = shutil.which("node")
    if node is None:
        return
    result = subprocess.run([node, "--check", os.path.join(ROOT, "static", "js", "regal-agents.js")], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr[-800:]


def test_nothing_an_agent_writes_is_put_on_the_page_as_html_and_it_runs_no_foreign_code():
    code = code_of(JS)
    for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "document.cookie", "sessionStorage", "localStorage",
                 "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "importScripts", "import(", "new Worker"):
        assert sink not in code, f"regal-agents.js uses {sink}"
    assert not re.findall(r"https?://[^\s\"'`)]+", code), "every address regal-agents.js uses is relative (its own server), never a third party"


def test_it_only_ever_fetches_its_own_api_and_never_groq_directly():
    # The page may say "Groq" out loud (it does, honestly, in the composer note) -- what must never appear is Groq's own address
    # or a key for it: the browser only ever talks to this site's own server, which alone knows how to reach Groq.
    code = code_of(JS)
    assert code.count("fetch(") == 1
    assert 'const ASK_URL = "/api/agents/ask"' in code
    assert 'credentials: "omit"' in code, "an anonymous page sends no cookie even though it has none to send"
    assert "api.groq.com" not in code and "GROQ_API_KEY" not in code


def test_five_real_passes_stream_to_the_page_as_text_four_independent_then_one_final():
    code = code_of(JS)
    assert 'const ORDER = ["direkt", "gruendlich", "kritisch", "praktisch"]' in code
    assert 'streamInto("final", question, app.agents' in code, "the final pass reads what the other four wrote"
    assert "response.body.getReader()" in code and "new TextDecoder()" in code
    assert "Chat.parseBlocks(" in code and "Chat.parseInline(" in code


def test_the_in_bearbeitung_row_can_be_opened_to_show_the_agents_talking():
    code = code_of(JS)
    assert '"In Bearbeitung' in code
    assert "toggleExpanded" in code and "app.expanded" in code
    assert "onclick: toggleExpanded" in code, "the status row itself is the thing a visitor clicks to open it"


def test_the_transcript_says_plainly_that_the_notation_is_not_meant_to_be_readable():
    code = code_of(JS)
    assert "notation-note" in code and "Notiz-Sprache" in code
    assert ".transcript .answer" in AGENTS_CSS, "a monospace look for the four agents' notes, distinct from the plain final answer"


def test_asking_can_be_stopped_mid_answer():
    code = code_of(JS)
    assert "AbortController" in code and "app.controller.signal" in code and "app.controller?.abort()" in code
    assert '"AbortError"' in code, "a deliberate stop must not be shown as an error"


def test_every_style_variable_regal_agents_uses_is_defined():
    defined = set(re.findall(r"(--[\w-]+)\s*:", CSS))
    used = set(re.findall(r"var\((--[\w-]+)", AGENTS_CSS))
    assert used and used <= defined, used - defined


CLASS_PATTERNS = [re.compile(pattern) for pattern in (r'\bclass:\s*"([^"]*)"', r"\bclass:\s*'([^']*)'", r'\.className\s*=\s*"([^"]*)"', r'classList\.(?:add|remove|toggle|contains)\("([^"]*)"')]
MARKERS = {"on", "open", "count", "bar", "more", "fav", "section", "size", "kind", "bot", "regen", "save-note"}


def class_names_in(source):
    names = set()
    for pattern in CLASS_PATTERNS:
        for text in pattern.findall(source):
            for token in re.sub(r"\$\{[^}]*\}", " ", text).split():
                if re.fullmatch(r"[a-z][\w-]*", token):
                    names.add(token)
    return names


def test_every_class_regal_agents_gives_an_element_has_a_style():
    classes = set(re.findall(r"\.([a-z][\w-]*)", CSS)) | set(re.findall(r"\.([a-z][\w-]*)", CHAT_CSS)) | set(re.findall(r"\.([a-z][\w-]*)", AGENTS_CSS))
    missing = {token for token in class_names_in(JS) if token not in classes and token not in MARKERS}
    assert not missing, missing


def test_the_template_has_no_inline_style_or_script_and_downloads_nothing():
    html = read("templates", "regal_agents.html")
    assert not re.search(r"\son[a-z]+\s*=", html) and 'style="' not in html and "javascript:" not in html
    assert "data-theme" not in html
    assert "data-models" not in html and "data-worker" not in html, "the page no longer downloads a model"
    assert ".status-row" in AGENTS_CSS and ".transcript" in AGENTS_CSS and ".agent-final" in AGENTS_CSS
