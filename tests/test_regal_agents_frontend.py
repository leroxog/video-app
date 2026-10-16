"""Nex Ai's home page (three passes of the on-device AI): the files it is made of put nothing the model writes on the page as HTML,
run no foreign code, talk only to Hugging Face, and look like the rest of the site.  regal-agents.js reuses regal-core.js, regal-ui.js,
regal-chat-core.js and the worker as they are (checked in test_regal_frontend.py / regal_chat_core.test.js); this file checks only
what regal-agents.js and regal-agents.css add."""
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


def test_nothing_the_model_writes_is_put_on_the_page_as_html_and_it_runs_no_foreign_code():
    code = code_of(JS)
    for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "document.cookie", "sessionStorage",
                 "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "importScripts", "import("):
        assert sink not in code, f"regal-agents.js uses {sink}"
    allowed = ("http://www.w3.org/2000/svg", "https://huggingface.co/", "https://${")
    for address in re.findall(r"https?://[^\s\"'`)]+", code):
        assert address.startswith(allowed), f"regal-agents.js points to {address}"


def test_it_fetches_only_the_list_of_models_and_sends_nothing():
    code = code_of(JS)
    assert code.count("fetch(") == 1 and "fetch(root.dataset.models" in code and 'credentials: "omit"' in code


def test_three_real_passes_go_through_the_one_worker_and_the_text_is_put_on_the_page_as_text():
    code = code_of(JS)
    assert "new Worker(root.dataset.worker, { type: \"module\" })" in code
    assert code.count("postMessage") >= 2, "load and generate calls"
    assert "Chat.parseBlocks(agent.text)" in code and "Chat.parseInline(text)" in code


def test_every_style_variable_that_regal_agents_uses_is_defined():
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


def test_the_template_has_no_inline_style_or_script_and_the_agent_turns_share_the_chat_look():
    html = read("templates", "regal_agents.html")
    assert not re.search(r"\son[a-z]+\s*=", html) and 'style="' not in html and "javascript:" not in html
    assert "data-theme" not in html
    assert ".agent-turn" in AGENTS_CSS and ".agent-label" in AGENTS_CSS and ".agent-final" in AGENTS_CSS
    assert "@media (prefers-reduced-motion: reduce)" not in AGENTS_CSS or "transition: none" in AGENTS_CSS
