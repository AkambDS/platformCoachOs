from rest_framework_simplejwt.authentication import JWTAuthentication


class CookieJWTAuthentication(JWTAuthentication):
    """Reads JWT from httpOnly access_token cookie; falls back to Authorization header."""

    def authenticate(self, request):
        raw_token = request.COOKIES.get("access_token")
        if raw_token:
            try:
                validated = self.get_validated_token(raw_token)
                return self.get_user(validated), validated
            except Exception:
                pass
        return super().authenticate(request)
