from allauth.socialaccount.adapter import DefaultSocialAccountAdapter


class SocialAccountAdapter(DefaultSocialAccountAdapter):
    """
    allauth's default populate_user() assumes a first_name/last_name User model and
    setattr()s them directly. Our User model (apps.accounts.models.User) only has a
    single `full_name` field — `first_name` is a derived read-only @property — so that
    setattr crashes every Google Calendar connect attempt with:
        AttributeError: property 'first_name' of 'User' object has no setter
    Writes to `full_name` instead. Only exercised by the "connect" flow (see
    apps.accounts.views.google_calendar_connect) — sociallogin.user is discarded there
    in favor of the already-authenticated request.user, but allauth still calls this
    before it knows that, so it must not crash regardless.
    """
    def populate_user(self, request, sociallogin, data):
        user = sociallogin.user
        full_name = data.get("name") or " ".join(
            filter(None, [data.get("first_name"), data.get("last_name")])
        )
        if full_name:
            user.full_name = full_name
        email = data.get("email")
        if email:
            user.email = email
        return user
