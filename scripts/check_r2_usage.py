"""Read-only check of current Cloudflare R2 bucket usage against the
free tier's 10 GB storage limit. Reads R2 credentials from environment
variables (same ones app.py uses) -- never prints them.

Usage against production:
    railway run --service web ./.venv/Scripts/python.exe scripts/check_r2_usage.py
"""
import os
import sys

import boto3

FREE_TIER_BYTES = 10 * 1024 ** 3


def human_size(num_bytes):
    size = float(num_bytes)
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size < 1024:
            return f"{size:.2f} {unit}"
        size /= 1024
    return f"{size:.2f} PB"


def main():
    account_id = os.environ.get("R2_ACCOUNT_ID")
    access_key = os.environ.get("R2_ACCESS_KEY_ID")
    secret_key = os.environ.get("R2_SECRET_ACCESS_KEY")
    bucket = os.environ.get("R2_BUCKET_NAME")

    if not all([account_id, access_key, secret_key, bucket]):
        print("R2 env vars not set in this environment.")
        sys.exit(1)

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )

    total_bytes = 0
    total_objects = 0
    by_prefix = {}
    continuation_token = None
    while True:
        kwargs = {"Bucket": bucket}
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        resp = client.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []):
            total_bytes += obj["Size"]
            total_objects += 1
            prefix = obj["Key"].split("/")[0] if "/" in obj["Key"] else "(root)"
            by_prefix[prefix] = by_prefix.get(prefix, 0) + obj["Size"]
        if resp.get("IsTruncated"):
            continuation_token = resp.get("NextContinuationToken")
        else:
            break

    print(f"Bucket: {bucket}")
    print(f"Objects: {total_objects}")
    print(f"Total size: {human_size(total_bytes)} ({total_bytes} bytes)")
    print(f"Free tier limit: {human_size(FREE_TIER_BYTES)}")
    pct = (total_bytes / FREE_TIER_BYTES) * 100
    print(f"Used: {pct:.3f}% of free tier")
    print()
    print("By folder:")
    for prefix, size in sorted(by_prefix.items(), key=lambda x: -x[1]):
        print(f"  {prefix}: {human_size(size)}")


if __name__ == "__main__":
    main()
