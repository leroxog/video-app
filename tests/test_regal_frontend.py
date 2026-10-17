"""Nex Ai's page: the files it is made of agree with each other (the scripts in the right order, every style a script uses exists),
nothing from the list is ever put on the page as HTML, links to other sites do not hand over the page, and the page talks only to
Hugging Face and only for the files that a person chooses.  The functions that do not touch the page are tested in regal_core.test.js
(run from here too)."""
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
JS_DIR = os.path.join(ROOT, "static", "js")
SCRIPTS = ["regal-core.js", "regal-ui.js", "regal-download.js", "regal.js"]
CHAT_SCRIPTS = ["regal-core.js", "regal-ui.js", "regal-chat-core.js", "regal-chat.js"]       # what the archived single chat page loads
AGENTS_SCRIPTS = ["regal-core.js", "regal-ui.js", "regal-chat-core.js", "regal-agents.js"]   # what the home page (three passes) loads
WORKER = "regal-chat-worker.js"                                                              # runs the model (loaded by regal-chat.js and regal-agents.js as a worker)
NODE = shutil.which("node")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as handle:
        return handle.read()


JS = {name: read("static", "js", name) for name in SCRIPTS}
CHAT_JS = {name: read("static", "js", name) for name in CHAT_SCRIPTS + [WORKER]}
CSS = read("static", "css", "regal.css")
CHAT_CSS = read("static", "css", "regal-chat.css")


def code_of(source):
    return re.sub(r"/\*.*?\*/|(?<![:\"'])//[^\n]*", "", source, flags=re.S)


def test_the_template_loads_the_scripts_in_dependency_order_and_nothing_inline():
    html = read("templates", "regal.html")
    assert re.findall(r"<script src=\"\{\{ static_url\('js/([\w-]+\.js)'\) \}\}\"></script>", html) == SCRIPTS
    for tag in re.findall(r"<script\b[^>]*>", html):
        assert "src=" in tag, f"an inline script would break the content security policy: {tag}"
    chat_html = read("templates", "regal_chat.html")
    assert re.findall(r"<script src=\"\{\{ static_url\('js/([\w-]+\.js)'\) \}\}\"></script>", chat_html) == CHAT_SCRIPTS
    for tag in re.findall(r"<script\b[^>]*>", chat_html):
        assert "src=" in tag, f"an inline script would break the content security policy: {tag}"
    agents_html = read("templates", "regal_agents.html")
    assert re.findall(r"<script src=\"\{\{ static_url\('js/([\w-]+\.js)'\) \}\}\"></script>", agents_html) == AGENTS_SCRIPTS
    for tag in re.findall(r"<script\b[^>]*>", agents_html):
        assert "src=" in tag, f"an inline script would break the content security policy: {tag}"
    for name in ("regal.html", "regal_chat.html", "regal_agents.html", "legal.html", "error.html"):
        text = read("templates", name)
        assert not re.search(r"\son[a-z]+\s*=", text), f"{name}: inline event handler"
        assert 'style="' not in text and "javascript:" not in text, name
        for path in re.findall(r"static_url\('([^']+)'\)", text):
            assert os.path.exists(os.path.join(ROOT, "static", *path.split("/"))), f"{name} loads {path}"


def test_every_script_is_listed_in_the_template_and_is_valid_javascript():
    on_disk = sorted(os.path.basename(path) for path in glob.glob(os.path.join(JS_DIR, "regal*.js")))
    assert on_disk == sorted(set(SCRIPTS + CHAT_SCRIPTS + AGENTS_SCRIPTS + [WORKER])), "a regal script that no page loads (or the other way round)"
    if NODE is None:
        pytest.skip("Node.js is not installed")
    for name in on_disk:
        result = subprocess.run([NODE, "--check", os.path.join(JS_DIR, name)], capture_output=True, text=True, timeout=60)
        assert result.returncode == 0, f"{name}: {result.stderr[-800:]}"


@pytest.mark.skipif(NODE is None, reason="Node.js is not installed")
def test_the_node_tests_of_the_shelf_pass():
    files = sorted(glob.glob(os.path.join(ROOT, "tests", "regal_*.test.js")))
    assert files
    result = subprocess.run([NODE, "--test"] + files, capture_output=True, text=True, timeout=300)
    assert result.returncode == 0, (result.stdout + result.stderr)[-3000:]
    assert "# fail 0" in result.stdout and "# pass" in result.stdout


ALLOWED = ("http://www.w3.org/2000/svg", "https://huggingface.co", "https://github.com/", "https://lmstudio.ai", "https://ollama.com", "https://${", "http://${")


def test_nothing_from_the_list_is_put_on_the_page_as_html_and_the_page_runs_no_foreign_code():
    for name, source in JS.items():
        code = code_of(source)
        for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "document.cookie", "sessionStorage"):
            assert sink not in code, f"{name} uses {sink}"
        for address in re.findall(r"https?://[^\s\"'`)]+", code):
            assert address.startswith(ALLOWED), f"{name} points to {address}"
        assert "importScripts" not in code and "import(" not in code, name


def test_the_page_asks_only_for_its_own_list_and_for_the_files_a_person_chooses():
    for name, source in JS.items():
        code = code_of(source)
        for sink in ("XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource"):
            assert sink not in code, f"{name} uses {sink}"
    fetches = {name: code_of(source).count("fetch(") for name, source in JS.items()}
    assert fetches == {"regal-core.js": 0, "regal-ui.js": 0, "regal-download.js": 1, "regal.js": 1}, fetches
    assert "fetch(root.dataset.models" in JS["regal.js"] and "Core.fileUrl(model.id, item.path, false)" in JS["regal-download.js"]
    assert 'credentials: "omit"' in JS["regal.js"]


def test_the_chat_puts_nothing_from_the_model_on_the_page_as_html_and_sends_nothing_anywhere():
    for name, source in CHAT_JS.items():
        code = code_of(source)
        for sink in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "document.cookie", "sessionStorage",
                     "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "importScripts", "import("):
            assert sink not in code, f"{name} uses {sink}"
        for address in re.findall(r"https?://[^\s\"'`)]+", code):
            allowed = ALLOWED if name in JS else ("http://www.w3.org/2000/svg", "https://huggingface.co/", "https://${")      # the chat's own files point nowhere else
            assert address.startswith(allowed), f"{name} points to {address}"
    fetches = {name: code_of(source).count("fetch(") for name, source in CHAT_JS.items()}
    assert fetches == {"regal-core.js": 0, "regal-ui.js": 0, "regal-chat-core.js": 0, "regal-chat.js": 1, WORKER: 0}, fetches
    assert "fetch(root.dataset.models" in CHAT_JS["regal-chat.js"] and 'credentials: "omit"' in CHAT_JS["regal-chat.js"]
    assert "postMessage" in CHAT_JS["regal-chat.js"] and "new Worker(root.dataset.worker, { type: \"module\" })" in CHAT_JS["regal-chat.js"]
    # what people write goes to the worker (the model on their own computer) and nowhere else
    assert code_of(CHAT_JS["regal-chat.js"]).count("postMessage(") == 3 and "app.worker" in CHAT_JS["regal-chat.js"]


def test_the_chat_stores_only_the_chats_and_the_failed_models_and_the_privacy_page_says_so():
    legal = read("templates", "legal.html")
    for name, source in CHAT_JS.items():
        code = code_of(source)
        assert ("localStorage" in code) == (name == "regal-chat.js"), f"{name}: only regal-chat.js keeps something in the browser"
    keys = set(re.findall(r'"(regal\.[a-z.]+)"', code_of(CHAT_JS["regal-chat.js"])))
    assert keys == {"regal.chats", "regal.skip"} and all(key in legal for key in keys)
    assert '"transformers-cache"' in CHAT_JS["regal-chat.js"] and "transformers-cache" in legal


def test_the_page_measures_the_graphics_card_and_takes_the_best_ai_for_it():
    code = code_of(CHAT_JS["regal-chat.js"])
    assert "measureBandwidth(adapter)" in code and "onSubmittedWorkDone" in code and "device.destroy()" in code
    assert "Chat.bestModel(app.models, app.gpu" in code and "gpu.maxBuffer" in code and "navigator.deviceMemory" in code
    assert "fetch(" in code and code.count("fetch(") == 1, "measuring needs no network"


def test_a_download_that_hangs_is_noticed_and_can_be_started_again():
    code = code_of(CHAT_JS["regal-chat.js"])
    assert "checkStall" in code and "40000" in code and "setInterval(checkStall, 5000)" in code and "function restartLoading" in code and "clearInterval(app.watch)" in code
    assert code.count("clearInterval(app.watch)") >= 2, "the watch ends when the AI is ready and when the worker is stopped"
    assert "progress.fraction < 0.995" in code, "a computer that only prepares the AI after the download is not a hanging download"


def test_a_graphics_card_that_does_not_work_means_the_processor_with_the_model_that_can_use_it():
    code = code_of(CHAT_JS["regal-chat.js"])
    worker = code_of(CHAT_JS[WORKER])
    assert 'const NO_GPU = "webgpu"' in code and "app.skips[NO_GPU] = Date.now()" in code and "Chat.isMemoryTrouble(raw)" in code
    assert "webgpu: false, f16: false, bandwidth: null" in code and "app.realGpu" in code, "the real graphics card is kept for 'Noch einmal versuchen'"
    assert "if (app.skips[NO_GPU]) app.gpu =" in code, "the next visit starts on the processor straight away"
    assert "navigator.gpu.requestAdapter()" in worker and "no graphics card adapter" in worker, "the worker says clearly when it cannot use the card the page found"
    assert "app.rawError" in code and "raw-error" in CHAT_CSS, "the real error is on the page, not only behind 'Technische Angaben'"


def test_the_chat_has_nothing_to_choose():
    code = code_of(CHAT_JS["regal-chat.js"])
    assert "bestModel(" in code and 'type: "radio"' not in code and "listbox" not in code, "one AI: the page takes the best one"
    assert "chooseModel" not in code and "MODEL_KEY" not in code and "regal.chat.model" not in code


def test_links_to_other_sites_do_not_hand_over_the_page():
    for name, source in JS.items():
        for line in code_of(source).split("\n"):
            if 'target: "_blank"' in line:
                assert "noopener" in line and "noreferrer" in line, f"{name}: {line.strip()[:120]}"
    assert 'a.rel = "noopener noreferrer"' in JS["regal-download.js"]


def test_the_page_stores_only_what_the_privacy_page_says():
    legal = read("templates", "legal.html")
    keys = set()
    for name, source in JS.items():
        keys |= set(re.findall(r'"(regal\.[a-z]+)"', code_of(source)))
        assert ("localStorage" in code_of(source)) == (name == "regal.js"), f"{name}: only regal.js keeps things in the browser"
    assert keys == {"regal.fav"}
    assert "regal.fav" in legal and "keine Cookies" in legal and "Hugging Face" in legal


def test_every_style_variable_that_is_used_is_defined():
    defined = set(re.findall(r"(--[\w-]+)\s*:", CSS))
    used = set(re.findall(r"var\((--[\w-]+)", CSS)) | set(re.findall(r"var\((--[\w-]+)", CHAT_CSS))
    for source in list(JS.values()) + list(CHAT_JS.values()):
        used |= set(re.findall(r"var\((--[\w-]+)", source))
    assert used and used <= defined, used - defined


CLASS_PATTERNS = [re.compile(pattern) for pattern in (r'\bclass:\s*"([^"]*)"', r"\bclass:\s*'([^']*)'", r'\.className\s*=\s*"([^"]*)"', r'classList\.(?:add|remove|toggle|contains)\("([^"]*)"')]


def class_names_in(source):
    names = set()
    for pattern in CLASS_PATTERNS:
        for text in pattern.findall(source):
            for token in re.sub(r"\$\{[^}]*\}", " ", text).split():
                if re.fullmatch(r"[a-z][\w-]*", token):
                    names.add(token)
    return names


# Classes that are only a marker for the script (nothing to draw) or are made from a name (fmt-gguf, lic-yes ...).
MARKERS = {"on", "open", "count", "bar", "more", "fav", "section", "size", "kind", "bot", "regen", "save-note"}


def test_every_class_the_scripts_give_to_an_element_has_a_style():
    css_classes = set(re.findall(r"\.([a-z][\w-]*)", CSS))
    chat_classes = css_classes | set(re.findall(r"\.([a-z][\w-]*)", CHAT_CSS))
    missing = {}
    for name, source in JS.items():
        for token in class_names_in(source):
            if token not in css_classes and token not in MARKERS:
                missing.setdefault(token, []).append(name)
    for name, source in CHAT_JS.items():
        for token in class_names_in(source):
            if token not in chat_classes and token not in MARKERS:
                missing.setdefault(token, []).append(name)
    assert not missing, missing


def test_the_layout_works_on_small_screens_and_respects_reduced_motion_and_light_mode():
    assert "[hidden] { display: none !important; }" in CSS, "a hidden element must be hidden whatever display its class says"
    assert "@media (max-width: 560px)" in CSS and "grid-template-columns: repeat(auto-fill, minmax(min(290px, 100%), 1fr))" in CSS
    # a grid column that may not shrink below its content pushed the dialog out of a phone screen
    assert ".model-body { display: grid; grid-template-columns: minmax(0, 1fr);" in CSS
    assert "prefers-reduced-motion: reduce" in CSS and "prefers-color-scheme: light" in CSS
    assert "env(safe-area-inset-bottom)" in CSS and "env(safe-area-inset-top)" in CSS
    for page in ("regal.html",):                                      # (the legal and error pages are Pulse pages now, with their own theme script)             # a fixed data-theme="dark" would keep the light colours from ever being used
        with open(os.path.join(ROOT, "templates", page), encoding="utf-8") as handle:
            assert "data-theme" not in handle.read(), page


def test_the_chat_page_works_on_small_screens_too_and_has_the_look_of_chatgpt():
    assert "@media (max-width: 899px)" in CHAT_CSS and "@media (min-width: 900px)" in CHAT_CSS and "prefers-reduced-motion: reduce" in CHAT_CSS
    assert "env(safe-area-inset-bottom)" in CHAT_CSS, "the message field must stay above the home bar of a phone"
    for token in ("--bg: #212121", "--bg-deep: #171717", "--panel: #2f2f2f", "--accent: #10a37f", "--primary: #ececec", '"Inter"'):
        assert token in CSS, token
    for flat in ("backdrop-filter", "radial-gradient", "blur("):
        assert flat not in CHAT_CSS, f"flat like ChatGPT: no {flat}"
    assert ".send { " in CHAT_CSS and "background: var(--primary)" in CHAT_CSS, "the send button is the round white one"
    assert "Fraunces" not in CSS and "Fraunces" not in CHAT_CSS
    assert os.path.exists(os.path.join(ROOT, "static", "fonts", "inter-latin-wght-normal.woff2")) and os.path.exists(os.path.join(ROOT, "static", "fonts", "Inter-OFL.txt"))
    assert not os.path.exists(os.path.join(ROOT, "static", "fonts", "fraunces-latin-wght-normal.woff2")), "the old font is not shipped any more"


def test_the_page_names_what_there_is_in_plain_words_and_promises_what_the_list_holds():
    core = JS["regal-core.js"]
    for word in ("Chat & Schreiben", "Bilder erzeugen", "Videos erzeugen", "Musik & Klänge", "Sprache vorlesen"):
        assert word in core, word
    assert "Gratis" in JS["regal.js"] and "Ohne Konto" in JS["regal.js"]
