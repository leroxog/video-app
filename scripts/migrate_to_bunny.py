"""Sends every video that is not on Bunny Stream yet to Bunny (see yipi_bunny.py). Run it once after the settings BUNNY_LIBRARY_ID, BUNNY_API_KEY and BUNNY_CDN_HOST are set:
    python scripts/migrate_to_bunny.py            (all videos)
    python scripts/migrate_to_bunny.py 20         (only the next 20, to try it)
It can be stopped and started again at any time: what is on Bunny already is skipped."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import yipi  # noqa: E402
import yipi_bunny  # noqa: E402
from app import app  # noqa: E402

if not yipi_bunny.enabled():
    sys.exit("Bunny is not set up: BUNNY_LIBRARY_ID, BUNNY_API_KEY and BUNNY_CDN_HOST are needed.")
limit = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else None
with app.app_context():
    yipi.db.create_all()
    sent, failed = yipi.bunny_migrate(limit)
print(f"{sent} videos sent to Bunny, {failed} failed.")
