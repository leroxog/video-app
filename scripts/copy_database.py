"""Copies the whole database from one address to another (for the move from Railway to Neon or any other PostgreSQL):
    python scripts/copy_database.py "postgresql://OLD..." "postgresql://NEW..."
The tables of Satürn are made in the new database first (empty), then every table is copied in pieces; afterwards the counters of the numbers (ids) are set so that new rows go on after the
copied ones. The old database is only read. Run it again on an empty new database if something went wrong."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import LargeBinary, MetaData, create_engine, text  # noqa: E402

BATCH = 500
BATCH_BINARY = 4                 # tables that hold files (binary columns) are copied a few rows at a time, so the memory stays small


def fix(url):
    return "postgresql://" + url[len("postgres://"):] if url.startswith("postgres://") else url


def copy(source_url, target_url, out=print):
    source = create_engine(fix(source_url))
    target = create_engine(fix(target_url))
    # the tables of the site are made by the models of the site itself, so the new database gets exactly the same shape
    os.environ.setdefault("DATABASE_URL", fix(target_url))
    from app import db  # noqa: E402  (importing it defines every model)
    db.metadata.create_all(bind=target)
    source_meta = MetaData()
    source_meta.reflect(bind=source)
    target_meta = MetaData()
    target_meta.reflect(bind=target)
    # the site puts some starting rows into a new database by itself: the new tables are emptied first, so that the copy is exactly the old database
    with target.begin() as write:
        names = [t.name for t in target_meta.sorted_tables]
        if target.dialect.name == "postgresql" and names:
            write.execute(text("TRUNCATE " + ", ".join(f'"{n}"' for n in names) + " RESTART IDENTITY CASCADE"))
        else:
            for t in reversed(target_meta.sorted_tables):
                write.execute(t.delete())
    total = 0
    for table in source_meta.sorted_tables:
        name = table.name
        if name not in target_meta.tables:
            out(f"skipped {name} (not in the new database)")
            continue
        goal = target_meta.tables[name]
        columns = [c.name for c in table.columns if c.name in goal.columns]
        count = 0
        with source.connect() as read, target.begin() as write:
            result = read.execution_options(stream_results=True).execute(table.select())
            size = BATCH_BINARY if any(isinstance(c.type, LargeBinary) for c in table.columns) else BATCH
            while True:
                rows = result.fetchmany(size)
                if not rows:
                    break
                statement = goal.insert()
                if target.dialect.name == "postgresql":                    # (a row that the site made by itself in the meantime stays, the copied one is skipped)
                    from sqlalchemy.dialects.postgresql import insert as pg_insert
                    statement = pg_insert(goal).on_conflict_do_nothing()
                write.execute(statement, [{c: row._mapping[c] for c in columns} for row in rows])
                count += len(rows)
        total += count
        out(f"{name}: {count} rows")
    if target.dialect.name == "postgresql":
        with target.begin() as write:
            for name, goal in target_meta.tables.items():
                for column in goal.primary_key.columns:
                    sequence = write.execute(text("SELECT pg_get_serial_sequence(:t, :c)"), {"t": f'"{name}"', "c": column.name}).scalar()
                    if sequence:
                        write.execute(text(f'SELECT setval(:s, COALESCE((SELECT MAX("{column.name}") FROM "{name}"), 0) + 1, false)'), {"s": sequence})
    out(f"done: {total} rows copied")
    return total


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    copy(sys.argv[1], sys.argv[2])
