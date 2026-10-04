"""Start the ACE-Step API server for the song computer: offline, local-only, behind the network guard.

Run it with the Python of the ACE-Step environment (run_all.py does that for you):

    <ACE-Step>\\.venv\\Scripts\\python.exe serve_model.py

What it sets up before a single line of ACE-Step code is imported:
  1. netguard: this process may only talk to this computer (see netguard.py for the honest limits);
  2. offline switches for Hugging Face, Transformers and friends, so nothing is ever downloaded or checked
     for updates -- the weights were fetched once, verified by hash, and stay as they are;
  3. the server listens on 127.0.0.1 only, and every request needs the API key from worker.json.
"""
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
AI_DIR = Path(os.environ.get("YSOUND_AI_DIR", Path.home() / "ysound-ai"))
ACE_DIR = Path(os.environ.get("ACESTEP_DIR", AI_DIR / "ACE-Step-1.5"))
CONFIG = Path(os.environ.get("YSOUND_WORKER_CONFIG", AI_DIR / "worker.json"))

OFFLINE_ENV = {
    "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "HF_DATASETS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
    "DO_NOT_TRACK": "1", "GRADIO_ANALYTICS_ENABLED": "False", "ANONYMIZED_TELEMETRY": "False",
    "TOKENIZERS_PARALLELISM": "false", "PYTHONUTF8": "1",
}


def main():
    sys.path.insert(0, str(HERE))
    import netguard
    netguard.install()
    os.environ.update(OFFLINE_ENV)

    config = json.loads(CONFIG.read_text(encoding="utf-8"))
    port = str(config.get("model_api", "http://127.0.0.1:8001")).rsplit(":", 1)[-1].strip("/")
    os.environ["ACESTEP_API_KEY"] = config["model_api_key"]
    os.environ.setdefault("ACESTEP_INIT_LLM", "false")        # no language model: it doesn't fit next to the DiT on 4 GB
    os.environ["ACESTEP_ON_DEMAND_MODEL_LOAD"] = "false"      # never fetch another model because a request names one
    os.environ.setdefault("ACESTEP_GENERATION_TIMEOUT", "1500")   # a 2:30 song on a 4 GB card needs more than the default 10 minutes
    for name in ("ACESTEP_EXTERNAL_LM_PROVIDER", "ACESTEP_EXTERNAL_BASE_URL", "ACESTEP_GLM_BASE_URL"):
        os.environ.pop(name, None)                            # the optional "ask an outside AI service" features stay off

    os.chdir(ACE_DIR)
    sys.path.insert(0, str(ACE_DIR))
    sys.argv = ["acestep-api", "--host", "127.0.0.1", "--port", port]
    from acestep.api_server import main as api_main
    api_main()


if __name__ == "__main__":
    main()
