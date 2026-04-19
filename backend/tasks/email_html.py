"""
CoachOS — HTML email builder.
Single source of truth for all transactional email HTML.
"""


def _email_shell(workspace_name: str, logo_data: str, body_html: str) -> str:
    """Wrap body_html in the CoachOS branded email shell."""
    if logo_data:
        header_content = (
            f'<img src="{logo_data}" alt="{workspace_name}" '
            f'style="max-height:48px;max-width:180px;object-fit:contain;display:block;" />'
        )
    else:
        header_content = (
            f'<span style="font-family:Georgia,\'Times New Roman\',serif;'
            f'font-size:22px;font-weight:400;letter-spacing:.04em;color:#1a1714;">'
            f'{workspace_name}</span>'
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>{workspace_name}</title>
</head>
<body style="margin:0;padding:0;background:#f7f4ef;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f4ef;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

        <!-- Header -->
        <tr><td style="background:#1a1714;padding:28px 36px;border-radius:6px 6px 0 0;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>{header_content}</td>
            </tr>
          </table>
        </td></tr>

        <!-- Gold rule -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#b8922e,#d4b06a);"></td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:36px 36px 28px;border-radius:0 0 6px 6px;">
          {body_html}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 0 0;text-align:center;">
          <p style="margin:0;font-size:12px;color:#9c948c;line-height:1.6;">
            Sent by <strong style="color:#6e6560;">{workspace_name}</strong> via CoachOS
          </p>
          <p style="margin:6px 0 0;font-size:11px;color:#b8b0a6;">
            This is an automated message — please do not reply directly.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _detail_row(label: str, value: str) -> str:
    return (
        f'<tr>'
        f'<td style="padding:7px 0;font-size:13px;color:#6e6560;width:90px;vertical-align:top;">{label}</td>'
        f'<td style="padding:7px 0;font-size:13px;color:#1a1714;font-weight:500;">{value}</td>'
        f'</tr>'
    )


def build_confirmation_email(activity, workspace_name: str, logo_data: str,
                              coach_name: str, dt_human: str) -> str:
    location_row = _detail_row("Location", activity.location) if activity.location else ""
    notes_block = ""
    if activity.notes:
        notes_block = (
            f'<div style="margin-top:20px;padding:14px 16px;'
            f'background:#f7f4ef;border-left:3px solid #b8922e;border-radius:0 4px 4px 0;">'
            f'<p style="margin:0;font-size:13px;color:#6e6560;line-height:1.6;">{activity.notes}</p>'
            f'</div>'
        )

    body = f"""
      <h1 style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;
                 font-size:26px;font-weight:400;color:#1a1714;letter-spacing:.01em;">
        Your session is confirmed
      </h1>
      <p style="margin:0 0 24px;font-size:14px;color:#6e6560;line-height:1.6;">
        Hi {activity.client.first_name}, your {activity.activity_type} has been scheduled.
      </p>

      <!-- Detail table -->
      <table cellpadding="0" cellspacing="0" width="100%"
             style="border-top:1px solid #ede9e1;margin-bottom:8px;">
        {_detail_row("What", activity.title)}
        {_detail_row("When", dt_human)}
        {location_row}
        {_detail_row("Coach", coach_name)}
      </table>

      {notes_block}

      <div style="margin-top:28px;padding:16px;background:#f7f4ef;border-radius:4px;">
        <p style="margin:0;font-size:13px;color:#6e6560;line-height:1.7;">
          📅 &nbsp;A <strong>calendar invite (.ics)</strong> is attached — open it to add this session to your calendar.<br/>
          🔔 &nbsp;You will receive a reminder <strong>24 hours</strong> and <strong>1 hour</strong> before your session.
        </p>
      </div>

      <p style="margin:24px 0 0;font-size:13px;color:#9c948c;line-height:1.6;">
        Need to reschedule? Contact <strong style="color:#1a1714;">{coach_name}</strong> directly.
      </p>

      <div style="margin-top:28px;padding-top:20px;border-top:1px solid #ede9e1;">
        <p style="margin:0;font-size:13px;color:#6e6560;">
          — <strong>{workspace_name}</strong>
        </p>
      </div>
    """
    return _email_shell(workspace_name, logo_data, body)


def build_invite_email(invited_by_name: str, workspace_name: str, role_display: str,
                       accept_url: str, logo_data: str, invited_email: str = "") -> str:
    role_color = {
        "Coach": "#2d6a9f",
        "Assistant": "#4a7c59",
    }.get(role_display, "#6e6560")

    body = f"""
      <h1 style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;
                 font-size:26px;font-weight:400;color:#1a1714;letter-spacing:.01em;">
        You've been invited
      </h1>
      <p style="margin:0 0 24px;font-size:14px;color:#6e6560;line-height:1.6;">
        <strong style="color:#1a1714;">{invited_by_name}</strong> has invited you to join
        <strong style="color:#1a1714;">{workspace_name}</strong> on CoachOS.
      </p>

      <!-- Role badge -->
      <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td style="padding:5px 14px;border-radius:20px;
                     background:{role_color}18;border:1px solid {role_color}30;">
            <span style="font-size:12px;font-weight:600;color:{role_color};
                         text-transform:uppercase;letter-spacing:.07em;">
              {role_display}
            </span>
          </td>
        </tr>
      </table>

      <!-- CTA button -->
      <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td style="background:#1a1714;border-radius:4px;">
            <a href="{accept_url}"
               style="display:inline-block;padding:14px 32px;
                      font-size:13px;font-weight:600;color:#f7f4ef;
                      text-decoration:none;letter-spacing:.08em;text-transform:uppercase;">
              Accept Invitation
            </a>
          </td>
        </tr>
      </table>

      <p style="margin:0 0 8px;font-size:12px;color:#9c948c;line-height:1.6;">
        Or copy this link into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:12px;word-break:break-all;">
        <a href="{accept_url}" style="color:#b8922e;text-decoration:none;">{accept_url}</a>
      </p>

      <div style="padding:14px 16px;background:#f7f4ef;border-radius:4px;">
        <p style="margin:0;font-size:12px;color:#9c948c;line-height:1.6;">
          ⏱ &nbsp;This invitation expires in <strong style="color:#6e6560;">48 hours</strong>.<br/>
          🔒 &nbsp;You'll set your password when you accept.<br/>
          {'📧 &nbsp;Your login email will be: <strong style="color:#6e6560;">' + invited_email + '</strong>' if invited_email else ''}
        </p>
      </div>
    """
    return _email_shell(workspace_name, logo_data, body)


def build_reminder_email(activity, workspace_name: str, logo_data: str,
                         coach_name: str, dt_human: str, time_label: str) -> str:
    location_row = _detail_row("Location", activity.location) if activity.location else ""

    body = f"""
      <h1 style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;
                 font-size:26px;font-weight:400;color:#1a1714;letter-spacing:.01em;">
        Reminder: session in {time_label}
      </h1>
      <p style="margin:0 0 24px;font-size:14px;color:#6e6560;line-height:1.6;">
        Hi {activity.client.first_name}, this is a reminder about your upcoming session.
      </p>

      <table cellpadding="0" cellspacing="0" width="100%"
             style="border-top:1px solid #ede9e1;margin-bottom:24px;">
        {_detail_row("What", activity.title)}
        {_detail_row("When", dt_human)}
        {location_row}
        {_detail_row("Coach", coach_name)}
      </table>

      <p style="margin:0 0 0;font-size:13px;color:#9c948c;line-height:1.6;">
        Need to reschedule? Contact <strong style="color:#1a1714;">{coach_name}</strong> as soon as possible.
      </p>

      <div style="margin-top:28px;padding-top:20px;border-top:1px solid #ede9e1;">
        <p style="margin:0;font-size:13px;color:#6e6560;">
          — <strong>{workspace_name}</strong>
        </p>
      </div>
    """
    return _email_shell(workspace_name, logo_data, body)
