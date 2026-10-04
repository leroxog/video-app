"""One command for the whole song computer: starts the model server, then makes songs until Ctrl+C.

    python run_all.py          (or double-click start-ysound.bat)

The model server runs as its own low-priority process (so the computer stays usable while a song is made),
writes its log to <ysound-ai>\\model-server.log, and is stopped again when this program ends.
Run this with a plain Python -- NOT the one from the ACE-Step environment: the worker only needs the
standard library, and the firewall rule from harden.ps1 only blocks the model's own python.exe.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

import worker

HERE = Path(__file__).resolve().parent
AI_DIR = Path(os.environ.get("YSOUND_AI_DIR", Path.home() / "ysound-ai"))
ACE_DIR = Path(os.environ.get("ACESTEP_DIR", AI_DIR / "ACE-Step-1.5"))
CONFIG = Path(os.environ.get("YSOUND_WORKER_CONFIG", AI_DIR / "worker.json"))
ACE_PYTHON = ACE_DIR / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
BELOW_NORMAL = 0x00004000          # Windows: BELOW_NORMAL_PRIORITY_CLASS
START_TIMEOUT = 900                # the first start loads several GB; allow a generous time


def start_model_server():
    if not ACE_PYTHON.exists():
        raise worker.WorkerError(f"Die ACE-Step-Umgebung fehlt: {ACE_PYTHON}")
    log_file = open(AI_DIR / "model-server.log", "ab")
    flags = BELOW_NORMAL if os.name == "nt" else 0
    return subprocess.Popen([str(ACE_PYTHON), str(HERE / "serve_model.py")], cwd=str(ACE_DIR),
                            stdout=log_file, stderr=subprocess.STDOUT, creationflags=flags)


def main():
    logging = worker.logging
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    try:
        config = worker.load_config(CONFIG)
        model = worker.Model(config["model_api"], config["model_api_key"], config["inference_steps"], config["job_timeout_seconds"])
        server = start_model_server()
    except worker.WorkerError as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 1
    try:
        print("Starte das Modell (beim ersten Mal dauert das einige Minuten) ...")
        deadline = time.monotonic() + START_TIMEOUT
        while True:
            if server.poll() is not None:
                print(f"Das Modell wurde beendet (Code {server.returncode}). Siehe {AI_DIR / 'model-server.log'}", file=sys.stderr)
                return 1
            try:
                if model.health():
                    break
            except worker.WorkerError:
                pass
            if time.monotonic() > deadline:
                print("Das Modell ist nicht rechtzeitig bereit geworden.", file=sys.stderr)
                return 1
            time.sleep(3)
        print("Modell bereit. Songs werden gemacht, solange dieses Fenster offen ist (Ctrl+C beendet).")
        worker.main_loop(config)
        return 0
    except KeyboardInterrupt:
        print("\nBeendet.")
        return 0
    finally:
        server.terminate()
        try:
            server.wait(timeout=20)
        except subprocess.TimeoutExpired:
            server.kill()


if __name__ == "__main__":
    sys.exit(main())
