"""One-off maintenance script (local/dev use): retroactively hash existing
video files and revoke the old +600 upload bonus from duplicate uploads
beyond the first.

Safe to run more than once -- already-penalized duplicates are skipped
via Video.duplicate_penalty_applied.

Note: against production, use the admin-gated route instead
(POST /admin/cleanup-duplicate-videos?dry_run=1), since this script needs
a database connection this machine may not have (e.g. Railway's internal
Postgres hostname is only reachable from within Railway's network).

Usage:
    ./.venv/Scripts/python.exe scripts/cleanup_duplicate_uploads.py --dry-run
    ./.venv/Scripts/python.exe scripts/cleanup_duplicate_uploads.py
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import app, run_duplicate_cleanup  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Report what would change without writing anything to the database.",
    )
    args = parser.parse_args()

    with app.app_context():
        report = run_duplicate_cleanup(dry_run=args.dry_run)

        print(f"Found {report['videos_total']} videos total.")
        verb = "Would hash" if args.dry_run else "Hashed"
        print(f"{verb} {report['hashed_this_run']} video(s) this run ({len(report['unreadable'])} unreadable/skipped).")
        for item in report["unreadable"]:
            print(f"  [SKIP] video {item['video_id']} ({item['filename']}): {item['error']}")

        print(f"Found {report['duplicate_groups']} group(s) of duplicate content.")
        for p in report["penalties"]:
            tag = "[DRY RUN, not applied]" if args.dry_run else ""
            print(
                f"  video {p['video_id']} (original kept: {p['kept_original_video_id']}): "
                f"user '{p['username']}' total_score {p['total_score_before']} -> "
                f"{p['total_score_after']} (-{p['deducted']}) {tag}"
            )

        affected = sorted({p["username"] for p in report["penalties"]})
        prefix = "[DRY RUN] Would deduct" if args.dry_run else "Done. Deducted"
        print(f"\n{prefix} {report['total_deducted']} point(s) total across {len(affected)} account(s): {affected}")


if __name__ == "__main__":
    main()
