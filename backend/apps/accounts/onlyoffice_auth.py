"""Security for the OnlyOffice Document Server endpoints (PHASE2.md DB-6).

The file and callback endpoints are called by the Document Server, not by a logged-in
user, so they are AllowAny and must authenticate the request themselves:

* Every file/callback URL we hand out carries a `?doc=` token, signed with
  ONLYOFFICE_JWT_SECRET, that names exactly ONE document and one purpose (file vs callback)
  and expires (file tokens after 2 hours, callback tokens after 30 days). A token for document A can't open or overwrite document B — in this or
  any other workspace — and a file token can't be used as a callback token.
* The save callback trusts only what the Document Server signed (its JWT body), never the
  plain request body, and only downloads the saved file from our own OnlyOffice server.
* Fail closed: without ONLYOFFICE_JWT_SECRET these endpoints refuse everything, except in
  DEBUG (local development without the editor's JWT set up).
"""
import logging
from datetime import timedelta

import jwt
from django.conf import settings
from django.utils import timezone

# File tokens end up in browsers (editor/portal configs) and the Document Server fetches
# the file right when the editor opens — keep them short so revoked access stops quickly.
# Callback tokens must outlive the longest editing session (the final save arrives when
# the editor closes) and are useless without a Document-Server-signed body anyway.
DOC_TOKEN_TTL = {"file": timedelta(hours=2), "callback": timedelta(days=30)}

logger = logging.getLogger(__name__)


def _secret():
    return settings.ONLYOFFICE_JWT_SECRET


def sign_doc_url(url, kind, obj_id):
    """Append a `doc` token binding this URL to one document and purpose (`kind`)."""
    if not _secret():
        return url
    ttl = DOC_TOKEN_TTL["callback"] if kind.endswith("callback") else DOC_TOKEN_TTL["file"]
    token = jwt.encode(
        {"oo": kind, "id": str(obj_id), "exp": timezone.now() + ttl},
        _secret(), algorithm="HS256",
    )
    return f"{url}{'&' if '?' in url else '?'}doc={token}"


def doc_token_ok(request, kind, obj_id):
    """True if the request carries a valid `doc` token for exactly this document/purpose."""
    if not _secret():
        return bool(settings.DEBUG)
    try:
        claims = jwt.decode(request.query_params.get("doc", ""), _secret(), algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return False
    return claims.get("oo") == kind and claims.get("id") == str(obj_id)


def signed_callback_body(request):
    """The callback body as signed by the Document Server, or None if unsigned/invalid.
    The token comes in the body (`token`) or the Authorization header; the header form
    wraps the body in a `payload` key."""
    if not _secret():
        if not settings.DEBUG:
            return None
        data = request.data
        return data.dict() if hasattr(data, "dict") else dict(data)   # QueryDict → plain values
    token = request.data.get("token") or request.headers.get("Authorization", "").removeprefix("Bearer ")
    try:
        claims = jwt.decode(token, _secret(), algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
    return claims.get("payload", claims)


def internal_download_url(url):
    """Map the saved-file URL from a callback to our internal OnlyOffice address — or None
    if it doesn't point at our own OnlyOffice server (never fetch arbitrary URLs)."""
    public, internal = settings.ONLYOFFICE_SERVER_URL.rstrip("/"), settings.ONLYOFFICE_INTERNAL_URL.rstrip("/")
    if url and url.startswith(public + "/"):
        return internal + url[len(public):]
    if url and url.startswith(internal + "/"):
        return url
    if url:
        logger.warning("OnlyOffice save refused: %s is not on ONLYOFFICE_SERVER_URL/INTERNAL_URL", url[:200])
    return None
