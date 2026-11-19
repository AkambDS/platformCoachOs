"""Settings → Integrations → Stripe (one-time-pay.md, P6).

A new secret key is checked with Stripe before it's saved, and the Stripe account it
belongs to is stored. Old behaviour: any string starting with sk_test_/sk_live_ was saved,
so a typo or revoked key was only discovered when a client tried to pay, and a switch to a
different Stripe account (or test → live) silently left a webhook secret that could no
longer verify anything — payments stopped being recorded with no warning.
"""
from unittest import mock

import pytest
import stripe

URL = "/api/settings/stripe/"


def _account(acct_id="acct_A", name="Arti Coaching"):
    return {"id": acct_id, "settings": {"dashboard": {"display_name": name}}, "business_profile": {}}


def _patch(api_client, **body):
    return api_client.patch(URL, body, format="json", SERVER_NAME="localhost")


def _cfg(workspace):
    workspace.refresh_from_db()
    return (workspace.integrations or {}).get("stripe", {})


@pytest.mark.django_db
def test_valid_key_is_checked_with_stripe_and_account_recorded(api_client, workspace):
    with mock.patch("stripe.Account.retrieve", return_value=_account()) as retrieve:
        res = _patch(api_client, secret_key="sk_test_good1234")
    assert res.status_code == 200
    assert retrieve.call_args.kwargs["api_key"] == "sk_test_good1234"
    assert res.data["account_id"] == "acct_A" and res.data["account_name"] == "Arti Coaching"
    assert res.data["mode"] == "test" and res.data["last4"] == "1234"
    assert _cfg(workspace)["account_id"] == "acct_A"


@pytest.mark.django_db
def test_key_stripe_rejects_is_not_saved(api_client, workspace):
    with mock.patch("stripe.Account.retrieve", return_value=_account()):
        _patch(api_client, secret_key="sk_test_good1234")
    with mock.patch("stripe.Account.retrieve",
                    side_effect=stripe.error.AuthenticationError("Invalid API Key provided")):
        res = _patch(api_client, secret_key="sk_test_typo9999")
    assert res.status_code == 400 and "didn't accept this key" in res.data["detail"]
    assert _cfg(workspace)["last4"] == "1234"          # the working key is kept


@pytest.mark.django_db
def test_stripe_unreachable_saves_nothing(api_client, workspace):
    with mock.patch("stripe.Account.retrieve", side_effect=stripe.error.APIConnectionError("timeout")):
        res = _patch(api_client, secret_key="sk_test_good1234")
    assert res.status_code == 502 and "try again" in res.data["detail"]
    assert not _cfg(workspace).get("secret_key_encrypted")


@pytest.mark.parametrize("second_key,second_account", [
    ("sk_test_other000", "acct_B"),     # a different Stripe account
    ("sk_live_live0000", "acct_A"),     # same account, test → live
], ids=["other-account", "test-to-live"])
@pytest.mark.django_db
def test_switching_account_or_mode_clears_the_old_webhook_secret(api_client, workspace, second_key, second_account):
    with mock.patch("stripe.Account.retrieve", return_value=_account("acct_A")):
        _patch(api_client, secret_key="sk_test_good1234", webhook_secret="whsec_old")
    assert _cfg(workspace).get("webhook_secret_encrypted")

    with mock.patch("stripe.Account.retrieve", return_value=_account(second_account)):
        res = _patch(api_client, secret_key=second_key)
    assert res.status_code == 200 and res.data["webhook_reset"] is True
    assert res.data["webhook_configured"] is False and res.data["account_id"] == second_account


@pytest.mark.django_db
def test_resaving_a_key_for_the_same_account_keeps_the_webhook_secret(api_client, workspace):
    with mock.patch("stripe.Account.retrieve", return_value=_account("acct_A")):
        _patch(api_client, secret_key="sk_test_good1234", webhook_secret="whsec_keep")
        res = _patch(api_client, secret_key="sk_test_rolled56")      # key rolled, same account
    assert res.data["webhook_reset"] is False and res.data["webhook_configured"] is True


@pytest.mark.django_db
def test_webhook_secret_must_look_like_one(api_client, workspace):
    res = _patch(api_client, webhook_secret="sk_test_pasted_the_wrong_thing")
    assert res.status_code == 400 and "whsec_" in res.data["detail"]
    assert _patch(api_client, webhook_secret="whsec_ok").status_code == 200


@pytest.mark.django_db
def test_older_connection_gets_its_account_filled_in_on_view(api_client, workspace):
    from apps.accounts.crypto import encrypt_secret
    workspace.integrations = {"stripe": {"secret_key_encrypted": encrypt_secret("sk_live_old0001"),
                                         "mode": "live", "last4": "0001"}}
    workspace.save(update_fields=["integrations"])
    with mock.patch("stripe.Account.retrieve", return_value=_account("acct_LMT", "LMT")):
        res = api_client.get(URL, SERVER_NAME="localhost")
    assert res.data["account_id"] == "acct_LMT" and _cfg(workspace)["account_id"] == "acct_LMT"
    # Stripe down: the page still loads
    workspace.integrations["stripe"].pop("account_id"); workspace.save(update_fields=["integrations"])
    with mock.patch("stripe.Account.retrieve", side_effect=stripe.error.APIConnectionError("down")):
        res = api_client.get(URL, SERVER_NAME="localhost")
    assert res.status_code == 200 and res.data["connected"] is True and res.data["account_id"] == ""


@pytest.mark.django_db
def test_only_the_owner_can_change_stripe_keys(workspace, coach):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken
    api, refresh = APIClient(), RefreshToken.for_user(coach)
    refresh["workspace_id"], refresh["role"] = str(coach.workspace_id), coach.role
    api.credentials(HTTP_AUTHORIZATION=f"Bearer {str(refresh.access_token)}")
    with mock.patch("stripe.Account.retrieve", return_value=_account()) as retrieve:
        res = api.patch(URL, {"secret_key": "sk_test_good1234"}, format="json", SERVER_NAME="localhost")
    assert res.status_code == 403 and not retrieve.called
