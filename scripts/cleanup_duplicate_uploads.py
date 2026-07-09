"""One-off maintenance script: retroactively hash existing video files and
revoke the old +600 upload bonus from duplicate uploads (same content
uploaded more than once) beyond the first, now that the app prevents
duplicate content going forward.

Safe to run more than once -- already-penalized duplicates are skipped
via Video.duplicate_penalty_applied.

Usage against production (from the video-app directory):
    railway run python scripts/cleanup_duplicate_uploads.py
Usage locally:
    ./.venv/Scripts/python.exe scripts/cleanup_duplicate_uploads.py
"""
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
    with app.app_context():
        videos = Video.query.order_by(Video.created_at.asc()).all()
        print(f"Found {len(videos)} videos total.")

        hashed = 0
        skipped = 0
        for video in videos:
            if video.content_hash:
                continue
            try:
                data = fetch_video_bytes(video)
            except Exception as exc:
                skipped += 1
                print(f"  [SKIP] video {video.id} ({video.filename}): could not read file ({exc})")
                continue
            video.content_hash = hashlib.sha256(data).hexdigest()
            hashed += 1
        db.session.commit()
        print(f"Hashed {hashed} video(s) this run ({skipped} unreadable/skipped).")

        by_hash = {}
        for video in Video.query.filter(Video.content_hash.isnot(None)).order_by(Video.created_at.asc()).all():
            by_hash.setdefault(video.content_hash, []).append(video)

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
                user.total_score = max(0, user.total_score - OLD_UPLOAD_BONUS)
                dup.duplicate_penalty_applied = True
                deducted = before - user.total_score
                total_deducted += deducted
                affected_users.add(user.username)
                print(
                    f"    - video {dup.id}: user '{user.username}' total_score "
                    f"{before} -> {user.total_score} (-{deducted})"
                )

        db.session.commit()
        print(
            f"\nDone. Deducted {total_deducted} point(s) total across "
            f"{len(affected_users)} account(s): {sorted(affected_users)}"
        )


if __name__ == "__main__":
    main()
