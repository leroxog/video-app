"""One-off maintenance script: retroactively hash existing video files and
revoke the old +600 upload bonus from duplicate uploads (same content
uploaded more than once) beyond the first, now that the app prevents
duplicate content going forward.

Safe to run more than once -- already-penalized duplicates are skipped
via Video.duplicate_penalty_applied.

Usage against production (from the video-app directory):
    railway run python scripts/cleanup_duplicate_uploads.py --dry-run
    railway run python scripts/cleanup_duplicate_uploads.py
Usage locally:
    ./.venv/Scripts/python.exe scripts/cleanup_duplicate_uploads.py --dry-run
"""
import argparse
import hashlib
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app import app, db, USE_R2, r2_client, R2_BUCKET_NAME  # noqa: E402
from models import Video  # noqa: E402

OLD_UPLOAD_BONUS = 600


def fetch_video_bytes(video):
    if USE_R2:
        obj = r2_client.get_object(Bucket=R2_BUCKET_NAME, Key=f"uploads/{video.filename}")
        return obj["Body"].read()
    folder = app.config["UPLOAD_FOLDER"]
    with open(os.path.join(folder, video.filename), "rb") as f:
        return f.read()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Report what would change without writing anything to the database.",
    )
    args = parser.parse_args()

    with app.app_context():
        videos = Video.query.order_by(Video.created_at.asc()).all()
        print(f"Found {len(videos)} videos total.")

        hashed = 0
        skipped = 0
        computed_hashes = {}
        for video in videos:
            if video.content_hash:
                computed_hashes[video.id] = video.content_hash
                continue
            try:
                data = fetch_video_bytes(video)
            except Exception as exc:
                skipped += 1
                print(f"  [SKIP] video {video.id} ({video.filename}): could not read file ({exc})")
                continue
            digest = hashlib.sha256(data).hexdigest()
            computed_hashes[video.id] = digest
            if not args.dry_run:
                video.content_hash = digest
            hashed += 1

        if not args.dry_run:
            db.session.commit()
        verb = "Would hash" if args.dry_run else "Hashed"
        print(f"{verb} {hashed} video(s) this run ({skipped} unreadable/skipped).")

        by_hash = {}
        for video in videos:
            content_hash = computed_hashes.get(video.id)
            if content_hash is None:
                continue
            by_hash.setdefault(content_hash, []).append(video)

        duplicate_groups = {h: vids for h, vids in by_hash.items() if len(vids) > 1}
        print(f"Found {len(duplicate_groups)} group(s) of duplicate content.")

        total_deducted = 0
        affected_users = set()
        for content_hash, vids in duplicate_groups.items():
            vids.sort(key=lambda v: v.created_at)
            original, duplicates = vids[0], vids[1:]
            print(
                f"  Hash {content_hash[:12]}...: keeping video {original.id} "
                f"(uploaded {original.created_at}), {len(duplicates)} duplicate(s): "
                f"{[v.id for v in duplicates]}"
            )
            for dup in duplicates:
                if dup.duplicate_penalty_applied:
                    print(f"    - video {dup.id}: already penalized, skipping")
                    continue
                user = dup.uploader
                before = user.total_score
                after = max(0, before - OLD_UPLOAD_BONUS)
                deducted = before - after
                total_deducted += deducted
                affected_users.add(user.username)
                if args.dry_run:
                    print(
                        f"    - video {dup.id}: user '{user.username}' total_score "
                        f"{before} -> {after} (-{deducted}) [DRY RUN, not applied]"
                    )
                else:
                    user.total_score = after
                    dup.duplicate_penalty_applied = True
                    print(
                        f"    - video {dup.id}: user '{user.username}' total_score "
                        f"{before} -> {after} (-{deducted})"
                    )

        if not args.dry_run:
            db.session.commit()

        prefix = "[DRY RUN] Would deduct" if args.dry_run else "Done. Deducted"
        print(
            f"\n{prefix} {total_deducted} point(s) total across "
            f"{len(affected_users)} account(s): {sorted(affected_users)}"
        )


if __name__ == "__main__":
    main()
