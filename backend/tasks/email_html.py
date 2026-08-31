"""
CoachOS — HTML email builder.
Professional transactional email templates.
"""


def is_light_color(hex_color: str) -> bool:
    """True if a header background is light enough that the header's own text/tagline
    (styled light-on-dark by default, e.g. cream #f5f0e8) would be illegible on it —
    lets a coach pick a white/light header (previously only usable with a dark one)
    without the brand name or tagline disappearing into it."""
    hex_color = (hex_color or "").lstrip("#")
    if len(hex_color) != 6:
        return False
    try:
        r, g, b = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return False
    # Perceived luminance (ITU-R BT.601) — > 0.6 reads as "light" to the eye.
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6


# ── Shell ───────────────────────────────────────────────────────────────────────

def _email_shell(workspace_name: str, logo_url: str, body_html: str,
                 owner_email: str = "", owner_name: str = "",
                 header_bg: str = "#1a2f4e",
                 accent_color: str = "#b8922e",
                 header_tagline: str = "",
                 body_font: str = "'Helvetica Neue',Helvetica,Arial,sans-serif",
                 show_header: bool = True,
                 show_footer: bool = True,
                 footer_text: str = "",
                 show_contact_line: bool = True) -> str:
    header_is_light  = is_light_color(header_bg)
    brand_text_color = "#1a2f4e" if header_is_light else "#f5f0e8"
    # A white logo card needs a visible edge against a white/light header — on a dark
    # header the two never touch in a way that needs one.
    logo_card_border = "border:1px solid #e5e0d8;" if header_is_light else ""

    if logo_url:
        brand = (
            f'<table role="presentation" cellpadding="0" cellspacing="0">'
            f'<tr><td style="background:#ffffff;padding:8px 14px;border-radius:5px;{logo_card_border}">'
            f'<img src="{logo_url}" alt="{workspace_name}" '
            f'style="max-height:40px;max-width:160px;object-fit:contain;display:block;" />'
            f'</td></tr></table>'
        )
    else:
        brand = (
            f'<span style="font-family:Georgia,\'Times New Roman\',serif;'
            f'font-size:22px;font-weight:400;letter-spacing:.05em;color:{brand_text_color};">'
            f'{workspace_name}</span>'
        )

    if owner_email:
        contact_line = (
            f'Questions? Contact us at '
            f'<a href="mailto:{owner_email}" '
            f'style="color:{accent_color};text-decoration:none;font-weight:600;">'
            f'{owner_name or owner_email}</a>'
            f' &mdash; <a href="mailto:{owner_email}" '
            f'style="color:#b5afa6;text-decoration:none;font-size:11px;">'
            f'{owner_email}</a>'
        )
    else:
        contact_line = (
            f'Sent by <strong style="color:#9e9890;">{workspace_name}</strong>'
        )

    tagline_color = "#8c8279" if header_is_light else "#a09888"
    tagline_html = (
        f'<span style="font-family:Georgia,\'Times New Roman\',serif;'
        f'font-size:10px;letter-spacing:.18em;text-transform:uppercase;'
        f'color:{tagline_color};">{header_tagline}</span>'
        if header_tagline else ''
    )

    header_rows = f"""
    <!-- ── Header ── -->
    <tr>
      <td style="background:{header_bg};padding:24px 40px;border-radius:8px 8px 0 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>{brand}</td>
            <td align="right">{tagline_html}</td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- ── Accent bar ── -->
    <tr>
      <td style="height:3px;background:{accent_color};"></td>
    </tr>""" if show_header else ""

    body_radius = "0 0 8px 8px" if show_header else "8px"

    disclaimer = footer_text.strip() or "This is an automated notification &mdash; please do not reply directly to this email."

    contact_row = (
        f"""<p style="margin:0 0 8px;font-size:13px;color:#9e9890;
                  font-family:{body_font};line-height:1.7;">
          {contact_line}
        </p>""" if show_contact_line else ""
    )

    footer_row = f"""
    <!-- ── Footer ── -->
    <tr>
      <td style="padding:28px 0 0;text-align:center;">
        {contact_row}
        <p style="margin:0 0 6px;font-size:11px;color:#b5afa6;
                  font-family:{body_font};">
          {disclaimer}
        </p>
        <p style="margin:0;font-size:10px;color:#c8c2ba;
                  font-family:{body_font};
                  letter-spacing:.06em;text-transform:uppercase;">
          {workspace_name}
        </p>
      </td>
    </tr>""" if show_footer else ""

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
    {header_rows}

    <!-- ── Body ── -->
    <tr>
      <td style="background:#ffffff;padding:44px 40px 40px;border-radius:{body_radius};
                 font-family:{body_font};">
        {body_html}
      </td>
    </tr>
    {footer_row}

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


# ── Session action buttons ──────────────────────────────────────────────────────

def _action_buttons(confirm_url: str = "", cancel_url: str = "", reschedule_url: str = "") -> str:
    """Three-button row: Confirm / Cancel / Reschedule. Only rendered when URLs are provided."""
    if not any([confirm_url, cancel_url, reschedule_url]):
        return ""
    return f"""
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin-top:28px;border:1px solid #ede9e1;border-radius:8px;
                  background:#faf8f4;">
      <tr>
        <td style="padding:20px 24px 22px;">
          <p style="margin:0 0 6px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                    font-size:11px;font-weight:700;letter-spacing:.14em;
                    text-transform:uppercase;color:#9e9890;">
            Your response
          </p>
          <p style="margin:0 0 18px;font-size:13px;color:#6e6560;line-height:1.6;
                    font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
            Let your coach know you got this — or request a change if needed.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              {'<td style="padding-right:8px;"><a href="' + confirm_url + '" style="display:inline-block;padding:11px 20px;background:#2d6a2d;color:#fff;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;border-radius:5px;">&#10003; Confirm</a></td>' if confirm_url else ''}
              {'<td style="padding-right:8px;"><a href="' + reschedule_url + '" style="display:inline-block;padding:11px 20px;background:#fff;color:#1a2f4e;border:1px solid #c4bfb8;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;border-radius:5px;">&#8635; Reschedule</a></td>' if reschedule_url else ''}
              {'<td><a href="' + cancel_url + '" style="display:inline-block;padding:11px 20px;background:#fff;color:#b91c1c;border:1px solid #fca5a5;font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;border-radius:5px;">&#10007; Cancel</a></td>' if cancel_url else ''}
            </tr>
          </table>
          <p style="margin:14px 0 0;font-size:11px;color:#b5afa6;line-height:1.5;
                    font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
            These links are unique to you and expire after the session date.
          </p>
        </td>
      </tr>
    </table>"""


# ── Confirmation email ───────────────────────────────────────────────────────────

def build_confirmation_email(activity, workspace_name: str, logo_url: str,
                              coach_name: str, coach_email: str, dt_human: str,
                              owner_email: str = "", owner_name: str = "",
                              google_cal_url: str = "",
                              custom_intro: str = "", custom_closing: str = "",
                              confirm_url: str = "", cancel_url: str = "",
                              reschedule_url: str = "",
                              style: dict = None) -> str:
    s              = style or {}
    header_bg      = s.get("header_bg")      or "#1a2f4e"
    accent_color   = s.get("accent_color")   or "#b8922e"
    header_tagline = s.get("header_tagline", "")
    show_header    = s.get("show_header", True)
    show_footer    = s.get("show_footer", True)
    show_contact_line = s.get("show_contact_line", True)
    show_heading   = s.get("show_heading", True)
    show_signature = s.get("show_signature", True)
    footer_text    = s.get("footer_text", "")
    body_font      = s.get("body_font")      or "'Helvetica Neue',Helvetica,Arial,sans-serif"
    heading_font   = s.get("heading_font")   or "Georgia,'Times New Roman',serif"
    value_color    = s.get("value_color")    or "#1a1714"

    location_row = ""
    if activity.location:
        location_row = _divider() + _detail_row("Location", activity.location)

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

    heading_block = f"""
    <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#b8922e;
              font-weight:600;">
      Session Confirmed
    </p>
    <h1 style="margin:0 0 12px;font-family:{heading_font};
               font-size:32px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      Your session is confirmed
    </h1>""" if show_heading else ""

    signature_block = f"""
    <p style="margin:28px 0 0;font-size:13px;color:#9e9890;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {closing_html}
    </p>
    <p style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>""" if show_signature else ""

    body = f"""
    {heading_block}
    <p style="margin:0 0 32px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {intro_html}
    </p>

    <!-- Details table -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-top:2px solid #1a2f4e;border-bottom:1px solid #ede9e1;">
      {_detail_row("What", activity.title)}
      {_divider()}
      {_detail_row("When", f'<strong style="color:{value_color};">{dt_human}</strong>')}
      {location_row}
      {_divider()}
      {_detail_row("Coach", coach_display)}
    </table>

    {_action_buttons(confirm_url, cancel_url, reschedule_url)}
    {_calendar_block(google_cal_url)}

    {signature_block}"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name,
                        header_bg=header_bg, accent_color=accent_color,
                        header_tagline=header_tagline, body_font=body_font,
                        show_header=show_header, show_footer=show_footer, footer_text=footer_text,
                        show_contact_line=show_contact_line)


# ── Reschedule / update email ────────────────────────────────────────────────────

def build_reschedule_email(activity, workspace_name: str, logo_url: str,
                            coach_name: str, coach_email: str, dt_human: str,
                            owner_email: str = "", owner_name: str = "",
                            google_cal_url: str = "",
                            custom_intro: str = "", custom_closing: str = "",
                            cancel_url: str = "", reschedule_url: str = "",
                            style: dict = None) -> str:
    s              = style or {}
    header_bg      = s.get("header_bg")      or "#1a2f4e"
    accent_color   = s.get("accent_color")   or "#b8922e"
    header_tagline = s.get("header_tagline", "")
    show_header    = s.get("show_header", True)
    show_footer    = s.get("show_footer", True)
    show_contact_line = s.get("show_contact_line", True)
    footer_text    = s.get("footer_text", "")
    body_font      = s.get("body_font")      or "'Helvetica Neue',Helvetica,Arial,sans-serif"
    heading_font   = s.get("heading_font")   or "Georgia,'Times New Roman',serif"
    value_color    = s.get("value_color")    or "#1a1714"

    location_row = ""
    if activity.location:
        location_row = _divider() + _detail_row("Location", activity.location)

    coach_display = (
        f'<a href="mailto:{coach_email}" style="color:#b8922e;text-decoration:none;">'
        f'{coach_name}</a>'
        if coach_email else coach_name
    )

    _default_intro   = (f"Hi {activity.client.first_name}, your session with "
                        f"{coach_name} has been updated. Here are your new session details.")
    _default_closing = (f"Need to reschedule again or have questions? Contact {coach_name} directly.")
    intro_html   = custom_intro   or _default_intro
    closing_html = custom_closing or _default_closing

    body = f"""
    <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:{accent_color};
              font-weight:600;">
      Session Updated
    </p>
    <h1 style="margin:0 0 12px;font-family:{heading_font};
               font-size:32px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      Your session has been updated
    </h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {intro_html}
    </p>

    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-top:2px solid #1a2f4e;border-bottom:1px solid #ede9e1;">
      {_detail_row("What", activity.title)}
      {_divider()}
      {_detail_row("When", f'<strong style="color:{value_color};">{dt_human}</strong>')}
      {location_row}
      {_divider()}
      {_detail_row("Coach", coach_display)}
    </table>

    {_action_buttons(cancel_url=cancel_url, reschedule_url=reschedule_url)}
    {_calendar_block(google_cal_url)}

    <p style="margin:28px 0 0;font-size:13px;color:#9e9890;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {closing_html}
    </p>
    <p style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name,
                        header_bg=header_bg, accent_color=accent_color,
                        header_tagline=header_tagline, body_font=body_font,
                        show_header=show_header, show_footer=show_footer, footer_text=footer_text,
                        show_contact_line=show_contact_line)


# ── Team invite email ────────────────────────────────────────────────────────────

def build_invite_email(invited_by_name: str, workspace_name: str, role_display: str,
                       accept_url: str, logo_url: str, invited_email: str = "",
                       owner_email: str = "", owner_name: str = "",
                       custom_intro: str = "", custom_closing: str = "",
                       style: dict = None) -> str:
    s              = style or {}
    header_bg      = s.get("header_bg")      or "#1a2f4e"
    accent_color   = s.get("accent_color")   or "#b8922e"
    header_tagline = s.get("header_tagline", "")
    show_header    = s.get("show_header", True)
    show_footer    = s.get("show_footer", True)
    show_contact_line = s.get("show_contact_line", True)
    footer_text    = s.get("footer_text", "")
    heading_font   = s.get("heading_font")   or "Georgia,'Times New Roman',serif"

    role_color = {
        "Business Owner": "#b8922e",
        "Coach":          "#2d6a9f",
        "Assistant":      "#4a7c59",
    }.get(role_display, "#6e6560")

    _default_intro = (f"<strong style=\"color:#1a1714;\">{invited_by_name}</strong> has invited you to join "
                      f"<strong style=\"color:#1a1714;\">{workspace_name}</strong> on CoachOS as a team member.")
    intro_html   = custom_intro   or _default_intro
    closing_html = (f'<p style="margin:24px 0 0;font-size:13px;color:#9e9890;line-height:1.7;'
                    f'font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;">{custom_closing}</p>'
                    if custom_closing.strip() else "")

    body = f"""
    <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:{accent_color};
              font-weight:600;">
      Team Invitation
    </p>
    <h1 style="margin:0 0 12px;font-family:{heading_font};
               font-size:32px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      You've been invited
    </h1>
    <p style="margin:0 0 28px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {intro_html}
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
    </table>
    {closing_html}"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name or invited_by_name,
                        header_bg=header_bg, accent_color=accent_color,
                        header_tagline=header_tagline, show_header=show_header,
                        show_footer=show_footer, footer_text=footer_text, show_contact_line=show_contact_line)


# ── Reminder email ───────────────────────────────────────────────────────────────

def build_reminder_email(activity, workspace_name: str, logo_url: str,
                         coach_name: str, coach_email: str, dt_human: str,
                         time_label: str, owner_email: str = "",
                         owner_name: str = "",
                         custom_intro: str = "", custom_closing: str = "",
                         cancel_url: str = "", reschedule_url: str = "",
                         style: dict = None) -> str:
    s              = style or {}
    header_bg      = s.get("header_bg")      or "#1a2f4e"
    accent_color   = s.get("accent_color")   or "#b8922e"
    header_tagline = s.get("header_tagline", "")
    show_header    = s.get("show_header", True)
    show_footer    = s.get("show_footer", True)
    show_contact_line = s.get("show_contact_line", True)
    footer_text    = s.get("footer_text", "")
    body_font      = s.get("body_font")      or "'Helvetica Neue',Helvetica,Arial,sans-serif"
    value_color    = s.get("value_color")    or "#1a1714"

    location_row = ""
    if activity.location:
        location_row = _divider() + _detail_row("Location", activity.location)

    is_soon   = "1 hour" in time_label or ("hour" in time_label.lower() and "24" not in time_label)
    dt_color  = "#c0392b" if is_soon else accent_color
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
              color:{dt_color};font-weight:600;">
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
      {_detail_row("When", f'<strong style="color:{value_color};">{dt_human}</strong>')}
      {location_row}
      {_divider()}
      {_detail_row("Coach", coach_display)}
    </table>

    {_action_buttons(cancel_url=cancel_url, reschedule_url=reschedule_url)}

    <p style="margin:28px 0 0;font-size:13px;color:#9e9890;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {closing_html}
    </p>
    <p style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name,
                        header_bg=header_bg, accent_color=accent_color,
                        header_tagline=header_tagline, body_font=body_font,
                        show_header=show_header, show_footer=show_footer, footer_text=footer_text,
                        show_contact_line=show_contact_line)


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
                        custom_intro: str = "", custom_closing: str = "",
                        style: dict = None) -> str:
    s = style or {}
    header_bg      = s.get("header_bg")      or "#1a2f4e"
    accent_color   = s.get("accent_color")   or "#b8922e"
    header_tagline = s.get("header_tagline", "")
    body_font      = s.get("body_font")      or "'Helvetica Neue',Helvetica,Arial,sans-serif"
    heading_font   = s.get("heading_font")   or "Georgia,'Times New Roman',serif"
    value_color    = s.get("value_color")    or "#1a1714"

    amount = f"{invoice.currency} {invoice.total:,.2f}"

    pay_button = ""
    if invoice.stripe_payment_link:
        pay_button = f"""
        <div style="margin-top:28px;text-align:center;">
          {_cta_button("Pay Invoice Online", invoice.stripe_payment_link, accent_color)}
        </div>"""

    due_row = ""
    if due_str:
        due_row = _divider() + _detail_row("Due Date", f'<strong style="color:{value_color};">{due_str}</strong>')

    _default_intro   = f"Hi {invoice.client.first_name}, please find your invoice from {workspace_name} below."
    _default_closing = (f"Have questions about this invoice? Contact us at {owner_name or owner_email}."
                        if owner_email else "")
    intro_html   = custom_intro   or _default_intro
    closing_html = custom_closing or _default_closing

    body = f"""
    <p style="margin:0 0 4px;font-family:{body_font};
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:{accent_color};
              font-weight:600;">
      Invoice
    </p>
    <h1 style="margin:0 0 12px;font-family:{heading_font};
               font-size:32px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      Invoice #{invoice.number}
    </h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:{body_font};">
      {intro_html}
    </p>

    <!-- Invoice details -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-top:2px solid {header_bg};border-bottom:1px solid #ede9e1;">
      {_detail_row("Invoice #", invoice.number)}
      {_divider()}
      {_detail_row("Amount", f'<strong style="color:{value_color};font-size:18px;">{amount}</strong>')}
      {due_row}
    </table>

    {pay_button}

    {f'<p style="margin:28px 0 0;font-size:13px;color:#9e9890;line-height:1.7;font-family:{body_font};">{closing_html}</p>' if closing_html else ''}

    <p style="margin:{'12px' if closing_html else '28px'} 0 0;font-family:{heading_font};
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name,
                        header_bg=header_bg, accent_color=accent_color,
                        header_tagline=header_tagline, body_font=body_font)


# ── Payment receipt email ──────────────────────────────────────────────────────

def build_payment_receipt_email(invoice, workspace_name: str, logo_url: str,
                                 amount_paid: str, payment_date: str,
                                 owner_email: str = "", owner_name: str = "",
                                 custom_intro: str = "", custom_closing: str = "",
                                 style: dict = None) -> str:
    """Sent when an invoice is recorded as fully paid (InvoiceViewSet.record_payment).
    Deliberately a separate builder from build_invoice_email rather than reusing it with
    different copy — a receipt should read "Payment Received", not "Invoice", as its
    heading, and show what was paid/when rather than what's owed."""
    s = style or {}
    header_bg      = s.get("header_bg")      or "#1a2f4e"
    accent_color   = s.get("accent_color")   or "#b8922e"
    header_tagline = s.get("header_tagline", "")
    body_font      = s.get("body_font")      or "'Helvetica Neue',Helvetica,Arial,sans-serif"
    heading_font   = s.get("heading_font")   or "Georgia,'Times New Roman',serif"
    value_color    = s.get("value_color")    or "#1a1714"
    show_header       = s.get("show_header", True)
    show_footer       = s.get("show_footer", True)
    footer_text       = s.get("footer_text", "")
    show_contact_line = s.get("show_contact_line", True)

    _default_intro   = f"Hi {invoice.client.first_name}, thank you — we've received your payment for invoice #{invoice.number}."
    _default_closing = (f"Questions about this payment? Contact us at {owner_name or owner_email}."
                        if owner_email else "")
    intro_html   = custom_intro   or _default_intro
    closing_html = custom_closing or _default_closing

    body = f"""
    <p style="margin:0 0 4px;font-family:{body_font};
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:{accent_color};
              font-weight:600;">
      Payment Received
    </p>
    <h1 style="margin:0 0 12px;font-family:{heading_font};
               font-size:32px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      ${amount_paid}
    </h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:{body_font};">
      {intro_html}
    </p>

    <!-- Receipt details -->
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
           style="border-top:2px solid {header_bg};border-bottom:1px solid #ede9e1;">
      {_detail_row("Invoice #", invoice.number)}
      {_divider()}
      {_detail_row("Amount Paid", f'<strong style="color:{value_color};font-size:18px;">${amount_paid}</strong>')}
      {_divider()}
      {_detail_row("Paid On", payment_date)}
    </table>

    {f'<p style="margin:28px 0 0;font-size:13px;color:#9e9890;line-height:1.7;font-family:{body_font};">{closing_html}</p>' if closing_html else ''}

    <p style="margin:{'12px' if closing_html else '28px'} 0 0;font-family:{heading_font};
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name,
                        header_bg=header_bg, accent_color=accent_color,
                        header_tagline=header_tagline, body_font=body_font,
                        show_header=show_header, show_footer=show_footer,
                        footer_text=footer_text, show_contact_line=show_contact_line)


# ── Proper invoice PDF document (with line items) ────────────────────────────────

def build_invoice_pdf_html(invoice, workspace_name: str, logo_url: str,
                           due_str: str, owner_email: str = "",
                           owner_name: str = "", style: dict = None) -> str:
    """Generate a standalone invoice PDF document with line items table.
    Intended for WeasyPrint — not styled as an email wrapper."""
    s = style or {}
    value_color  = s.get("value_color")  or "#1a1714"
    label        = "#8c8279"  # muted uppercase field labels, shared across the FROM/BILL TO/dates row

    logo_html = (
        f'<img src="{logo_url}" alt="{workspace_name}" '
        f'style="max-height:64px;max-width:220px;object-fit:contain;display:block;" />'
    ) if logo_url else f'<div style="font-family:Georgia,serif;font-size:26px;color:{value_color};">{workspace_name}</div>'

    coach_name = invoice.coach.full_name if invoice.coach else workspace_name
    from_address_lines = "".join(
        f'<div style="font-size:13px;color:#6b6560;line-height:1.6;">{line}</div>'
        for line in [
            getattr(invoice.workspace, "address", ""),
            ", ".join(filter(None, [
                getattr(invoice.workspace, "city", ""),
                getattr(invoice.workspace, "state", ""),
                getattr(invoice.workspace, "zip_code", ""),
            ])),
        ] if line
    )

    client_company = f'<div style="font-size:13px;color:#6b6560;">{invoice.client.company}</div>' if getattr(invoice.client, "company", "") else ""

    _STATUS_COLORS = {
        "draft": "#8c8279", "sent": "#2d6a9f", "paid": "#2d6a2d",
        "partially_paid": "#b8922e", "overdue": "#b91c1c",
        "void": "#8c8279", "partially_refunded": "#b8922e", "refunded": "#8c8279",
    }
    _status_color = _STATUS_COLORS.get(invoice.status, "#8c8279")
    status_badge = (
        f'<span style="display:inline-block;margin-top:10px;padding:4px 12px;'
        f'border:1px solid {_status_color};border-radius:4px;font-size:11px;font-weight:700;'
        f'letter-spacing:.08em;text-transform:uppercase;color:{_status_color};">'
        f'{invoice.get_status_display()}</span>'
    )

    # Line items rows — a single Description field per item (no separate name/sub-description
    # split in the data model), so each row is just one line. Generous padding (14px 10px)
    # so the items table has proper breathing room rather than looking cramped.
    items_html = ""
    for item in invoice.items.all():
        line_total = item.quantity * item.unit_price * (1 - item.discount / 100)
        items_html += f"""
        <tr style="border-bottom:1px solid #ede9e1;">
          <td style="padding:14px 10px;font-size:14px;font-weight:600;color:{value_color};line-height:1.5;">{item.description}</td>
          <td style="padding:14px 10px;font-size:13px;color:#6b6560;text-align:center;">{item.quantity:g}</td>
          <td style="padding:14px 10px;font-size:13px;color:#6b6560;text-align:right;">{invoice.currency} {item.unit_price:,.2f}</td>
          <td style="padding:14px 10px;font-size:14px;font-weight:600;color:{value_color};text-align:right;">{invoice.currency} {line_total:,.2f}</td>
        </tr>"""

    # Invoice-level notes — a real field (Invoice.notes) that previously had nowhere to
    # show up on the PDF at all. Shown once below the items table, same muted styling as
    # the reference's per-item description text.
    notes_block = (
        f'<p style="margin:14px 0 0;font-size:13px;color:#8c8279;line-height:1.6;">{invoice.notes}</p>'
        if invoice.notes else ""
    )

    # Totals block — Subtotal / Discount / Tax always shown (em-dash when zero, so the
    # block's shape doesn't jump around), then Total Amount and Balance Due (= total minus
    # any payments already recorded) as the final, bold lines.
    discount_amount = (
        float(invoice.subtotal) * float(invoice.discount_value) / 100
        if invoice.discount_type == "percent" else float(invoice.discount_value)
    ) if invoice.discount_value else 0
    tax_amount = (
        (float(invoice.subtotal) - discount_amount) * float(invoice.tax_percent) / 100
        if invoice.tax_percent else 0
    )
    balance_due = float(invoice.total) - float(invoice.amount_paid)

    def _total_row(label_text, amount, bold=False):
        weight = 700 if bold else 400
        size   = "18px" if bold else "13px"
        color  = value_color if bold else "#6b6560"
        return f"""
        <div style="display:flex;justify-content:space-between;gap:24px;padding:{'10px' if bold else '4px'} 0;{'border-top:1px solid #ede9e1;margin-top:6px;' if bold else ''}">
          <span style="font-size:{size};font-weight:{weight};color:{color};">{label_text}</span>
          <span style="font-size:{size};font-weight:{weight};color:{color};">{amount}</span>
        </div>"""

    totals_html = _total_row("Subtotal", f"{invoice.currency} {invoice.subtotal:,.2f}")
    totals_html += _total_row("Discount", f"-{invoice.currency} {discount_amount:,.2f}" if discount_amount else "—")
    totals_html += _total_row("Tax", f"{invoice.currency} {tax_amount:,.2f}")
    totals_html += _total_row("Total Amount", f"{invoice.currency} {invoice.total:,.2f}", bold=True)
    totals_html += _total_row("Balance Due", f"{invoice.currency} {balance_due:,.2f}", bold=True)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <style>
    @page {{ margin: 0; }}
    body {{ margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background: #f5f2ee; }}
  </style>
</head>
<body>
<div style="max-width:680px;margin:32px auto;background:#fff;padding:48px 44px;">

  <!-- Header — logo top-left, INVOICE / number / status badge top-right -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:40px;">
    {logo_html}
    <div style="text-align:right;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:{label};">Invoice</div>
      <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;color:{value_color};margin-top:2px;">{invoice.number}</div>
      <div style="font-size:12px;color:#6b6560;margin-top:4px;">Issued: {invoice.issue_date.strftime("%B %d, %Y") if invoice.issue_date else "—"}</div>
      {status_badge}
    </div>
  </div>

  <!-- FROM / BILL TO / dates ─ three-column meta row -->
  <div style="display:flex;gap:40px;padding-bottom:28px;border-bottom:1px solid #ede9e1;margin-bottom:28px;">
    <div style="flex:1;">
      <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:{label};margin-bottom:6px;">From</div>
      <div style="font-size:14px;font-weight:600;color:{value_color};">{coach_name}</div>
      <div style="font-size:13px;color:#6b6560;">{workspace_name}</div>
      {from_address_lines}
      {f'<div style="font-size:13px;color:#6b6560;">{owner_email}</div>' if owner_email else ""}
    </div>
    <div style="flex:1;">
      <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:{label};margin-bottom:6px;">Bill To</div>
      <div style="font-size:14px;font-weight:600;color:{value_color};">{invoice.client.full_name}</div>
      {client_company}
      {f'<div style="font-size:13px;color:#6b6560;">{invoice.client.email}</div>' if invoice.client.email else ""}
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:{label};margin-bottom:6px;">Due Date</div>
      <div style="font-size:13px;color:{value_color};">{due_str or "Upon Receipt"}</div>
    </div>
  </div>

  <!-- Line items -->
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
    <thead>
      <tr style="border-bottom:2px solid {value_color};">
        <th style="padding:0 10px 10px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:{label};text-align:left;">Items</th>
        <th style="padding:0 10px 10px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:{label};text-align:center;">Qty</th>
        <th style="padding:0 10px 10px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:{label};text-align:right;">Price</th>
        <th style="padding:0 10px 10px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:{label};text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>{items_html}</tbody>
  </table>
  {notes_block}

  <!-- Totals -->
  <div style="max-width:280px;margin:20px 0 0 auto;">
    {totals_html}
  </div>

  <!-- Footer — no pay link / contact here, both already live in the email body itself -->
  <div style="padding-top:28px;margin-top:28px;border-top:1px solid #ede9e1;">
    <p style="margin:0;font-size:11px;color:#b5afa6;">Thank you for your business — {workspace_name}</p>
  </div>

</div>
</body>
</html>"""


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
    custom_intro: str = "",
    custom_closing: str = "",
    style: dict = None,
) -> str:
    s              = style or {}
    header_bg      = s.get("header_bg")      or "#1a2f4e"
    accent_color   = s.get("accent_color")   or "#b8922e"
    header_tagline = s.get("header_tagline", "")
    show_header    = s.get("show_header", True)
    show_footer    = s.get("show_footer", True)
    show_contact_line = s.get("show_contact_line", True)
    footer_text    = s.get("footer_text", "")
    body_font      = s.get("body_font")      or "'Helvetica Neue',Helvetica,Arial,sans-serif"
    heading_font   = s.get("heading_font")   or "Georgia,'Times New Roman',serif"

    overdue_days = days_in_stage - follow_up_days

    cta = ""
    if pipeline_url:
        cta = f"""
    <div style="margin:32px 0;text-align:center;">
      {_cta_button("View Pipeline", pipeline_url, header_bg)}
    </div>"""

    _default_intro = (
        f"Hi {owner_name}, this deal has been sitting in "
        f"<strong style=\"color:#1a1714;\">{stage_label}</strong> for "
        f"<strong style=\"color:#c0392b;\">{days_in_stage} days</strong> "
        f"&mdash; {overdue_days} day{'s' if overdue_days != 1 else ''} past your follow-up threshold."
    )
    _default_closing = "Once the deal moves to a new stage, this alert resets automatically."
    intro_html   = custom_intro   or _default_intro
    closing_html = custom_closing or _default_closing

    body = f"""
    <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;
              color:#c0392b;font-weight:600;">
      Follow-up required &middot; {overdue_days} day{'s' if overdue_days != 1 else ''} overdue
    </p>
    <h1 style="margin:0 0 12px;font-family:{heading_font};
               font-size:30px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      {client_name} needs attention
    </h1>
    <p style="margin:0 0 32px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {intro_html}
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
      {closing_html}
    </p>
    <p style="margin:12px 0 0;font-family:Georgia,'Times New Roman',serif;
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name,
                        header_bg=header_bg, accent_color=accent_color,
                        header_tagline=header_tagline, body_font=body_font,
                        show_header=show_header, show_footer=show_footer, footer_text=footer_text,
                        show_contact_line=show_contact_line)


def build_client_communication_email(
    client_name: str,
    subject: str,
    workspace_name: str,
    coach_name: str,
    logo_url: str = "",
    owner_email: str = "",
    owner_name: str = "",
    custom_intro: str = "",
    custom_closing: str = "",
    style: dict = None,
    coach_signature: str = "",
    include_client_signature_line: bool = False,
    sign_url: str = "",
    client_signature: str = "",
    client_signed_at_human: str = "",
) -> str:
    """Generic one-off message to a client — used by the Client Communication draft tool.
    coach_signature is a PNG data URL drawn in the compose screen. When
    include_client_signature_line is set and sign_url is provided, the email includes a
    "Review & Sign" link to the public no-login signing page (apps.clients.public_views);
    once the client has actually signed there, client_signature/client_signed_at_human
    render their captured signature instead of the link."""
    s = style or {}
    first_name = client_name.split()[0] if client_name else client_name

    intro_html = f"""
    <p style="margin:0 0 20px;font-size:15px;color:#3a3530;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {custom_intro}
    </p>""" if custom_intro else f"""
    <p style="margin:0 0 20px;font-size:15px;color:#3a3530;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      Hi {first_name},
    </p>"""

    closing_html = f"""
    <p style="margin:20px 0 0;font-size:14px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {custom_closing}
    </p>""" if custom_closing else ""

    if coach_signature:
        signature_html = (
            f'<img src="{coach_signature}" alt="Signature" '
            f'style="display:block;max-height:60px;max-width:220px;margin:14px 0 2px;" />'
        )
    elif include_client_signature_line:
        # No signature drawn yet, but this looks like a contract (client signature
        # line requested) — show where the coach's signature will go once they sign
        # it in the compose screen, rather than silently omitting it.
        signature_html = (
            '<div style="display:inline-block;margin:14px 0 2px;padding:10px 24px;'
            'border:1px dashed #c8c2ba;border-radius:4px;font-size:12px;color:#b5afa6;'
            'font-family:\'Helvetica Neue\',Helvetica,Arial,sans-serif;">'
            '[ Coach signature ]</div>'
        )
    else:
        signature_html = ""

    if client_signature:
        # Already signed — show the captured signature instead of a blank line/link.
        signature_line_html = f"""
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin-top:36px;border-top:1px solid #ede9e1;padding-top:20px;">
      <tr>
        <td style="padding:0 0 6px;font-size:13px;color:#3a3530;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          <div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#4a7c59;font-weight:600;margin-bottom:6px;">
            &#10003; Signed by Client{f' on {client_signed_at_human}' if client_signed_at_human else ''}
          </div>
          <img src="{client_signature}" alt="Client signature" style="display:block;max-height:60px;max-width:220px;" />
        </td>
      </tr>
    </table>"""
    elif include_client_signature_line:
        sign_button = f"""
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
          <tr>
            <td style="background:#4a7c59;border-radius:4px;">
              <a href="{sign_url}" style="display:inline-block;padding:12px 32px;
                        font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
                        font-size:12px;font-weight:700;color:#ffffff;text-decoration:none;
                        letter-spacing:.08em;text-transform:uppercase;">
                Review &amp; Sign Online
              </a>
            </td>
          </tr>
        </table>""" if sign_url else ""
        signature_line_html = f"""
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
           style="margin-top:36px;border-top:1px solid #ede9e1;padding-top:20px;">
      <tr>
        <td style="padding:0 0 6px;font-size:13px;color:#3a3530;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
          {sign_button}
          Client Signature: <span style="display:inline-block;min-width:220px;border-bottom:1px solid #b5afa6;">&nbsp;</span>
          &nbsp;&nbsp;Date: <span style="display:inline-block;min-width:100px;border-bottom:1px solid #b5afa6;">&nbsp;</span>
        </td>
      </tr>
    </table>"""
    else:
        signature_line_html = ""

    body = f"""
    <h1 style="margin:0 0 20px;font-family:Georgia,'Times New Roman',serif;
               font-size:26px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      {subject or "A message from your coach"}
    </h1>

    {intro_html}
    {closing_html}

    {signature_html}
    <p style="margin:{'2px' if signature_html else '24px'} 0 0;font-family:Georgia,'Times New Roman',serif;
              font-size:15px;color:#9e9890;">
      &mdash; {coach_name or workspace_name}
    </p>
    {signature_line_html}"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name,
                        header_bg=s.get("header_bg") or "#1a2f4e",
                        accent_color=s.get("accent_color") or "#b8922e",
                        header_tagline=s.get("header_tagline", ""),
                        body_font=s.get("body_font") or "'Helvetica Neue',Helvetica,Arial,sans-serif",
                        show_header=s.get("show_header", True),
                        show_footer=s.get("show_footer", True), footer_text=s.get("footer_text", ""),
                        show_contact_line=s.get("show_contact_line", True))


def build_portal_invite_email(
    client_name: str,
    workspace_name: str,
    portal_url: str,
    coach_name: str,
    logo_url: str = "",
    owner_email: str = "",
    owner_name: str = "",
    custom_intro: str = "",
    custom_closing: str = "",
    style: dict = None,
) -> str:
    s = style or {}
    first_name = client_name.split()[0] if client_name else client_name

    intro_html = f"""
    <p style="margin:0 0 28px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {custom_intro}
    </p>""" if custom_intro else f"""
    <p style="margin:0 0 28px;font-size:15px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      Hi {first_name}, {workspace_name} has set up a private portal for you where you can
      view your sessions, goals, and shared resources.
    </p>"""

    closing_html = f"""
    <p style="margin:28px 0 0;font-size:14px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      {custom_closing}
    </p>""" if custom_closing else f"""
    <p style="margin:28px 0 0;font-size:14px;color:#6e6560;line-height:1.7;
              font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      If you have any questions, reply to this email or contact {workspace_name}.
    </p>"""

    body = f"""
    <p style="margin:0 0 4px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;
              font-size:11px;letter-spacing:.16em;text-transform:uppercase;
              color:#4a7c59;font-weight:600;">
      Portal Access
    </p>
    <h1 style="margin:0 0 12px;font-family:Georgia,'Times New Roman',serif;
               font-size:30px;font-weight:400;color:#16130f;letter-spacing:-.01em;line-height:1.2;">
      Your portal is ready
    </h1>

    {intro_html}

    <div style="margin:32px 0;text-align:center;">
      {_cta_button("Access Your Portal", portal_url, "#4a7c59")}
    </div>

    {closing_html}

    <p style="margin:24px 0 0;font-family:Georgia,'Times New Roman',serif;
              font-size:15px;color:#9e9890;">
      &mdash; {workspace_name}
    </p>"""

    return _email_shell(workspace_name, logo_url, body, owner_email, owner_name,
                        header_bg=s.get("header_bg") or "#1a2f4e",
                        accent_color=s.get("accent_color") or "#b8922e",
                        header_tagline=s.get("header_tagline", ""),
                        body_font=s.get("body_font") or "'Helvetica Neue',Helvetica,Arial,sans-serif",
                        show_header=s.get("show_header", True),
                        show_footer=s.get("show_footer", True), footer_text=s.get("footer_text", ""),
                        show_contact_line=s.get("show_contact_line", True))
