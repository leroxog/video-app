"""Where the bytes of the files of Pulse live (photos, videos, chat files, GIFs).

By default they sit in the database, next to the rows that describe them.  When the four R2 variables are set (R2_ACCOUNT_ID,
R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME) new files go to Cloudflare R2 instead and the row only keeps a note
("stored" = "r2"): the database stays small, and R2 costs about a tenth of a database disk.  The bucket stays private; the page
hands the browser a short-lived signed address (see `url`) after the usual checks (a chat file only to the people of that chat).
Nothing here needs R2 to be set up: without the variables every function reports `enabled == False` and the site works as before."""
import logging
import os

logger = logging.getLogger(__name__)

PREFIX = "pulse"


class BlobStore:
    def __init__(self, environ=None):
        env = os.environ if environ is None else environ
        self.account = env.get("R2_ACCOUNT_ID") or ""
        self.key_id = env.get("R2_ACCESS_KEY_ID") or ""
        self.secret = env.get("R2_SECRET_ACCESS_KEY") or ""
        self.bucket = env.get("R2_BUCKET_NAME") or ""
        self._client = None

    def configure(self, account, key_id, secret, bucket, client=None):
        """Sets the access data by hand (the tests use this, with a fake client)."""
        self.account, self.key_id, self.secret, self.bucket, self._client = account, key_id, secret, bucket, client

    def disable(self):
        self.account = self.key_id = self.secret = self.bucket = ""
        self._client = None

    @property
    def enabled(self):
        return all((self.account, self.key_id, self.secret, self.bucket))

    @property
    def host(self):
        """The address files are fetched from (the page's content security policy has to allow it)."""
        return f"{self.account}.r2.cloudflarestorage.com" if self.account else ""

    @property
    def client(self):
        if self._client is None:
            import boto3
            from botocore.config import Config
            self._client = boto3.client(
                "s3", endpoint_url=f"https://{self.host}", aws_access_key_id=self.key_id, aws_secret_access_key=self.secret,
                region_name="auto", config=Config(signature_version="s3v4", retries={"max_attempts": 2, "mode": "standard"}, connect_timeout=5, read_timeout=60))
        return self._client

    @staticmethod
    def key(kind, ident):
        return f"{PREFIX}/{kind}/{ident}"

    def put(self, kind, ident, data, content_type):
        self.client.put_object(Bucket=self.bucket, Key=self.key(kind, ident), Body=data, ContentType=content_type or "application/octet-stream")

    def get(self, kind, ident):
        return self.client.get_object(Bucket=self.bucket, Key=self.key(kind, ident))["Body"].read()

    def size(self, kind, ident):
        """How many bytes the file has in R2, or None when it is not there."""
        try:
            return int(self.client.head_object(Bucket=self.bucket, Key=self.key(kind, ident))["ContentLength"])
        except Exception:  # noqa: BLE001  (not found, or R2 unreachable: either way the file cannot be counted on)
            return None

    def copy(self, kind, ident, new_kind, new_ident):
        self.client.copy_object(Bucket=self.bucket, Key=self.key(new_kind, new_ident), CopySource={"Bucket": self.bucket, "Key": self.key(kind, ident)})

    def url(self, kind, ident, content_type=None, disposition=None, expires=3600):
        """A signed address the browser can open for a while (the bucket itself is not public)."""
        params = {"Bucket": self.bucket, "Key": self.key(kind, ident)}
        if content_type:
            params["ResponseContentType"] = content_type
        if disposition:
            params["ResponseContentDisposition"] = disposition
        return self.client.generate_presigned_url("get_object", Params=params, ExpiresIn=expires)

    def delete_many(self, kind, idents):
        """Removes files (best effort: a file that cannot be removed now only costs a few cents, it must not break a deletion)."""
        idents = list(idents)
        for start in range(0, len(idents), 500):
            chunk = idents[start:start + 500]
            try:
                self.client.delete_objects(Bucket=self.bucket, Delete={"Objects": [{"Key": self.key(kind, ident)} for ident in chunk], "Quiet": True})
            except Exception:  # noqa: BLE001
                logger.exception("Could not remove %d file(s) from R2", len(chunk))


STORE = BlobStore()
