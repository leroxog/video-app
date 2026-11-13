"""Satürn, 2026-11-11: scripts/copy_database.py copies a whole database to another address (the move to a new host). Tested here with two SQLite files."""
import importlib.util
import os
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
os.environ["DATABASE_URL"] = f"sqlite:///{tempfile.gettempdir()}/video_app_test_import_throwaway.db"
os.environ["NRS_AUTO_INDEX"] = "0"

from sqlalchemy import create_engine, text  # noqa: E402

import yipi  # noqa: E402
from app import db  # noqa: E402


def load():
    spec = importlib.util.spec_from_file_location("copy_database", os.path.join(ROOT, "scripts", "copy_database.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_copy_script_copies_every_row_and_keeps_binary_data(tmp_path):
    old, new = tmp_path / "old.db", tmp_path / "new.db"
    source = create_engine(f"sqlite:///{old}")
    db.metadata.create_all(bind=source)
    with source.begin() as connection:
        connection.execute(yipi.YipiUser.__table__.insert(), [{"handle": "mia", "handle_lc": "mia", "name": "Mia", "password_hash": "x"}, {"handle": "tom", "handle_lc": "tom", "name": "Tom", "password_hash": "y"}])
        connection.execute(yipi.YipiMedia.__table__.insert(), [{"id": "a" * 32, "owner_id": 1, "content_type": "image/png", "data": b"\x89PNG\x00\x01", "size": 6, "width": 1, "height": 1}])
    with create_engine(f"sqlite:///{new}").begin() as connection:             # (the new database is not empty: the site has put a starting row into it)
        db.metadata.create_all(bind=connection)
        connection.execute(yipi.YipiUser.__table__.insert(), [{"handle": "start", "handle_lc": "start", "name": "Start", "password_hash": "z"}])
    lines = []
    total = load().copy(f"sqlite:///{old}", f"sqlite:///{new}", out=lines.append)
    assert total == 3 and "yipi_user: 2 rows" in lines and "yipi_media: 1 rows" in lines
    target = create_engine(f"sqlite:///{new}")
    with target.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM yipi_user")).scalar() == 2
        assert connection.execute(text("SELECT handle FROM yipi_user ORDER BY id")).scalars().all() == ["mia", "tom"]
        assert bytes(connection.execute(text("SELECT data FROM yipi_media")).scalar()) == b"\x89PNG\x00\x01"


def test_the_fly_files_exist_and_keep_one_machine_on_all_the_time():
    config = open(os.path.join(ROOT, "fly.toml"), encoding="utf-8").read()
    for word in ('primary_region = "fra"', "internal_port = 8000", 'auto_stop_machines = "off"', "min_machines_running = 1", 'dockerfile = "Dockerfile"'):
        assert word in config, word
    assert os.path.exists(os.path.join(ROOT, "deploy", "FLY_ANLEITUNG.md"))
