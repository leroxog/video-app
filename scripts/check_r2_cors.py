"""Check (and optionally fix) the CORS configuration on the R2 bucket.

iOS/iPadOS Safari is much stricter than other browsers about CORS for
range-requested media (which it uses heavily for <video> playback/
seeking). If the bucket has no CORS rules at all, Safari can silently
fail to play videos that work fine everywhere else, while desktop/
Android browsers are more forgiving.

Usage:
    railway run --service web ./.venv/Scripts/python.exe scripts/check_r2_cors.py
    railway run --service web ./.venv/Scripts/python.exe scripts/check_r2_cors.py --fix
"""
import argparse
import os
import sys

import boto3
from botocore.exceptions import ClientError

PERMISSIVE_CORS = {
    "CORSRules": [
        {
            "AllowedOrigins": ["*"],
            "AllowedMethods": ["GET", "HEAD"],
            "AllowedHeaders": ["*"],
            "ExposeHeaders": ["Content-Length", "Content-Range", "Content-Type", "Accept-Ranges"],
            "MaxAgeSeconds": 3600,
        }
    ]
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fix", action="store_true", help="Apply a permissive GET/HEAD CORS policy.")
    args = parser.parse_args()

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

    print(f"Bucket: {bucket}")
    try:
        current = client.get_bucket_cors(Bucket=bucket)
        print("Current CORS rules:")
        for rule in current.get("CORSRules", []):
            print(f"  {rule}")
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code == "NoSuchCORSConfiguration":
            print("No CORS configuration set on this bucket at all.")
        else:
            print(f"Could not read CORS config: {exc}")

    if args.fix:
        client.put_bucket_cors(Bucket=bucket, CORSConfiguration=PERMISSIVE_CORS)
        print("\nApplied permissive GET/HEAD CORS policy:")
        print(PERMISSIVE_CORS)


if __name__ == "__main__":
    main()
