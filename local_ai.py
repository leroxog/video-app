"""NexAI's own, self-hosted chat model -- runs entirely in this process on
CPU via llama-cpp-python, no external API, no per-token cost. This is
what replaced Groq for text generation (see ai_assistant.py's
_call_model/_call_model_message): every chat and voice-chat reply is now
produced by this one small model, deliberately traded for cost/ownership
against Groq's much larger hosted model -- noticeably weaker and slower,
an accepted tradeoff, not a bug.

Image generation (Pollinations.ai) and cloned-voice audio (ElevenLabs)
are untouched -- this module is only ever used for the text reply
itself.

The model file is NOT committed to the repo (it's ~1 GB) -- it's
downloaded once, lazily, on first use, into instance/models/ next to the
SQLite dev database. On Railway specifically, the filesystem is wiped on
every deploy/restart (see app.py's own startup warning about this same
limitation for uploaded videos/images), so this download repeats after
each deploy -- an accepted cost of staying on free, storage-less
hosting, not something this module tries to work around.
"""
import os
import logging
import threading
import urllib.request

logger = logging.getLogger(__name__)

INSTANCE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "instance")
MODEL_DIR = os.path.join(INSTANCE_DIR, "models")
MODEL_FILENAME = "qwen2.5-1.5b-instruct-q4_k_m.gguf"
MODEL_PATH = os.path.join(MODEL_DIR, MODEL_FILENAME)
MODEL_DOWNLOAD_URL = (
    "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/"
    + MODEL_FILENAME
)
# A corrupt/truncated download would otherwise load "successfully" as
# a tiny, garbage model -- anything under this is treated as missing.
MIN_VALID_MODEL_BYTES = 500 * 1024 * 1024

# NexAI's system prompt (character/personality/formatting/tool
# instructions combined) alone runs to roughly 3000 tokens -- 4096 total
# context left almost no room for conversation history or the reply
# itself, silently truncating older messages and starving the actual
# generation. 8192 costs modestly more RAM (KV cache scales with context
# length) but comfortably fits prompt + history + reply.
CONTEXT_TOKENS = 8192

_llama = None
_load_error = None
_load_lock = threading.Lock()


def _ensure_model_file():
    os.makedirs(MODEL_DIR, exist_ok=True)
    if os.path.exists(MODEL_PATH) and os.path.getsize(MODEL_PATH) >= MIN_VALID_MODEL_BYTES:
        return
    logger.info("Lade lokales KI-Modell herunter (~1 GB, einmalig pro Deploy)...")
    tmp_path = MODEL_PATH + ".part"
    urllib.request.urlretrieve(MODEL_DOWNLOAD_URL, tmp_path)
    if os.path.getsize(tmp_path) < MIN_VALID_MODEL_BYTES:
        os.remove(tmp_path)
        raise RuntimeError("Der Modell-Download war unvollständig.")
    os.replace(tmp_path, MODEL_PATH)
    logger.info("Lokales KI-Modell heruntergeladen.")


def _load_llama():
    from llama_cpp import Llama
    _ensure_model_file()
    thread_count = min(4, max(1, os.cpu_count() or 2))
    return Llama(
        model_path=MODEL_PATH,
        n_ctx=CONTEXT_TOKENS,
        n_threads=thread_count,
        chat_format="chatml",
        verbose=False,
    )


def get_llama():
    """Loads the model on first call and caches it for the process's
    lifetime -- loading takes a few seconds and ~1.5 GB RAM, so this must
    happen at most once, not per-request."""
    global _llama, _load_error
    if _llama is not None:
        return _llama
    if _load_error is not None:
        raise _load_error
    with _load_lock:
        if _llama is not None:
            return _llama
        if _load_error is not None:
            raise _load_error
        try:
            _llama = _load_llama()
        except Exception as exc:
            _load_error = exc
            raise
    return _llama


def generate_chat(messages, max_tokens, temperature=0.7):
    """messages: the same [{"role", "content"}, ...] shape used throughout
    ai_assistant.py. Returns the model's raw text reply (may still
    contain an embedded ```tool_call``` block -- parsing that is
    ai_assistant.py's job, this function only runs the model)."""
    llama = get_llama()
    result = llama.create_chat_completion(
        messages=messages, max_tokens=max_tokens, temperature=temperature,
    )
    return result["choices"][0]["message"]["content"] or ""
