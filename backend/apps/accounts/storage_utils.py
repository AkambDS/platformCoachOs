"""
CoachOS — shared S3/MinIO presigned-URL helper.

In local dev, MinIO is reached at two different addresses depending on who's asking:
  - AWS_S3_ENDPOINT_URL ("http://minio:9000") — the Docker-internal hostname Django
    itself uses to reach MinIO over the compose network.
  - MINIO_PUBLIC_URL ("http://localhost:9000") — the host-mapped port the *browser*
    has to use instead, since it isn't on the Docker network and can't resolve "minio"
    as a hostname at all.

The previous approach in every caller of this (apps.clients / apps.library
serializers) generated the presigned URL against the internal endpoint, then did a
plain string replace of the hostname before returning it to the frontend. That looks
right but is actually broken under SigV4 (config.settings.base forces
AWS_S3_SIGNATURE_VERSION = "s3v4" — see that file's comment for why): a SigV4 signature
covers the request's Host header (`X-Amz-SignedHeaders=host` in the generated query
string), so a URL correctly signed for Host "minio:9000" is cryptographically invalid
the moment it's actually requested with Host "localhost:9000" instead — MinIO rejects
it with SignatureDoesNotMatch. Swapping the hostname text after signing doesn't fix
the mismatch, it causes it. (Verified directly: a correctly-signed path-style URL for
the real object returns 200; doing the same after-the-fact hostname swap on that exact
URL reproduces SignatureDoesNotMatch byte-for-byte.)

The correct fix is to sign the URL for whichever host will actually be used to fetch
it in the first place. When a public/internal split is configured, this builds a
one-off boto3 client pointed at MINIO_PUBLIC_URL and signs against that directly — no
post-hoc string surgery needed. In production, MINIO_PUBLIC_URL is "" and
AWS_S3_ENDPOINT_URL is None (both hardcoded in config.settings.production, not read
from env — see that file), so this branch can never trigger there and the normal
default_storage-backed client is used exactly as before.
"""
from django.conf import settings
from django.core.files.storage import default_storage


def generate_presigned_url(s3_key: str, disposition: str = "", expires_in: int = 3600):
    """Returns a presigned GET URL for s3_key, or None if it can't be generated.

    disposition: an optional full Content-Disposition header value (e.g.
    'attachment; filename="foo.pdf"') so the browser downloads/previews with the
    right filename instead of the raw S3 key.
    """
    if not s3_key:
        return None
    try:
        if not hasattr(default_storage, "bucket"):
            # Not S3-backed (e.g. local FileSystemStorage) — nothing to sign.
            return default_storage.url(s3_key)

        params = {"Bucket": default_storage.bucket_name, "Key": s3_key}
        if disposition:
            params["ResponseContentDisposition"] = disposition

        public_url = getattr(settings, "MINIO_PUBLIC_URL", "") or ""
        endpoint   = getattr(settings, "AWS_S3_ENDPOINT_URL", "") or ""

        if public_url and endpoint and public_url != endpoint:
            import boto3
            from botocore.config import Config
            public_client = boto3.client(
                "s3",
                endpoint_url=public_url,
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                region_name=getattr(settings, "AWS_S3_REGION_NAME", "us-east-1"),
                config=Config(
                    signature_version=getattr(settings, "AWS_S3_SIGNATURE_VERSION", "s3v4"),
                    s3={"addressing_style": "path"},
                ),
            )
            return public_client.generate_presigned_url("get_object", Params=params, ExpiresIn=expires_in)

        return default_storage.bucket.meta.client.generate_presigned_url(
            "get_object", Params=params, ExpiresIn=expires_in,
        )
    except Exception:
        try:
            return default_storage.url(s3_key)
        except Exception:
            return None
