"""
CoachOS — HTML email builder.
Professional transactional email templates.
"""


# ── Shell ───────────────────────────────────────────────────────────────────────

def _email_shell(workspace_name: str, logo_url: str, body_html: str,
                 owner_email: str = "", owner_name: str = "") -> str:
    if logo_url:
        brand = (
            f'<img src="{logo_url}" alt="{workspace_name}" '
            f'style="max-height:48px;max-width:180px;object-fit:contain;display:block;" />'
        )
    else:
        brand = (
            f'<span style="font-family:Georgia,\'Times New Roman\',serif;'
            f'font-size:22px;font-weight:400;letter-spacing:.05em;color:#f5f0e8;">'
            f'{workspace_name}</span>'
        )

    if owner_email:
        contact_line = (
            f'Questions? Contact us at '
            f'<a href="mailto:{owner_email}" '
            f'style="color:#c9a84c;text-decoration:none;font-weight:600;">'
            f'{owner_name or owner_email}</a>'
            f' &mdash; <a href="mailto:{owner_email}" '
            f'style="color:#b5afa6;text-decoration:none;font-size:11px;">'
            f'{owner_email}</a>'
        )
    else:
        contact_line = (
            f'Sent by <strong style="color:#9e9890;">{workspace_name}</strong> via CoachOS'
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>{workspace_name}</title>
</head>
<body style="margin:0;padding:0;background:#eeebe5;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
       style="background:#eeebe5;padding:36px 16px 48px;">
  <tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:600px;">

    <!-- ── Header ── -->
    <tr>
      <td style="background:#1a2f4e;padding:24px 40px;border-radius:8px 8px 0 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>{brand}</td>
            <td align="right">
              <span style="font-family:Georgia,'Times New Roman',serif;
                           font-size:10px;letter-spacing:.18em;text-transform:uppercase;
                           color:#a09888;">Coaching Platform</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── Gold accent bar ── -->
    <tr>
      <td style="height:3px;background:linear-gradient(90deg,#b8922e 0%,#d9b96a 50%,#b8922e 100%);"></td>
    </tr>

    <!-- ── Body ── -->
    <tr>
      <td style="background:#ffffff;padding:44px 40px 40px;border-radius:0 0 8px 8px;
                 font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
        {body_html}
      </td>
    </tr>

    <!-- ── Footer ── -->
    <tr>
      <td style="padding:28px 0 0;text-align:center;">
        <p style="margin:0 0 8px;font-size:13px;color:#9e9890;
                  font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;line-height:1.7;">
          {contact_line}
        </p>
        <p style="margin:0 0 6px;font-size:11px;color:#b5afa6;
                  font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          This is an automated notification &mdash; please do not reply directly to this email.
        </p>
        <p style="margin:0;font-size:10px;color:#c8c2ba;
                  font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                  letter-spacing:.06em;text-transform:uppercase;">
          Powered by CoachOS
        </p>
      </td>
    </tr>

  </table>
  </td></tr>
</table>
</body>
</html>"""


# ── Helpers ─────────────────────────────────────────────────────────────────────

def _detail_row(label: str, value: str) -> str:
    return (
        f'<tr>'
        f'<td style="padding:12px 20px 12px 0;font-size:11px;color:#9e9890;'
        f'font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;'
        f'text-transform:uppercase;letter-spacing:.09em;width:90px;vertical-align:top;'
        f'white-space:nowrap;">{label}</td>'
        f'<td style="padding:12px 0;font-size:15px;color:#1a1714;font-weight:500;'
        f'font-family:Georgia,\'Times New Roman\',serif;">{value}</td>'
        f'</tr>'
    )


def _divider() -> str:
    return '<tr><td colspan="2" style="padding:0;border-bottom:1px solid #ede9e1;"></td></tr>'


def _cta_button(label: str, url: str, colour: str = "#16130f") -> str:
    return f"""
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr>
        <td style="background:{colour};border-radius:4px;mso-padding-alt:14px 32px;">
          <a href="{url}"
             style="display:inline-block;padding:14px 40px;
                    font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                    font-size:13px;font-weight:700;color:#f5f0e8;
                    text-decoration:none;letter-spacing:.1em;text-transform:uppercase;">
            {label}
          </a>
        </td>
      </tr>
    </table>"""


def _calendar_block(google_cal_url: str = "") -> str:
    """Prominent 'Add to Calendar' section for the confirmation email."""
    gcal_button = ""
    if google_cal_url:
        gcal_button = f"""
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:16px;">
                  <tr>
                    <td style="border-radius:4px;background:#4285F4;">
                      <a href="{google_cal_url}"
                         style="display:inline-block;padding:9px 18px;
                                font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                                font-size:13px;font-weight:600;color:#ffffff;
                                text-decoration:none;letter-spacing:.02em;">
                        + Add to Google Calendar
                      </a>
                    </td>
                  </tr>
                </table>"""

    return f"""
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin-top:32px;border:2px solid #b8922e;border-radius:8px;
                  background:#fffdf7;">
      <tr>
        <td style="padding:0;border-radius:8px;overflow:hidden;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#b8922e;padding:10px 24px;">
                <span style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                             font-size:11px;font-weight:700;color:#fff;
                             text-transform:uppercase;letter-spacing:.1em;">
                  &#128197;&nbsp; Add This Session to Your Calendar
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px 22px;">
                <p style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;
                          font-size:15px;color:#1a1714;line-height:1.5;">
                  A <strong>calendar invite (.ics file)</strong> is attached to this email.
                </p>
                <p style="margin:0 0 14px;font-size:13px;color:#6e6560;line-height:1.7;
                          font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                  Open the attachment to save to Apple Calendar or Outlook. For Google Calendar, use the button below:
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                  <tr>
                    <td style="padding:4px 0;font-size:13px;color:#6e6560;
                               font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                      &#9989;&nbsp; <strong style="color:#1a1714;">Apple Calendar</strong>
                    </td>
                    <td style="padding:4px 0;font-size:13px;color:#6e6560;
                               font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
                      &#9989;&nbsp; <strong style="color:#1a1714;">Outlook</strong>
                    </td>
                  </tr>
                </table>
                {gcal_button}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>"""


# ── Confirmation email ───────────────────────────────────────────────────────────

def build_confirmation_email(activity, workspace_name: str, logo_url: str,
                              coach_name: str, coach_email: str, dt_human: str,
                              owner_email: str = "", owner_name: str = "",
                              google_cal_url: str = "",
                              custom_intro: str = "", custom_closing: str = "") -> str:
    location_row = ""
    if activity.location:
        location_row = _divider() + _detail_row("Location", activity.location)

    notes_block = ""
    if activity.notes:
        notes_block = f"""
        <div style="margin-top:24px;padding:16px 20px;
                    background:#faf8f4;border-left:3px solid #b8922e;border-radius:0 4px 4px 0;">
          <p style="margin:0;font-size:13px;color:#6e6560;line-height:1.7;">{activity.notes}</p>
        </div>"""

    coach_display = (
        f'<a href="mailto:{coach_email}" style="color:#b8922e;text-decoration:none;">'
        f'{coach_name}</a>'
        if coach_email else coach_name
    )

    _default_intro   = (f"Hi {activity.client.first_name}, your session with "
                        f"{coach_name} has been scheduled. We look forward to seeing you.")
    _default_closing = (f"Need to reschedule or have questions? Contact {coach_name} directly.")
    intro_html   = custom_intro   or _default_intro
    closing_html = custom_closing or _default_closing

    body = f"""
    <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#b8922e;
              font-weight:600;">
      Session Confirmed
    </p>
    <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;
               font-size:32px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      Your session is confirmed
    </h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {intro_html}
    </p>

    <!-- Details table -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-top:2px solid #1a2f4e;border-bottom:1px solid #ede9e1;">
      {_detail_row("What", activity.title)}
      {_divider()}
      {_detail_row("When", f'<strong style="color:#b8922e;">{dt_human}</strong>')}
      {location_row}
      {_divider()}
      {_detail_row("Coach", coach_display)}
    </table>

    {notes_block}
    {_calendar_block(google_cal_url)}

    <p style="margin:28px 0 0;font-size:13px;color:#9e9890;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {closing_html}
    </p>
    <p style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name)


# ── Reschedule / update email ────────────────────────────────────────────────────

def build_reschedule_email(activity, workspace_name: str, logo_url: str,
                            coach_name: str, coach_email: str, dt_human: str,
                            owner_email: str = "", owner_name: str = "",
                            google_cal_url: str = "") -> str:
    location_row = ""
    if activity.location:
        location_row = _divider() + _detail_row("Location", activity.location)

    coach_display = (
        f'<a href="mailto:{coach_email}" style="color:#b8922e;text-decoration:none;">'
        f'{coach_name}</a>'
        if coach_email else coach_name
    )

    body = f"""
    <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#b8922e;
              font-weight:600;">
      Session Updated
    </p>
    <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;
               font-size:32px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      Your session has been updated
    </h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      Hi {activity.client.first_name}, your session with
      <strong style="color:#1a1714;">{coach_name}</strong> has been updated.
      Here are your new session details.
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-top:2px solid #1a2f4e;border-bottom:1px solid #ede9e1;">
      {_detail_row("What", activity.title)}
      {_divider()}
      {_detail_row("When", f'<strong style="color:#b8922e;">{dt_human}</strong>')}
      {location_row}
      {_divider()}
      {_detail_row("Coach", coach_display)}
    </table>

    {_calendar_block(google_cal_url)}

    <p style="margin:28px 0 0;font-size:13px;color:#9e9890;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      Need to reschedule or have questions? Contact
      <a href="mailto:{coach_email or owner_email}" style="color:#b8922e;text-decoration:none;font-weight:600;">
        {coach_name}
      </a> directly.
    </p>
    <p style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name)


# ── Team invite email ────────────────────────────────────────────────────────────

def build_invite_email(invited_by_name: str, workspace_name: str, role_display: str,
                       accept_url: str, logo_url: str, invited_email: str = "",
                       owner_email: str = "") -> str:
    role_color = {
        "Business Owner": "#b8922e",
        "Coach":          "#2d6a9f",
        "Assistant":      "#4a7c59",
    }.get(role_display, "#6e6560")

    body = f"""
    <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#b8922e;
              font-weight:600;">
      Team Invitation
    </p>
    <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;
               font-size:32px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      You've been invited
    </h1>
    <p style="margin:0 0 28px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      <strong style="color:#1a1714;">{invited_by_name}</strong> has invited you to join
      <strong style="color:#1a1714;">{workspace_name}</strong> on CoachOS as a team member.
    </p>

    <!-- Role badge -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
      <tr>
        <td style="padding:7px 20px;border-radius:20px;
                   background:{role_color}18;border:1px solid {role_color}50;">
          <span style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                       font-size:12px;font-weight:700;color:{role_color};
                       text-transform:uppercase;letter-spacing:.1em;">
            {role_display}
          </span>
        </td>
      </tr>
    </table>

    <!-- CTA -->
    {_cta_button("Accept Invitation &amp; Set Password", accept_url, "#16130f")}

    <p style="margin:20px 0 6px;font-size:12px;color:#b5afa6;text-align:center;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      Or copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 32px;font-size:11px;word-break:break-all;text-align:center;">
      <a href="{accept_url}" style="color:#b8922e;text-decoration:none;">{accept_url}</a>
    </p>

    <!-- Info box -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="border:1px solid #e4dfd6;border-radius:6px;background:#faf8f4;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;
                    font-size:14px;color:#6e6560;font-weight:400;">Important details</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:5px 0;font-size:13px;color:#9e9890;
                         font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;line-height:1.6;">
                &#9201;&nbsp; Invitation expires in <strong style="color:#6e6560;">48 hours</strong>
              </td>
            </tr>
            <tr>
              <td style="padding:5px 0;font-size:13px;color:#9e9890;
                         font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;line-height:1.6;">
                &#128274;&nbsp; You will set your own password on the next screen
              </td>
            </tr>
            {'<tr><td style="padding:5px 0;font-size:13px;color:#9e9890;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;line-height:1.6;">&#128231;&nbsp; Your login email: <strong style="color:#6e6560;">' + invited_email + '</strong></td></tr>' if invited_email else ''}
          </table>
        </td>
      </tr>
    </table>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, invited_by_name)


# ── Reminder email ───────────────────────────────────────────────────────────────

def build_reminder_email(activity, workspace_name: str, logo_url: str,
                         coach_name: str, coach_email: str, dt_human: str,
                         time_label: str, owner_email: str = "",
                         owner_name: str = "",
                         custom_intro: str = "", custom_closing: str = "") -> str:
    location_row = ""
    if activity.location:
        location_row = _divider() + _detail_row("Location", activity.location)

    is_soon = "1 hour" in time_label or ("hour" in time_label.lower() and "24" not in time_label)
    accent_color = "#c0392b" if is_soon else "#b8922e"
    label_text = f"Upcoming in {time_label}" if is_soon else f"Reminder \u00b7 {time_label} away"

    coach_display = (
        f'<a href="mailto:{coach_email}" style="color:#b8922e;text-decoration:none;">'
        f'{coach_name}</a>'
        if coach_email else coach_name
    )

    _default_intro   = (f"Hi {activity.client.first_name}, this is a friendly reminder "
                        f"about your upcoming session with {coach_name}.")
    _default_closing = f"Need to reschedule? Please contact {coach_name} as soon as possible."
    intro_html   = custom_intro   or _default_intro
    closing_html = custom_closing or _default_closing

    body = f"""
    <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;
              color:{accent_color};font-weight:600;">
      {label_text}
    </p>
    <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;
               font-size:32px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      Session reminder
    </h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {intro_html}
    </p>

    <!-- Details table -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-top:2px solid #1a2f4e;border-bottom:1px solid #ede9e1;">
      {_detail_row("What", activity.title)}
      {_divider()}
      {_detail_row("When", f'<strong style="color:{accent_color};">{dt_human}</strong>')}
      {location_row}
      {_divider()}
      {_detail_row("Coach", coach_display)}
    </table>

    <p style="margin:28px 0 0;font-size:13px;color:#9e9890;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {closing_html}
    </p>
    <p style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name)


# ── Cancellation email ───────────────────────────────────────────────────────────

def build_cancellation_email(activity, workspace_name: str, logo_url: str,
                              coach_name: str, coach_email: str, dt_human: str,
                              owner_email: str = "", owner_name: str = "") -> str:
    location_row = ""
    if activity.location:
        location_row = _divider() + _detail_row("Location", activity.location)

    coach_display = (
        f'<a href="mailto:{coach_email}" style="color:#b8922e;text-decoration:none;">'
        f'{coach_name}</a>'
        if coach_email else coach_name
    )

    body = f"""
    <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#c0392b;
              font-weight:600;">
      Session Cancelled
    </p>
    <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;
               font-size:32px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      Your session has been cancelled
    </h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      Hi {activity.client.first_name}, we're writing to let you know that the following session
      has been cancelled. A calendar update has been attached to this email.
    </p>

    <!-- Details table -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-top:2px solid #c0392b;border-bottom:1px solid #ede9e1;">
      {_detail_row("What", f'<span style="text-decoration:line-through;color:#9e9890;">{activity.title}</span>')}
      {_divider()}
      {_detail_row("Was", dt_human)}
      {location_row}
      {_divider()}
      {_detail_row("Coach", coach_display)}
    </table>

    <!-- Reschedule note -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin-top:28px;border:1px solid #e4dfd6;border-radius:6px;background:#faf8f4;">
      <tr>
        <td style="padding:18px 24px;">
          <p style="margin:0;font-size:13px;color:#6e6560;line-height:1.7;
                    font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
            To reschedule or book a new session, please contact
            <a href="mailto:{coach_email or owner_email}"
               style="color:#b8922e;text-decoration:none;font-weight:600;">{coach_name}</a> directly.
          </p>
        </td>
      </tr>
    </table>

    <p style="margin:24px 0 0;font-family:Georgia,'Times New Roman',serif;
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name)


# ── Invoice email ────────────────────────────────────────────────────────────────

def build_invoice_email(invoice, workspace_name: str, logo_url: str,
                        due_str: str, owner_email: str = "", owner_name: str = "",
                        custom_intro: str = "", custom_closing: str = "") -> str:
    amount = f"{invoice.currency} {invoice.total:,.2f}"

    pay_button = ""
    if invoice.stripe_payment_link:
        pay_button = f"""
        <div style="margin-top:28px;text-align:center;">
          {_cta_button("Pay Invoice Online", invoice.stripe_payment_link, "#b8922e")}
        </div>"""

    due_row = ""
    if due_str:
        due_row = _divider() + _detail_row("Due Date", f'<strong style="color:#c0392b;">{due_str}</strong>')

    _default_intro   = f"Hi {invoice.client.first_name}, please find your invoice from {workspace_name} below."
    _default_closing = (f"Have questions about this invoice? Contact us at {owner_name or owner_email}."
                        if owner_email else "")
    intro_html   = custom_intro   or _default_intro
    closing_html = custom_closing or _default_closing

    body = f"""
    <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#b8922e;
              font-weight:600;">
      Invoice
    </p>
    <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;
               font-size:32px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      Invoice #{invoice.number}
    </h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {intro_html}
    </p>

    <!-- Invoice details -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-top:2px solid #1a2f4e;border-bottom:1px solid #ede9e1;">
      {_detail_row("Invoice #", invoice.number)}
      {_divider()}
      {_detail_row("Amount", f'<strong style="color:#1a1714;font-size:18px;">{amount}</strong>')}
      {due_row}
    </table>

    {pay_button}

    {f'<p style="margin:28px 0 0;font-size:13px;color:#9e9890;line-height:1.7;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;">{closing_html}</p>' if closing_html else ''}

    <p style="margin:{'12px' if closing_html else '28px'} 0 0;font-family:Georgia,'Times New Roman',serif;
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name)


# ── Pipeline follow-up alert email ───────────────────────────────────────────────

def build_pipeline_alert_email(
    workspace_name: str,
    logo_url: str,
    owner_name: str,
    owner_email: str,
    client_name: str,
    stage_label: str,
    stage_color: str,
    days_in_stage: int,
    follow_up_days: int,
    deal_value: str,
    stage_entered: str,
    pipeline_url: str = "",
) -> str:
    overdue_days = days_in_stage - follow_up_days

    cta = ""
    if pipeline_url:
        cta = f"""
    <div style="margin:32px 0;text-align:center;">
      {_cta_button("View Pipeline", pipeline_url, "#1a2f4e")}
    </div>"""

    body = f"""
    <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;
              color:#c0392b;font-weight:600;">
      Follow-up required &middot; {overdue_days} day{'s' if overdue_days != 1 else ''} overdue
    </p>
    <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;
               font-size:30px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      {client_name} needs attention
    </h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      Hi {owner_name}, this deal has been sitting in
      <strong style="color:#1a1714;">{stage_label}</strong> for
      <strong style="color:#c0392b;">{days_in_stage} days</strong>
      &mdash; {overdue_days} day{'s' if overdue_days != 1 else ''} past your follow-up threshold.
    </p>

    <!-- Stage badge -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>
        <td style="background:{stage_color};border-radius:20px;padding:6px 16px;">
          <span style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                       font-size:12px;font-weight:700;color:#fff;
                       letter-spacing:.08em;text-transform:uppercase;">
            {stage_label}
          </span>
        </td>
      </tr>
    </table>

    <!-- Deal details -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-top:2px solid #1a2f4e;border-bottom:1px solid #ede9e1;">
      {_detail_row("Client", f'<strong style="color:#1a1714;">{client_name}</strong>')}
      {_divider()}
      {_detail_row("Stage", stage_label)}
      {_divider()}
      {_detail_row("Days in stage",
        f'<strong style="color:#c0392b;">{days_in_stage} days</strong>'
        f'&nbsp;<span style="font-size:12px;color:#9e9890;">(threshold: {follow_up_days} days)</span>'
      )}
      {_divider()}
      {_detail_row("Deal value",
        f'<span style="font-family:Georgia,\'Times New Roman\',serif;font-size:18px;">{deal_value}</span>'
      )}
      {_divider()}
      {_detail_row("Stage entered", stage_entered)}
    </table>

    {cta}

    <p style="margin:{'0' if cta else '28px'} 0 0;font-size:13px;color:#9e9890;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      Once the deal moves to a new stage, this alert resets automatically.
    </p>
    <p style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name)
