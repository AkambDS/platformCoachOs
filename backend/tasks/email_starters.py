"""CoachOS — starter content for every email except invoices and Client Communication.

This is both what an un-customized ("Built-in") email actually sends and what the editor
opens with (served to the frontend via apps.settings_app.views.email_use_cases), so the
preview, the editor and the sent email can never disagree.

The starter look is deliberately plain: the white header with the workspace logo, then
the message and closing as fully editable text — every detail (what / when / amounts…)
is written into the message itself rather than added as a fixed block. All optional
blocks start switched off (heading, details card, add-to-calendar box, sign-off, footer);
a coach can switch any back on in the editor. The one thing that stays on is the action
a recipient needs — Confirm/Reschedule/Cancel, Accept invitation, Open portal, … —
which the builders treat as mandatory.

Invoice and Client Communication have their own single-message editors and are not
covered here.
"""
import copy

STARTER_STYLE = {
    "show_header": True, "header_bg": "#ffffff", "accent_color": "", "header_tagline": "",
    "show_footer": False, "footer_text": "", "show_contact_line": True,
    "show_heading": False, "show_details": False, "show_calendar": False,
    "show_signature": False, "show_actions": True,
}

_THANKS = "Thanks,\n{workspace_name}"

_STARTER_TEXT = {
    # ── Session emails to the client ─────────────────────────────────────────
    "confirmation": (
        "Confirmed: {session_title} with {coach_name}",
        "Hi {client_first_name},\n\nYour session with {coach_name} is confirmed.\n\n"
        "What: {session_title}\nWhen: {session_time}\n\n"
        "A calendar invite is attached to this email. We look forward to seeing you.",
        "Need to change something? Use the buttons above or reply to this email.\n\n" + _THANKS,
    ),
    "reschedule": (
        "Updated: {session_title} with {coach_name}",
        "Hi {client_first_name},\n\nYour session with {coach_name} has been moved to a new time.\n\n"
        "What: {session_title}\nWhen: {session_time}\n\nAn updated calendar invite is attached.",
        "Need to change something? Use the buttons above or reply to this email.\n\n" + _THANKS,
    ),
    "reminder_24h": (
        "Reminder: {session_title} tomorrow",
        "Hi {client_first_name},\n\nA friendly reminder about your session with {coach_name}.\n\n"
        "What: {session_title}\nWhen: {session_time}",
        "Can't make it? Use the buttons above to let us know.\n\n" + _THANKS,
    ),
    "reminder_1h": (
        "Starting in 1 hour: {session_title}",
        "Hi {client_first_name},\n\nYour session with {coach_name} starts in 1 hour.\n\n"
        "What: {session_title}\nWhen: {session_time}",
        "Running late or can't make it? Use the buttons above to let {coach_name} know.\n\n" + _THANKS,
    ),
    "cancellation": (
        "Cancelled: {session_title} on {session_date}",
        "Hi {client_first_name},\n\nYour session with {coach_name} has been cancelled.\n\n"
        "What: {session_title}\nWas: {session_time}\n\n"
        "A calendar update is attached so it's removed from your calendar.",
        "To book a new time, just reply to this email.\n\n" + _THANKS,
    ),
    "reschedule_ack": (
        "Reschedule request received — {session_title}",
        "Hi {client_first_name},\n\nWe've received your request to reschedule and passed it on to {coach_name}.\n\n"
        "What: {session_title}\nCurrent time: {session_time}\nRequested time: {proposed_time}",
        "{coach_name} will confirm the new time with you. If you need to follow up, just reply to this email.\n\n" + _THANKS,
    ),
    "decline_reschedule": (
        "Re: rescheduling {session_title}",
        "Hi {client_first_name},\n\n{message}",
        "{coach_name}",
    ),
    # ── Other emails to the client ───────────────────────────────────────────
    "payment_receipt": (
        "Receipt: payment for invoice {invoice_number}",
        "Hi {client_first_name},\n\nThank you — we've received your payment.\n\n"
        "Invoice: {invoice_number}\nAmount paid: ${amount}\nPaid on: {payment_date}",
        "Questions about this payment? Just reply to this email.\n\n" + _THANKS,
    ),
    "portal_invite": (
        "Your client portal is ready — {workspace_name}",
        "Hi {client_first_name},\n\n{workspace_name} has set up your client portal, where you can see "
        "your sessions, goals, invoices and shared materials.\n\nSign in with this email address: {client_email}",
        "Questions? Reply to this email or contact {coach_name}.\n\n" + _THANKS,
    ),
    "goal_shared": (
        "New goal shared — {workspace_name}",
        "Hi {client_first_name},\n\n{coach_name} shared a new goal with you: {goal_title}\n\n"
        "You can see it any time in your client portal.",
        _THANKS,
    ),
    "note_shared": (
        "New note shared — {workspace_name}",
        "Hi {client_first_name},\n\n{coach_name} shared a note with you: {note_topic}\n\n"
        "You can read it in your client portal.",
        _THANKS,
    ),
    "pipeline_client": (
        "Checking in — {workspace_name}",
        "Hi {client_first_name},\n\nJust checking in to see if you have any questions, "
        "or would like to take the next step with {coach_name}.",
        "Simply reply to this email — we'd love to hear from you.\n\n" + _THANKS,
    ),
    # ── To new team members ──────────────────────────────────────────────────
    "team_invite": (
        "You're invited to join {workspace_name}",
        "Hi,\n\n{invited_by_name} has invited you to join {workspace_name} on CoachOS as a {role}.\n\n"
        "Use the button below to accept and set your password. The invitation expires in 48 hours.",
        _THANKS,
    ),
    # ── To the coach / owner ─────────────────────────────────────────────────
    "pipeline": (
        "Follow-up needed: {client_name} — {stage_label} ({days_in_stage} days)",
        "Hi {owner_name},\n\nThe deal with {client_name} has been in {stage_label} for {days_in_stage} days — "
        "past your follow-up threshold of {follow_up_days} days.\n\n"
        "Deal value: {deal_value}\nIn this stage since: {stage_entered}",
        "This alert resets automatically once the deal moves to a new stage.",
    ),
    "coach_session_booked": (
        "Session booked: {session_title} with {client_name}",
        "Hi {recipient_first_name},\n\nA session has been booked with {client_name}.\n\n"
        "What: {session_title}\nWhen: {session_time}\nClient: {client_name} ({client_email})\n\n"
        "The calendar invite is attached.",
        "",
    ),
    "coach_session_reminder": (
        "Reminder: {session_title} with {client_name} in {time_label}",
        "Hi {recipient_first_name},\n\nYou have a session with {client_name} in {time_label}.\n\n"
        "What: {session_title}\nWhen: {session_time}",
        "",
    ),
    "coach_session_updated": (
        "Session updated: {session_title} with {client_name}",
        "Hi {recipient_first_name},\n\nThe session with {client_name} has been moved and they've been notified.\n\n"
        "What: {session_title}\nNew time: {session_time}",
        "",
    ),
    "coach_session_cancelled": (
        "Session cancelled: {session_title} with {client_name}",
        "Hi {recipient_first_name},\n\nThe session with {client_name} has been cancelled and they've been notified.\n\n"
        "What: {session_title}\nWas: {session_time}",
        "",
    ),
    "client_confirmed_notice": (
        "{client_name} confirmed attendance",
        "Hi {recipient_first_name},\n\n{client_name} confirmed they'll attend.\n\n"
        "What: {session_title}\nWhen: {session_time}",
        "",
    ),
    "client_cancelled_notice": (
        "Session cancelled by {client_name}",
        "Hi {recipient_first_name},\n\n{client_name} cancelled their session.\n\n"
        "What: {session_title}\nWhen: {session_time}\n\nIt's marked as cancelled in CoachOS.",
        "",
    ),
    "client_rsvp_notice": (
        "{client_name} {rsvp_verb} the calendar invite",
        "Hi {recipient_first_name},\n\n{client_name} {rsvp_verb} the calendar invite.\n\n"
        "What: {session_title}\nWhen: {session_time}",
        "",
    ),
    "reschedule_request": (
        "Reschedule request from {client_name}",
        "Hi {recipient_first_name},\n\n{client_name} asked to reschedule.\n\n"
        "What: {session_title}\nCurrent time: {session_time}\nRequested time: {proposed_time}\n\n{message}",
        "Open the session in CoachOS to confirm or decline the new time. Nothing changes on your calendar until you do.",
    ),
    "payment_failed": (
        "Payment failed — Invoice #{invoice_number}",
        "Hi {recipient_first_name},\n\nA payment for invoice #{invoice_number} (${amount}) from {client_name} didn't go through.",
        "You may want to follow up with {client_first_name} or resend the invoice.",
    ),
    "contract_signed": (
        "Signed: {document_title} — {client_name}",
        "{client_name} signed \"{document_title}\" on {signed_at}.\n\nA copy has been saved to their Files.",
        "",
    ),
}

STARTERS = {
    key: {"subject": subject, "intro": intro, "closing": closing, "show_logo": True,
          "style": dict(STARTER_STYLE)}
    for key, (subject, intro, closing) in _STARTER_TEXT.items()
}


def starter_for(use_case: str) -> dict:
    """A fresh copy of the starter for this use case, or {} if it has none (invoice,
    client_communication)."""
    return copy.deepcopy(STARTERS.get(use_case, {}))
