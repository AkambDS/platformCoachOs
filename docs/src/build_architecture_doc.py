"""Builds docs/CoachOS_Architecture_and_Design.pdf.

    python3 docs/src/build_architecture_doc.py

Writes docs/src/CoachOS_Architecture_and_Design.html (inline-SVG diagrams, no
external assets), then prints it to PDF with headless Chrome. Diagrams are drawn
with the small helpers below; label_check() warns when a label is too long for
its box, so edits stay legible without eyeballing every figure.
"""
import html
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT_HTML = HERE / "CoachOS_Architecture_and_Design.html"
OUT_PDF = HERE.parent / "CoachOS_Architecture_and_Design.pdf"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
AS_OF = "October 8, 2026"

WARNINGS = []


def esc(s):
    return html.escape(str(s), quote=True)


def label_check(text, width, px, where):
    est = len(text) * px
    if est > width:
        WARNINGS.append(f"[{where}] '{text}' ~{est:.0f}px > {width:.0f}px")


# ── SVG primitives ────────────────────────────────────────────────────────────
class Fig:
    def __init__(self, sid, w, h):
        self.sid, self.w, self.h, self.parts = sid, w, h, []

    def add(self, s):
        self.parts.append(s)

    def text(self, x, y, s, cls="ts", anchor="middle"):
        self.add(f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}">{esc(s)}</text>')

    def box(self, x, y, w, h, title, subs=(), kind="b", title_cls="tt"):
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" class="k-{kind}"/>')
        lines = ([(title, title_cls)] if title else []) + [(s, "ts") for s in subs]
        n = len(lines)
        y0 = y + h / 2 - (n - 1) * 13 / 2 + 4
        for i, (s, c) in enumerate(lines):
            label_check(s, w - 8, 6.6 if c == "tt" else 5.5, self.sid)
            self.add(f'<text x="{x + w / 2}" y="{y0 + i * 13:.1f}" class="{c}" text-anchor="middle">{esc(s)}</text>')

    def group(self, x, y, w, h, label):
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" class="k-g"/>')
        self.add(f'<text x="{x + 12}" y="{y + 18}" class="tg" text-anchor="start">{esc(label)}</text>')

    def arrow(self, pts, label=None, at=None, kind="k", dashed=False, anchor="middle", both=False, lw=None):
        d = " ".join(f"{x},{y}" for x, y in pts)
        dash = ' stroke-dasharray="5 4"' if dashed else ""
        start = f' marker-start="url(#{self.sid}-{kind})"' if both else ""
        self.add(f'<polyline points="{d}" class="l-{kind}"{dash} marker-end="url(#{self.sid}-{kind})"{start}/>')
        if label:
            if at is None:
                (x1, y1), (x2, y2) = pts[0], pts[-1]
                at = ((x1 + x2) / 2, (y1 + y2) / 2 - 6)
            if lw:
                label_check(label, lw, 5.5, self.sid)
            self.add(f'<text x="{at[0]}" y="{at[1]}" class="tl{" tl-" + kind if kind != "k" else ""}" text-anchor="{anchor}">{esc(label)}</text>')

    def line(self, pts, kind="k", dashed=True):
        d = " ".join(f"{x},{y}" for x, y in pts)
        dash = ' stroke-dasharray="3 4"' if dashed else ""
        self.add(f'<polyline points="{d}" class="l-{kind} thin"{dash}/>')

    def svg(self, aria):
        defs = "".join(
            f'<marker id="{self.sid}-{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
            f'markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="m-{k}"/></marker>'
            for k in ("k", "a", "r", "x")
        )
        return (f'<svg viewBox="0 0 {self.w} {self.h}" role="img" aria-label="{esc(aria)}" '
                f'xmlns="http://www.w3.org/2000/svg"><defs>{defs}</defs>{"".join(self.parts)}</svg>')


def figure(fig, caption, aria=None):
    return f'<figure>{fig.svg(aria or caption)}<figcaption>{caption}</figcaption></figure>'


def sequence(sid, w, lanes, msgs, h, notes=()):
    """lanes: [(x, title, sub, kind)]; msgs: [(x1, x2, y, label, kind, dashed)]."""
    f = Fig(sid, w, h)
    for x, title, sub, kind in lanes:
        f.box(x - 66, 6, 132, 40, title, [sub] if sub else [], kind)
        f.line([(x, 46), (x, h - 4)])
    for x1, x2, y, label, kind, dashed in msgs:
        if x1 < x2:
            f.arrow([(x1 + 3, y), (x2 - 3, y)], label, ((x1 + x2) / 2, y - 6), kind, dashed, lw=abs(x2 - x1))
        else:
            f.arrow([(x1 - 3, y), (x2 + 3, y)], label, ((x1 + x2) / 2, y - 6), kind, dashed, lw=abs(x2 - x1))
    for x, y, w_, lines, kind in notes:
        f.box(x, y, w_, 14 + 13 * len(lines), None, lines, kind)
    return f


# ── Diagrams ──────────────────────────────────────────────────────────────────
def d_deployment():
    f = Fig("d1", 720, 410)
    # browsers
    f.box(0, 60, 140, 50, "Coach / team", ["React SPA"])
    f.box(0, 170, 140, 50, "Client", ["portal SPA · OTP login"])
    f.box(0, 280, 140, 50, "Anyone with a link", ["pay · sign · confirm"])
    f.arrow([(140, 85), (188, 92)], "HTTPS", (160, 80))
    f.arrow([(140, 195), (188, 112)])
    f.arrow([(140, 305), (188, 132)])
    # EC2 host
    f.group(168, 12, 372, 384, "EC2 host · docker-compose.prod.yml")
    f.box(190, 60, 120, 100, "nginx", ["TLS (Let's Encrypt)", "routes by path"])
    f.box(190, 200, 120, 46, "OnlyOffice", [":8443 doc server"])
    f.box(190, 320, 120, 50, "PostgreSQL", ["one DB, all tenants"])
    f.box(370, 30, 150, 44, "SPA build", ["static volume"])
    f.box(370, 100, 150, 60, "Django + gunicorn", ["DRF API · public pages", "Django admin"], kind="a")
    f.box(370, 210, 150, 56, "Celery worker + beat", ["8 scheduled jobs"])
    f.box(370, 320, 150, 46, "Redis", ["broker · cache"])
    f.arrow([(310, 78), (368, 56)], "/ , assets", (338, 58))
    f.arrow([(310, 112), (368, 128)], "/api, public", (340, 108))
    f.arrow([(250, 160), (250, 198)], ":8443", (243, 184), anchor="end")
    f.arrow([(370, 145), (312, 222)], "file + save", (347, 202), anchor="start", dashed=True, both=True)
    f.arrow([(382, 160), (312, 330)], "ORM", (356, 250), anchor="end")
    f.arrow([(445, 160), (445, 208)], "delay()", (452, 188), anchor="start")
    f.arrow([(445, 266), (445, 318)], "queue", (452, 296), anchor="start")
    f.arrow([(370, 252), (312, 348)])
    # externals
    f.text(645, 14, "called in-request", "tg")
    for i, (t, s) in enumerate([("Stripe", "workspace's own key"), ("Zoom", "create meeting"),
                                ("Anthropic", "AI note drafts"), ("AWS S3", "files · media")]):
        y = 20 + i * 48
        f.box(575, y, 140, 40, t, [s], kind="x")
        f.arrow([(520, 128), (573, y + 20)])
    f.text(645, 222, "called from Celery", "tg")
    for i, (t, s) in enumerate([("Google Calendar", "event sync · RSVP"), ("AWS SES (SMTP)", "all email"),
                                ("Twilio", "SMS reminders")]):
        y = 228 + i * 48
        f.box(575, y, 140, 40, t, [s], kind="x")
        f.arrow([(520, 238), (573, y + 20)])
    return figure(f, "Everything runs on one EC2 host. nginx is the only public entry point: it serves the built SPA, "
                     "proxies <code>/api</code> and the public token pages (<code>/invoices/pay</code>, <code>/contract/sign</code>, "
                     "<code>/session/…</code>, <code>/accounts</code>, <code>/django-admin</code>, <code>/static</code>) to gunicorn, "
                     "and exposes OnlyOffice on :8443. Payments, AI drafts, Zoom and file storage happen inside the request; "
                     "calendar sync, email and SMS go through Celery. Google also calls back in, via push notifications to "
                     "<code>/api/webhooks/google-calendar/</code>.")


def d_request_path():
    f = Fig("d2", 720, 250)
    stages = [
        ("nginx", ["TLS 1.2+", "route by path"], "b"),
        ("JWT auth", ["httpOnly cookie", "→ user + role"], "b"),
        ("Tenant scope", ["set_config(", "app.workspace_id)"], "b"),
        ("Demo guard", ["403 on writes in", "coachos-demo"], "b"),
        ("Permissions", ["role baseline", "+ TabPermission"], "b"),
        ("Queryset", ["filter(workspace=", "request workspace)"], "a"),
    ]
    xs = [1 + i * 122 for i in range(6)]
    for x, (t, s, k) in zip(xs, stages):
        f.box(x, 40, 108, 60, t, s, kind=k)
    for i in range(5):
        f.arrow([(xs[i] + 108, 70), (xs[i + 1] - 2, 70)])
    f.text(1, 22, "request →", "tg", "start")
    f.box(250, 170, 210, 52, "RLS policies · 12 tables", ["defined, but not enforced:", "app DB role bypasses RLS"], kind="r")
    f.box(500, 170, 218, 52, "PostgreSQL", ["isolation actually comes from", "the queryset filter"])
    f.arrow([(299, 100), (320, 168)], "sets session var", (316, 136), kind="r", dashed=True, anchor="start")
    f.arrow([(665, 100), (640, 168)], "SQL", (660, 138), anchor="start")
    f.line([(460, 196), (498, 196)], kind="r")
    return figure(f, "One API request, left to right. Every step can reject the request. Tenant isolation is enforced "
                     "by the last step: each viewset filters its queryset by the caller's workspace. The middleware also "
                     "sets a Postgres session variable for row-level-security policies, but the app connects as a "
                     "superuser role, so Postgres skips those policies (verified locally: <code>rolbypassrls = true</code>, "
                     "<code>relforcerowsecurity = false</code>). The portal scope also sets <code>app.client_id</code>.")


def d_identity():
    f = Fig("d3", 720, 300)
    rows = [
        ("Coach · owner · team", "Staff JWT", ["httpOnly cookie · 30 min + refresh", "idle logout at 30 min"],
         "/api/* (not portal)", ["role + per-tab permission"]),
        ("Client", "Portal JWT", ["email + 6-digit code · 24 h", "idle logout at 3 h"],
         "/api/portal/* only", ["own client_id + workspace_id"]),
        ("Anyone with the link", "Signed URL token", ["emailed, single purpose", "no login"],
         "Public pages", ["pay · sign · confirm/cancel/move"]),
        ("Platform admin", "Staff JWT", ["role = platform_admin"],
         "/api/superadmin/*", ["every workspace"]),
    ]
    for i, (who, cred, cs, reach, rs) in enumerate(rows):
        y = 8 + i * 72
        f.box(0, y, 150, 54, who, [])
        f.box(200, y, 230, 54, cred, cs, kind="a" if i == 1 else "b")
        f.box(490, y, 228, 54, reach, rs)
        f.arrow([(150, y + 27), (198, y + 27)])
        f.arrow([(430, y + 27), (488, y + 27)])
    f.arrow([(430, 50), (488, 92)], "401: wrong scope", (436, 74), kind="r", dashed=True, anchor="start")
    return figure(f, "Four identities, each issued differently and reaching a different slice of the API. A staff token "
                     "carries no <code>client_id</code> and a portal token carries <code>role=portal_client</code>, so "
                     "neither is accepted by the other side's authentication class. Public links carry a signed, "
                     "single-purpose token instead of a session.")


def d_data_model():
    f = Fig("d4", 720, 320)
    f.box(280, 4, 160, 44, "Workspace", ["tenant · branding"], kind="a")
    f.box(10, 86, 150, 44, "User", ["role · TabPermission"])
    f.box(280, 86, 160, 44, "Client", ["status · portal_access"], kind="a")
    f.box(560, 86, 158, 44, "Library", ["Folder → KnowledgeItem"])
    f.box(560, 4, 158, 44, "Config tables", ["stages · statuses · types"])
    f.arrow([(280, 30), (162, 92)], "has", (220, 52))
    f.arrow([(360, 48), (360, 84)], "has", (368, 70), anchor="start")
    f.arrow([(440, 30), (558, 30)], "has", (500, 24))
    f.arrow([(440, 108), (558, 108)], "shared with", (500, 102), dashed=True, both=True)
    kids = [("Activity", ["session · Zoom"]), ("Deal", ["pipeline stage"]), ("Invoice", ["or subscription"]),
            ("ClientGoal", ["shared? · status"]), ("ClientNote", ["topic · shared?"]),
            ("MessageDraft", ["email · contract"])]
    for i, (t, s) in enumerate(kids):
        x = 1 + i * 120
        f.box(x, 176, 108, 44, t, s)
        f.arrow([(360, 130), (x + 54, 174)])
    f.arrow([(60, 130), (40, 174)], "coach", (40, 156), anchor="end")
    grand = [(0, "Availability", ["weekly hours rule"]), (1, "StageHistory", ["+ DealProgress"]),
             (2, "Payment", ["+ InvoiceItem"]), (3, "GoalProgress", ["client/coach log"])]
    for col, t, s in grand:
        x = 1 + col * 120
        f.box(x, 262, 108, 44, t, s)
        f.arrow([(x + 54, 220), (x + 54, 260)])
    f.box(492, 262, 226, 44, "Also per client", ["Commitment · Assessment · EmailLog"])
    return figure(f, "Client is the hub. Sessions, deals, invoices, goals, notes and outbound documents all hang off a "
                     "client, and every one of these rows also carries <code>workspace_id</code>. Library items are "
                     "shared with clients many-to-many. Workspace-level configuration (pipeline stages, client statuses, "
                     "tags, lead sources, activity types, affiliations) lives in small per-workspace tables, seeded with "
                     "built-in defaults on first use.")


def d_session_states():
    f = Fig("d5", 720, 290)
    f.box(30, 14, 140, 44, "Completed", ["coach marks done"])
    f.box(30, 120, 140, 44, "Missed", ["coach: Mark Missed"])
    f.box(30, 226, 140, 44, "Cancelled", ["emails both sides"])
    f.box(275, 120, 150, 44, "Scheduled", ["reminders run here"], kind="a")
    f.box(530, 110, 188, 64, "Rescheduled", ["proposal staged in", "requested_start_at"])
    f.arrow([(275, 130), (172, 40)], "coach", (230, 76))
    f.arrow([(275, 142), (172, 142)], "coach", (224, 136))
    f.arrow([(275, 155), (172, 246)], "coach · client link", (236, 214), anchor="start")
    f.arrow([(425, 128), (528, 128)], "client asks to move", (476, 120))
    f.arrow([(528, 160), (427, 160)], "coach Confirm / Edit", (476, 178))
    f.arrow([(600, 174), (600, 210), (680, 210), (680, 176)], "Decline · TTL expiry", (640, 226))
    f.box(275, 226, 150, 44, "DB constraint", ["no overlapping slots", "per coach (EXCLUDE)"], kind="n")
    f.box(530, 14, 188, 56, "Google RSVP", ["sets client_rsvp_status,", "never changes status"], kind="n")
    return figure(f, "Session status lifecycle (<code>Activity.status</code>). A client-proposed time sits in "
                     "<code>requested_start_at</code> and only takes effect when the coach confirms. Confirm re-checks "
                     "that client's availability rules first, then moves the times, returns the session to Scheduled, "
                     "resets the reminder flags and re-syncs Google Calendar. Decline, or the daily 04:00 expiry once "
                     "the workspace's TTL passes (default 5 days), clears the proposal. A Postgres exclusion constraint "
                     "rejects any write that would overlap another active session for the same coach. The "
                     "<code>late</code> status exists in the model, but nothing sets it today.")


def d_reminders():
    f = Fig("d6", 720, 210)
    y = 120
    f.add(f'<line x1="20" y1="{y}" x2="700" y2="{y}" class="l-k"/>')
    for x in range(40, 700, 20):
        f.add(f'<line x1="{x}" y1="{y - 3}" x2="{x}" y2="{y + 3}" class="l-k thin"/>')
    for x, lab in [(120, "start − 24 h"), (520, "start − 1 h"), (590, "start_at"), (660, "end_at")]:
        f.add(f'<line x1="{x}" y1="{y - 10}" x2="{x}" y2="{y + 10}" class="l-k"/>')
        f.text(x, y + 26, lab, "tt" if x == 590 else "ts")
    f.add(f'<rect x="120" y="58" width="470" height="18" rx="4" class="k-a"/>')
    f.text(355, 71, "24 h reminder due: fires on the first 15-min tick inside this window", "ts")
    f.add(f'<rect x="520" y="84" width="70" height="18" rx="4" class="k-a"/>')
    f.text(555, 97, "1 h due", "ts")
    f.add(f'<rect x="590" y="58" width="110" height="44" rx="4" class="k-r"/>')
    f.text(645, 76, "nothing sent:", "ts")
    f.text(645, 89, "start_at ≤ now", "ts")
    f.text(20, 160, "ticks = Celery beat, every 15 min", "ts", "start")
    f.text(20, 176, "end_at is never read by the reminder job", "ts", "start")
    f.text(700, 160, "both overdue at once (e.g. booked 30 min ahead) → only the 1 h reminder sends", "ts", "end")
    f.text(700, 176, "flags reset when the time changes, so a moved session is reminded again", "ts", "end")
    return figure(f, "Reminder timing for one session (<code>tasks/reminders.py</code>). The rule is \"due by\", not "
                     "\"due at\": if Celery misses ticks, the reminder still sends late, as long as the session hasn't "
                     "started. Only <code>status = scheduled</code> sessions qualify. Email goes to the client (plus a "
                     "coach copy); SMS goes out if the client has a phone number. "
                     "<code>reminder_24h_sent</code> / <code>reminder_1h_sent</code> prevent duplicates, with a Redis key "
                     "as a second guard.")


def d_gcal():
    lanes = [(70, "Coach", "browser", "b"), (220, "Django", "API", "a"), (370, "Celery", "worker", "b"),
             (510, "Google Calendar", "coach's own", "x"), (650, "Client", "inbox", "b")]
    msgs = [
        (70, 230, 76, "save session", "k", False),
        (230, 390, 104, "sync_to_google…", "k", False),
        (390, 550, 132, "insert/patch event", "k", False),
        (390, 550, 160, "ensure watch channel", "k", False),
        (550, 660, 188, "invite", "k", False),
        (660, 550, 216, "Accept", "k", False),
        (550, 230, 246, "push → /api/webhooks/google-calendar/", "a", False),
        (230, 390, 274, "process_notification", "k", False),
        (390, 550, 302, "events.list(syncToken)", "k", False),
    ]
    f = sequence("d7", 720, lanes, msgs, 372,
                 notes=[(250, 318, 200, ["update client_rsvp_status;", "accepted → client_confirmed"], "n")])
    return figure(f, "Two-way Google Calendar sync. The coach's own calendar holds the event, with the client as an "
                     "attendee. When the client RSVPs, Google pushes a change notification. CoachOS then pulls only the "
                     "delta with a stored sync token and records the RSVP. Watch channels expire, so a 03:00 job renews "
                     "them. Each coach connects separately through OAuth. While the Google app is unverified, refresh "
                     "tokens die after 7 days (see Known gaps).")


def d_stripe():
    lanes = [(80, "Client", "browser", "b"), (330, "CoachOS", "Django", "a"), (600, "Stripe", "workspace's account", "x")]
    msgs = [
        (80, 330, 78, "GET /invoices/pay/<signed token>", "k", False),
        (330, 600, 106, "create Checkout Session (own secret key)", "k", False),
        (600, 330, 132, "session URL", "k", True),
        (330, 80, 158, "302 → Stripe Checkout", "k", False),
        (80, 600, 186, "pays on Stripe's hosted page", "k", False),
        (600, 80, 214, "redirect → success page", "k", True),
        (600, 330, 246, "webhook /api/invoices/stripe-webhook/<ws>/", "a", False),
    ]
    f = sequence("d8", 720, lanes, msgs, 318,
                 notes=[(350, 262, 230, ["verify with workspace webhook secret", "→ Payment row · invoice status · receipt"], "n")])
    return figure(f, "Getting paid. Card data only ever touches Stripe, and money lands in the workspace's own Stripe "
                     "account. CoachOS holds the secret and webhook keys Fernet-encrypted in "
                     "<code>Workspace.integrations</code>. The webhook URL includes the workspace id, so each signature is "
                     "checked against that workspace's secret. Refunds go both ways: an in-app refund calls Stripe's "
                     "Refund API, and a refund issued from the Stripe dashboard comes back through "
                     "<code>charge.refunded</code>. Both paths dedupe on <code>stripe_refund_ids</code>.")


def d_invoice_states():
    f = Fig("d9", 720, 220)
    row = [(0, "Draft"), (150, "Sent"), (300, "Partially paid"), (450, "Paid"), (600, "Refunded")]
    for x, t in row:
        f.box(x, 60, 118, 44, t, [], kind="a" if t == "Paid" else "b")
    f.arrow([(118, 82), (148, 82)])
    f.text(133, 50, "send", "ts")
    f.arrow([(268, 82), (298, 82)])
    f.arrow([(418, 82), (448, 82)])
    f.arrow([(568, 82), (598, 82)])
    f.text(583, 50, "refund", "ts")
    f.arrow([(209, 60), (209, 24), (509, 24), (509, 58)], "paid in full (webhook)", (359, 18))
    f.box(0, 160, 118, 44, "Void", ["auto-archived"])
    f.box(150, 160, 118, 44, "Overdue", ["06:00 daily job"], kind="r")
    f.arrow([(59, 104), (59, 158)], "void", (66, 136), anchor="start")
    f.arrow([(209, 104), (209, 158)], "past due, $0 paid", (216, 136), anchor="start")
    f.arrow([(268, 182), (509, 182), (509, 106)], "paid late", (390, 176))
    f.box(560, 160, 158, 44, "Subscription", ["07:00: next period → Sent"], kind="n")
    return figure(f, "Invoice lifecycle. Sending emails the PDF (WeasyPrint) with a Stripe pay link. The 06:00 job flips "
                     "Sent invoices with no payment at all past their due date to Overdue. The 07:00 job generates and "
                     "sends the next period's invoice for subscriptions with auto-send on. Line items can come from the "
                     "workspace's service catalog.")


def d_pipeline():
    f = Fig("d10", 720, 230)
    y = 40
    f.add(f'<line x1="20" y1="{y}" x2="700" y2="{y}" class="l-k"/>')
    for x, lab in [(20, "stage_changed_at"), (200, "+ follow_up_days"), (620, "alert stop")]:
        f.add(f'<line x1="{x}" y1="{y - 8}" x2="{x}" y2="{y + 8}" class="l-k"/>')
        f.text(x, y - 14, lab, "ts", "start" if x == 20 else "middle")
    f.add(f'<rect x="200" y="{y - 5}" width="420" height="10" rx="3" class="k-a"/>')
    f.text(410, y + 22, "alert window: deal overdue in its stage", "ts")
    rows = [("Owner", "daily", list(range(220, 620, 34)), "internal alert"),
            ("Assigned coach", "every Monday", list(range(232, 620, 119)), "internal alert"),
            ("Client", "monthly, the 15th", [300], "check-in email")]
    for i, (who, sched, dots, what) in enumerate(rows):
        yy = 96 + i * 44
        f.text(20, yy + 4, who, "tt", "start")
        f.text(20, yy + 18, sched, "ts", "start")
        f.add(f'<line x1="200" y1="{yy}" x2="620" y2="{yy}" class="l-k thin" stroke-dasharray="2 4"/>')
        for d in dots:
            f.add(f'<circle cx="{d}" cy="{yy}" r="4.5" class="k-a"/>')
        f.text(632, yy + 4, what, "ts", "start")
    return figure(f, "Stalled-deal follow-ups. Each pipeline stage sets <code>follow_up_days</code>, an optional stop, "
                     "and a separate on/off and schedule (daily, a weekday, or a day of the month) for each recipient. "
                     "The beat job runs hourly and handles each workspace at 08:00 in its own timezone. The owner and "
                     "coach receive the internal alert. The client receives a separate, editable check-in "
                     "(<code>pipeline_client</code>). A per-deal stop date overrides the stage's stop.")


def d_email():
    f = Fig("d11", 720, 360)
    f.box(0, 14, 160, 76, "Request-time events", ["booking · move · cancel", "invoice · receipt · invite", "goal/note shared · signed"])
    f.box(0, 118, 160, 50, "Celery beat jobs", ["reminders · invoices", "pipeline follow-ups"])
    f.box(0, 250, 160, 50, "Security mail", ["portal code", "password reset"], kind="r")
    f.box(190, 40, 140, 64, "Render", ["template per use case", "or built-in default", "+ workspace branding"])
    f.box(352, 46, 120, 52, "send_logged()", ["one send path"], kind="a")
    f.box(494, 46, 134, 52, "DemoSafe backend", ["drops demo-only mail"])
    f.box(650, 46, 70, 52, "AWS SES", ["SMTP"], kind="x")
    f.box(352, 160, 120, 52, "EmailLog", ["status + error", "HTML snapshot"])
    f.box(190, 160, 140, 52, "email_forecast", ["next 30–90 days"])
    f.box(337, 262, 150, 50, "Email Comms page", ["Sent · Scheduled · Failed"])
    f.arrow([(160, 52), (188, 62)])
    f.arrow([(160, 143), (188, 90)])
    f.arrow([(330, 72), (350, 72)])
    f.arrow([(472, 72), (492, 72)])
    f.arrow([(628, 72), (648, 72)])
    f.arrow([(412, 98), (412, 158)], "writes row", (420, 132), anchor="start")
    f.arrow([(412, 212), (412, 260)], "Sent / Failed", (420, 240), anchor="start")
    f.arrow([(80, 168), (80, 186), (188, 186)], "same rules", (134, 180))
    f.arrow([(300, 212), (335, 278)], "Scheduled", (310, 254), anchor="end")
    f.arrow([(260, 160), (260, 106)], "preview (dry run)", (266, 138), kind="a", dashed=True, anchor="start")
    f.arrow([(160, 275), (230, 275), (230, 340), (561, 340), (561, 100)], "bypasses the log: carries one-time secrets",
            (400, 334), kind="r")
    return figure(f, "Every workspace email goes through <code>send_logged()</code>. It sends through the configured "
                     "backend and records the result, so failed sends show up with their error and a new email type "
                     "can't skip the log. The Scheduled tab is computed live from the same rules the beat jobs use, so "
                     "it can't drift. A preview runs the real send code inside <code>capture_emails()</code> and a "
                     "rolled-back transaction, which sends and saves nothing. Portal login codes and password resets "
                     "skip the log on purpose. In production every message still passes the demo-safe backend.")


def d_portal_login():
    lanes = [(90, "Client", "portal SPA", "b"), (380, "Django", "portal API", "a"), (630, "Client inbox", "", "x")]
    msgs = [
        (90, 380, 78, "POST /api/portal/request-code {email}", "k", False),
        (380, 630, 106, "6-digit code, 10 min", "k", False),
        (380, 90, 134, "same reply whether or not the email matches", "k", True),
        (90, 380, 166, "POST /api/portal/login {email, code}", "k", False),
        (380, 90, 236, "portal JWT · 24 h · role=portal_client", "a", False),
    ]
    f = sequence("d12", 720, lanes, msgs, 262,
                 notes=[(400, 176, 240, ["SHA-256 hash · constant-time compare", "5 attempts · single use"], "n")])
    return figure(f, "Client portal sign-in is two steps. Before 2026-09-30, the email alone was enough to sign in, which "
                     "was an authentication bypass. Only clients with <code>portal_access</code> receive a code. Throttles "
                     "are 5/min to request a code and 10/min to log in, and the identical reply prevents email "
                     "enumeration. The code email is deliberately kept out of the coach-visible email log.")


def d_onlyoffice():
    lanes = [(80, "Coach", "browser", "b"), (290, "OnlyOffice", ":8443", "x"), (500, "Django", "library API", "a"),
             (650, "S3", "files", "x")]
    msgs = [
        (80, 500, 78, "edit-config (JWT-signed)", "k", False),
        (80, 290, 106, "open editor", "k", False),
        (290, 500, 134, "GET onlyoffice-file (JWT)", "k", False),
        (500, 650, 160, "read", "k", False),
        (80, 290, 188, "live edits", "k", True),
        (290, 500, 216, "save callback (JWT verified)", "a", False),
        (500, 650, 242, "write new version", "k", False),
    ]
    f = sequence("d13", 720, lanes, msgs, 262)
    return figure(f, "Library and assessment documents open in a self-hosted OnlyOffice server. Every hop between "
                     "OnlyOffice and Django is signed with <code>ONLYOFFICE_JWT_SECRET</code> in both directions, because "
                     "the document server calls Django directly without a user session. Items are shared with chosen "
                     "clients and appear in their portal's Files tab.")


def d_integrations():
    f = Fig("d14", 720, 290)
    cols = [
        (0, "Per-coach OAuth", "Google Calendar · Zoom (target)",
         [("Each coach clicks Connect", "b"), ("allauth SocialToken", "b"), ("acts as that coach", "a")],
         ["Google consent screen", "one row per user", "their calendar / meetings"]),
        (245, "Per-workspace key", "Stripe",
         [("Owner pastes keys once", "b"), ("Workspace.integrations", "b"), ("workspace's own account", "a")],
         ["Settings → Integrations", "Fernet-encrypted", "funds never touch CoachOS"]),
        (490, "Platform credential", "SES · Twilio · Anthropic · S3 · Zoom S2S",
         [("Operator sets .env", "b"), ("server environment", "b"), ("one shared identity", "r")],
         ["on the EC2 host", "not per tenant", "Zoom S2S pools meetings"]),
    ]
    for x, title, who, steps, subs in cols:
        f.text(x + 115, 16, title, "tt")
        f.text(x + 115, 32, who, "ts")
        for i, ((t, k), s) in enumerate(zip(steps, subs)):
            y = 48 + i * 82
            f.box(x, y, 230, 50, t, [s], kind=k)
            if i:
                f.arrow([(x + 115, y - 32), (x + 115, y - 2)])
    return figure(f, "Three credential patterns, compared on whose identity the external call uses. Zoom is mid-"
                     "migration: the per-coach OAuth path is built but blocked by a Zoom-side \"Invalid redirect\" error, "
                     "so production runs the interim Server-to-Server path (<code>ZOOM_OAUTH_ENABLED=False</code>). That "
                     "creates every workspace's meetings under one platform Zoom account. This is acceptable with one "
                     "real workspace; it should be revisited before a second one joins.")


def d_demo():
    f = Fig("d15", 720, 262)
    f.box(0, 8, 160, 44, "Visitor", ["/ or /login"])
    f.box(0, 98, 160, 56, "Lead gate", ["name + email → DemoLead", "(superadmin list)"])
    f.box(0, 198, 160, 50, "Demo login", ["shared owner account"], kind="a")
    f.arrow([(80, 52), (80, 96)])
    f.arrow([(80, 154), (80, 196)])
    rows = [("API writes", "DemoReadOnly middleware", ("403", "friendly message")),
            ("Scheduled email", "DemoSafeEmailBackend", ("dropped", "if every recipient is demo")),
            ("SMS reminders", "send_session_reminder", ("skipped", "coachos-demo workspace")),
            ("Portal preview", "/api/portal/demo-login", ("fixed client", "writes still 403"))]
    for i, (c, g, (ot, os_)) in enumerate(rows):
        y = 8 + i * 64
        f.box(195, y, 120, 44, c, [])
        f.box(345, y, 170, 44, g, [], kind="a")
        f.box(545, y, 173, 44, ot, [os_])
        f.arrow([(160, 223), (193, y + 22)])
        f.arrow([(315, y + 22), (343, y + 22)])
        f.arrow([(515, y + 22), (543, y + 22)])
    return figure(f, "The public demo shares one seeded workspace (<code>coachos-demo</code>) among all visitors. Four "
                     "independent guards stop it from changing data or reaching real inboxes. Each covers a path the "
                     "others can't see: HTTP middleware never sees Celery jobs, and the email backend never sees SMS. "
                     "Re-running <code>seed_demo_workspace</code> resets the data and is idempotent.")


# ── Document ──────────────────────────────────────────────────────────────────
CSS = """
@page { size: Letter; margin: 0.6in 0.6in 0.7in;
  @bottom-left { content: "CoachOS · Architecture & Design"; font: 8pt -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #8a909b; }
  @bottom-right { content: counter(page) " / " counter(pages); font: 8pt -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #8a909b; } }
@page :first { @bottom-left { content: none; } @bottom-right { content: none; } }
:root { --ink:#1d2633; --muted:#5d6675; --rule:#dfe2e7; --navy:#1a2f4e; --gold:#a87b22; --gold-bg:#fbf2dc;
  --red:#b23a3a; --red-bg:#fbecec; --ext:#44607f; --ext-bg:#eef3f8; --paper:#f6f4ef; }
* { box-sizing: border-box; }
body { margin:0; background:#fff; color:var(--ink); font: 10pt/1.5 -apple-system, 'Helvetica Neue', Arial, sans-serif;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: 26pt; line-height:1.15; color: var(--navy); margin: 0 0 6pt; letter-spacing:-.01em; }
h2 { font-size: 15pt; color: var(--navy); margin: 0 0 8pt; padding-top: 2pt; break-after: avoid; }
h2 .n { color: var(--gold); margin-right: 6pt; }
h3 { font-size: 11pt; color: var(--navy); margin: 14pt 0 4pt; break-after: avoid; }
section { break-before: page; }
section.cont { break-before: auto; margin-top: 18pt; }
p { margin: 0 0 7pt; }
ul { margin: 0 0 8pt; padding-left: 16pt; } li { margin: 0 0 3pt; }
code { font: 8.6pt/1.3 'SF Mono', Menlo, monospace; background:#f1f2f4; padding: 0 2pt; border-radius: 2pt; }
table { width:100%; border-collapse: collapse; margin: 4pt 0 10pt; font-size: 8.8pt; break-inside: auto; }
th { text-align:left; color: var(--muted); font-weight:600; border-bottom: 1.2pt solid var(--navy); padding: 4pt 6pt 3pt 0; }
td { border-bottom: .6pt solid var(--rule); padding: 4pt 6pt 4pt 0; vertical-align: top; }
tr { break-inside: avoid; }
td:first-child { font-weight: 600; white-space: nowrap; }
figure { margin: 8pt 0 12pt; break-inside: avoid; }
figure svg { width:100%; height:auto; display:block; color: var(--ink); }
figcaption { font-size: 8.6pt; color: var(--muted); margin-top: 6pt; border-left: 2pt solid var(--gold); padding-left: 7pt; }
.lede { font-size: 11.5pt; color: #39424f; max-width: 6.2in; }
.meta { color: var(--muted); font-size: 9pt; margin: 8pt 0 12pt; }
.stats { display:flex; gap: 10pt; margin: 10pt 0 12pt; }
.stat { flex:1; border-top: 2pt solid var(--gold); padding-top: 5pt; }
.stat b { display:block; font-size: 18pt; color: var(--navy); line-height:1.1; }
.stat span { font-size: 8.5pt; color: var(--muted); }
.toc { columns: 2; column-gap: 24pt; font-size: 9.5pt; padding-left: 16pt; }
.toc li { margin-bottom: 3pt; }
.callout { border: 1pt solid var(--red); background: var(--red-bg); border-radius: 4pt; padding: 7pt 9pt; margin: 6pt 0 10pt; font-size: 9.2pt; }
.callout.note { border-color: var(--gold); background: var(--gold-bg); }
.pill { display:inline-block; font-size:7.6pt; font-weight:600; padding: 0 5pt; border-radius: 8pt; background:#eef0f3; color:#39424f; }
.pill.r { background: var(--red-bg); color: var(--red); } .pill.a { background: var(--gold-bg); color: var(--gold); }
/* SVG vocabulary */
svg text { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; fill: currentColor; }
.tt { font-size: 12px; font-weight: 600; }
.ts { font-size: 10.5px; fill: #5d6675; }
.tg { font-size: 10.5px; font-weight: 600; fill: #8a909b; letter-spacing: .02em; }
.tl { font-size: 10.5px; fill: #1d2633; paint-order: stroke; stroke: #fff; stroke-width: 3.5px; stroke-linejoin: round; }
.tl-a { fill: #8a6518; } .tl-r { fill: #b23a3a; }
.k-b { fill: #f6f4ef; stroke: #2b3442; stroke-width: 1.1; }
.k-a { fill: #fbf2dc; stroke: #a87b22; stroke-width: 1.6; }
.k-r { fill: #fbecec; stroke: #b23a3a; stroke-width: 1.3; stroke-dasharray: 5 3; }
.k-x { fill: #eef3f8; stroke: #44607f; stroke-width: 1.1; }
.k-n { fill: #fff; stroke: #9aa1ab; stroke-width: 1; stroke-dasharray: 2 3; }
.k-g { fill: none; stroke: #9aa1ab; stroke-width: 1.1; stroke-dasharray: 6 4; }
.l-k, .l-a, .l-r, .l-x { fill: none; stroke-width: 1.3; }
.l-k { stroke: #2b3442; } .l-a { stroke: #a87b22; stroke-width: 1.8; } .l-r { stroke: #b23a3a; } .l-x { stroke: #44607f; }
.thin { stroke-width: .8; stroke: #9aa1ab; }
.m-k { fill: #2b3442; } .m-a { fill: #a87b22; } .m-r { fill: #b23a3a; } .m-x { fill: #44607f; }
"""


def table(head, rows):
    h = "".join(f"<th>{c}</th>" for c in head)
    b = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows)
    return f"<table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>"


def build():
    S = []  # sections
    S.append(f"""
<div class="cover">
  <p class="tg" style="font-weight:600;color:#a87b22;letter-spacing:.08em;font-size:9pt;margin-bottom:10pt">ARCHITECTURE &amp; DESIGN</p>
  <h1>CoachOS</h1>
  <p class="lede">Practice-management SaaS for independent coaches and small coaching firms. One workspace-scoped
  system of record for clients, sessions, the sales pipeline, invoicing, documents and email, plus a branded
  self-serve portal for the coach's own clients.</p>
  <p class="meta">Reviewed from source on {AS_OF} · production: coachos.rass-consulting.com · supersedes the
  architecture sections of <code>system_design.md</code> (Aug 29) and the "no AI" note in <code>CLAUDE.md</code></p>
  <div class="stats">
    <div class="stat"><b>12</b><span>Django apps</span></div>
    <div class="stat"><b>42</b><span>data models</span></div>
    <div class="stat"><b>4</b><span>identity scopes</span></div>
    <div class="stat"><b>8</b><span>scheduled jobs</span></div>
    <div class="stat"><b>7</b><span>external services</span></div>
  </div>
  <h3>Contents</h3>
  <ol class="toc">
    <li>Product and roles</li><li>System architecture</li><li>Request path and tenant isolation</li>
    <li>Identity and access</li><li>Feature map</li><li>Data model</li><li>Scheduling and calendar</li>
    <li>Billing and payments</li><li>Sales pipeline</li><li>Email and notifications</li><li>Client portal</li>
    <li>Library, documents and contracts</li><li>AI session-note drafts</li><li>Integrations</li>
    <li>Background jobs</li><li>Public demo</li><li>Platform admin and observability</li>
    <li>Operations</li><li>Known gaps and risks</li>
  </ol>
</div>""")

    S.append(f"""<section class="cont"><h2><span class="n">1</span>Product and roles</h2>
<p>Coaches today juggle notes in Notion or Docs, Calendly plus Google Calendar, Stripe plus QuickBooks, and a pipeline
spreadsheet. CoachOS replaces that set with one system per <b>workspace</b>, which is the tenant boundary. A user
belongs to exactly one workspace. Their role sets a baseline, and the owner can widen or narrow it per section.</p>
{table(["Role", "Scope", "How it's enforced"], [
    ["business_owner", "Everything in the workspace: billing, team, integrations, Email Communication", "Role checks on viewsets; owner-only routes via <code>RoleRoute</code>"],
    ["coach", "Own clients and schedule; more sections if granted", "<code>TabPermission</code> view / edit / delete per section"],
    ["assistant · limited", "Operational, then further-restricted access", "Same per-tab overrides"],
    ["platform_admin", "Crosses workspaces: CoachOS's own console", "<code>IsPlatformAdmin</code> on <code>/api/superadmin/*</code>"],
    ["portal_client", "The coach's client, in the self-serve portal only", "Separate JWT scope (see §4)"],
])}
<p>The frontend mirrors these rules: <code>TabRoute</code> and <code>RoleRoute</code> wrap every gated page, so a role that
would get a 403 never sees the UI in the first place.</p></section>""")

    S.append(f"""<section><h2><span class="n">2</span>System architecture</h2>
<p>Everything runs on a single host. Tenancy is purely an application and data-layer concern; there is no per-tenant
infrastructure.</p>
{d_deployment()}
{table(["Container", "Role", "Notes"], [
    ["nginx", "TLS termination, path routing, static files", "Config bind-mounted from <code>nginx/nginx.conf</code>; <code>^~ /static/</code> must win over the SPA's <code>*.css|*.js</code> rule"],
    ["backend", "Django 5 + DRF on gunicorn (2 workers)", "Entrypoint runs migrations and <code>collectstatic</code> before serving"],
    ["celery · celery-beat", "Async tasks; <code>DatabaseScheduler</code>", "Schedule defined in <code>CELERY_BEAT_SCHEDULE</code>, live copy in Django admin → Periodic tasks"],
    ["db · redis", "PostgreSQL; Celery broker and Django cache", "Task results stored in Postgres (<code>django-db</code>)"],
    ["onlyoffice", "Document Server for in-browser Word/Excel/PPT", "Separate server block on :8443"],
    ["frontend", "Builds the React 18 + Vite SPA into a shared volume", "Zustand auth store, React Query, Tailwind, FullCalendar, Recharts, driver.js"],
])}</section>""")

    S.append(f"""<section><h2><span class="n">3</span>Request path and tenant isolation</h2>
<p>All workspaces share one database. A request becomes tenant-scoped by passing the chain below. Each workspace-owned
model inherits <code>WorkspaceModel</code> and carries a <code>workspace</code> foreign key.</p>
{d_request_path()}
<div class="callout"><b>Design risk: only one isolation layer.</b> The RLS policies (<code>tenant_isolation</code>, plus
<code>portal_isolation</code> on goals) look like a second line of defence, but they don't run: the application connects
as the table owner with <code>BYPASSRLS</code>, and the tables don't use <code>FORCE ROW LEVEL SECURITY</code>. A single
viewset that forgets its workspace filter would leak across tenants. Fix: connect as a non-owner role without
<code>BYPASSRLS</code> (or add <code>FORCE</code>), then cover the remaining workspace tables. Test with two workspaces
before rollout, because Celery tasks and management commands run without the request middleware.</div>
<p>The <code>DemoWorkspaceReadOnlyMiddleware</code> sits right after the tenant middleware. It is real Django
middleware, not a DRF default permission, because most viewsets declare their own <code>permission_classes</code>, which
would silently replace a global default. Login, logout, refresh, demo-lead capture and the portal demo-login are
exempt.</p></section>""")

    S.append(f"""<section><h2><span class="n">4</span>Identity and access</h2>
{d_identity()}
{table(["Control", "Setting"], [
    ["Throttles", "anon 200/h · user 2000/h · login 10/min · password reset 5/min · register 5/h · portal code 5/min · demo lead 30/h · portal demo-login 20/min"],
    ["Idle logout", "Staff: warn at 15 min, log out at 30 min (all roles). Portal: warn at 2 h 45 m, log out at 3 h"],
    ["Signup", "Invite-only workspace creation through one-time <code>WorkspaceRegistrationToken</code> links issued by a platform admin; team members join through <code>WorkspaceInvitation</code> (failed invite emails retried every 5 min)"],
    ["Audit", "<code>AccessLog</code> records view/create/update/delete on clients, notes, goals, files and team, plus password changes and AI-draft requests"],
    ["Secrets at rest", "Stripe secret/webhook keys Fernet-encrypted with <code>FIELD_ENCRYPTION_KEY</code> (comma list, rotation-ready); OAuth tokens stored server-side only"],
])}</section>""")

    S.append(f"""<section><h2><span class="n">5</span>Feature map</h2>
<p>Every user-facing capability, grouped by the Django app that owns it.</p>
{table(["App", "Features", "Pages"], [
    ["accounts", "Login/logout, password reset, invite-only registration, team invites and per-tab permissions, profile, Google Calendar and Zoom connect", "Login, Register, AcceptInvite, Forgot/Reset, Team"],
    ["clients", "CRM with configurable statuses, tags, lead sources and affiliations; CSV import/export; session notes with topic, date, search and sharing (+ AI drafts); goals with progress and sharing; commitments; assessments in OnlyOffice; client messages and contract e-signing; coach availability rules; email log", "Clients, NewClient, ClientDetail, EmailCommunication"],
    ["activities", "Calendar and list across 8 built-in, configurable activity types; recurrence (daily, weekly, biweekly, monthly, yearly; capped at 1 year ahead without an end date); overlap prevention; reminders; client confirm/cancel/reschedule links with slot picker; Confirm/Decline of proposals; Zoom links; Google Calendar 2-way sync", "Calendar, Activities"],
    ["pipeline", "Kanban of deals across 8 configurable stages; stage history and progress; per-stage, per-recipient follow-up schedules", "Pipeline, NewDeal"],
    ["invoicing", "One-time and subscription invoices; service catalog; PDF; Stripe Checkout pay links; partial payments; refunds; auto-Overdue; auto-archived Void; receipts", "Invoices, NewInvoice, InvoiceDetail"],
    ["reports", "Revenue and outstanding reports, CSV export, dashboard KPIs", "Reports, Dashboard"],
    ["library", "Folders and documents, OnlyOffice live editing, per-client sharing, PDF conversion", "Library"],
    ["portal", "Client self-serve: overview, goals (own CRUD + mark coach goals complete), sessions + reschedule request, notes, files, invoices + pay", "/client-portal"],
    ["settings_app", "Workspace branding and timezone; taxonomies; pipeline stages and follow-ups; services; email templates per use case; integrations; reschedule TTL", "Settings (12 tabs)"],
    ["feedback", "Bug/feature tickets with comments between team and owner, plus a floating report button", "Feedback list/detail"],
    ["audit", "Per-action audit trail (owner sees the last 100)", "Settings"],
    ["superadmin", "Workspace list and drill-down, users, errors, audit, email diagnostics and resend, registration tokens, maintenance banners, manual platform invoices, demo leads", "/admin"],
])}
<p class="ts" style="color:#5d6675">Public, unauthenticated pages: marketing home, privacy policy, terms, invoice pay +
success, contract sign, and session confirm/cancel/reschedule.</p></section>""")

    S.append(f"""<section><h2><span class="n">6</span>Data model</h2>{d_data_model()}
<p>Supporting tables: <code>GoogleCalendarWatch</code> (per-coach push channel), <code>PortalLoginCode</code>,
<code>EmailLog</code>, <code>AccessLog</code> and <code>AuditLog</code>, <code>ErrorLog</code>, <code>FeedbackTicket</code>,
and platform-level <code>DemoLead</code>, <code>MaintenanceBanner</code> and <code>PlatformInvoice</code>/<code>Payment</code>.</p></section>""")

    S.append(f"""<section><h2><span class="n">7</span>Scheduling and calendar</h2>
<p>A session is an <code>Activity</code> with a coach, a client and one of 8 built-in, renameable types (appointment,
session, call, task, training, travel, client communication, custom). Recurring series are written out as real rows linked by <code>recurrence_id</code>, up to <code>repeat_until</code>
or one year ahead.</p>
{d_session_states()}
<h3>Self-serve rescheduling</h3>
<p>The emailed reschedule link offers a slot picker built from that client's <code>CoachAvailabilityRule</code>s. It
checks busy time against the coach's confirmed sessions <i>and</i> every other client's pending proposal, so two
clients can't claim the same slot. Without availability rules, the link falls back to a free-text request. The portal's
reschedule request is always free text.</p>
{d_reminders()}
{d_gcal()}
<p><b>Zoom.</b> From Calendar or a client record, the coach clicks to create a meeting. The call happens in the request
and stores <code>join_url</code> on the session. The integration subscribes to no Zoom webhooks and keeps no other Zoom
data.</p></section>""")

    S.append(f"""<section><h2><span class="n">8</span>Billing and payments</h2>{d_stripe()}{d_invoice_states()}
<p>CoachOS's own billing of its workspaces is a separate system. <code>dj-stripe</code> is installed, but
<code>PlatformInvoice</code> billing is done by hand from the superadmin console.</p></section>""")

    S.append(f"""<section><h2><span class="n">9</span>Sales pipeline</h2>
<p>Deals move through workspace-configurable stages: Lead – New → Discovery Scheduled → Discovery Completed → Proposal
Sent → Verbal Yes → Active Client, plus On Hold and Closed – Lost. Every move writes <code>StageHistory</code>. Creating
a deal from the New Client form is opt-in.</p>
{d_pipeline()}</section>""")

    S.append(f"""<section><h2><span class="n">10</span>Email and notifications</h2>{d_email()}
{table(["Audience", "Use cases (each editable in Settings → Emails, branded with logo)"], [
    ["Client", "booking confirmation · reschedule · cancellation · 24 h and 1 h reminders · invoice · payment receipt · portal invite · client message/contract · goal shared · note shared · reschedule acknowledgement · decline · pipeline check-in"],
    ["Coach / owner", "session booked/updated/cancelled/reminder copies · client confirmed/cancelled/RSVP · reschedule request · payment failed · contract signed · pipeline follow-up"],
    ["Team", "team invite"],
])}
<p><b>SMS</b> (Twilio, optional) sends session reminders when the client has a phone number. <b>Mail transport</b> is
AWS SES over SMTP in production and Mailpit locally. In production, <code>DemoSafeEmailBackend</code> wraps SMTP.</p></section>""")

    S.append(f"""<section><h2><span class="n">11</span>Client portal</h2>{d_portal_login()}
{table(["Tab", "What the client can do"], [
    ["Overview", "Goals due, upcoming sessions, outstanding invoices"],
    ["Goals", "Create, edit, delete and search their own goals; log progress; mark coach-shared goals complete or reopen them"],
    ["Activities", "Upcoming and past sessions (internal coach notes excluded); request a reschedule"],
    ["Notes", "Own notes (CRUD, search by topic/date); read notes the coach shared"],
    ["Files", "View and download library items shared with them"],
    ["Invoices", "View, download and pay through Stripe Checkout"],
])}
<p>Out of scope by design: assessments, messaging and contracts (contracts use their own signed link). Branding shows
the workspace's logo and name.</p></section>""")

    S.append(f"""<section><h2><span class="n">12</span>Library, documents and contracts</h2>{d_onlyoffice()}
<p><b>Contracts and client messages.</b> A <code>ClientMessageDraft</code> is emailed with optional attachments from S3.
If it needs a signature, the client signs at a public <code>/contract/sign/&lt;token&gt;/</code> link. The draft then
becomes <code>signed</code> and the coach receives a <code>contract_signed</code> notice.</p>
<h3><span class="n" style="color:#a87b22">13</span> AI session-note drafts</h3>
<p>On a structured session note, <b>Suggest with AI</b> sends the coach's raw notes to Anthropic through
<code>POST /api/clients/{{id}}/notes/suggest/</code> and returns a drafted Coach Reflection and Commitment. Nothing is
stored server-side: the coach accepts or rejects each field and saves through the normal note endpoints. Each request
is audit-logged. Without <code>ANTHROPIC_API_KEY</code>, the endpoint returns a clear 400; <code>AI_NOTES_MOCK</code> is
for development only.</p></section>""")

    S.append(f"""<section><h2><span class="n">14</span>Integrations</h2>{d_integrations()}
{table(["Service", "Pattern", "Used for", "Failure mode"], [
    ["Google Calendar", "Per-coach OAuth", "Event sync, RSVP push", "Unverified app → weekly token expiry"],
    ["Zoom", "S2S today; OAuth built", "Create meeting, store join URL", "Shared account while OAuth is blocked"],
    ["Stripe", "Per-workspace key", "Checkout, refunds, webhooks", "Lost <code>FIELD_ENCRYPTION_KEY</code> = undecryptable keys"],
    ["AWS SES", "Platform SMTP", "All email", "Failures recorded in EmailLog"],
    ["Twilio", "Platform", "SMS reminders", "Optional; skipped without a phone number"],
    ["Anthropic", "Platform key", "Session-note drafts", "400 without a key"],
    ["AWS S3", "Platform (IAM role or keys)", "Files, media, attachments", "Presigned URLs expire after 30 min"],
])}</section>""")

    S.append(f"""<section><h2><span class="n">15</span>Background jobs</h2>
{table(["Job", "When (UTC)", "What it does"], [
    ["dispatch-activity-reminders", "every 15 min", "24 h / 1 h email + SMS reminders (§7)"],
    ["retry-pending-invites", "every 5 min", "Re-sends team invites whose first email failed"],
    ["check-site-health", "every 30 min", "Site reachability + TLS expiry; emails an alert (expiry alerts de-duplicated daily)"],
    ["dispatch-pipeline-alerts", "hourly", "Acts at 08:00 in each workspace's timezone (§9)"],
    ["renew-calendar-watch-channels", "03:00", "Renews expiring Google push channels"],
    ["expire-stale-reschedule-requests", "04:00", "Clears proposals older than the workspace TTL"],
    ["mark-overdue-invoices", "06:00", "Sent + unpaid + past due → Overdue"],
    ["dispatch-subscription-invoices", "07:00", "Generates and sends the next subscription period"],
])}
<p>Where to see them: Django admin → <b>Periodic tasks</b> (live state, last run) and <b>Task results</b> (history). The
code schedule is in <code>config/settings/base.py</code>. Logs: <code>make logs-celery</code> in production.</p></section>""")

    S.append(f"""<section class="cont"><h2><span class="n">16</span>Public demo</h2>
<p>"Log In as Demo User &amp; Take the Tour" on <code>/</code> and <code>/login</code> runs a router-aware driver.js tour
across every area: an intro, Dashboard, Clients, Pipeline, Calendar, Invoices, Email Communication ×3, Library, Reports,
Settings ×2 and Team. It ends by opening the client portal as a seeded client. Real users get the same tour from the
Dashboard, without the portal step.</p>
{d_demo()}</section>""")

    S.append(f"""<section class="cont"><h2><span class="n">17</span>Platform admin and observability</h2>
<ul>
<li><b>Superadmin console</b> (<code>/admin</code>): workspaces with plan/suspend, users and password resets, per-workspace errors and audit log, email diagnostics with resend, registration tokens, maintenance banners (shown to every user through <code>/api/system/banner/</code>), feedback triage, manual platform invoices, and demo leads.</li>
<li><b>Errors:</b> unhandled 500s from DRF views go to <code>ErrorLog</code>. Sentry is enabled when <code>SENTRY_DSN</code> is set. Non-DRF views (allauth, public pay/sign/session pages) only reach container logs and Sentry.</li>
<li><b>Health:</b> the 30-minute site and certificate check runs from inside the host. It was added after a certbot renewal failed silently in September 2026.</li>
<li><b>Django admin</b> at <code>/django-admin/</code> for raw data, periodic tasks and task results.</li>
</ul></section>""")

    S.append(f"""<section class="cont"><h2><span class="n">18</span>Operations</h2>
{table(["", "Local", "Production"], [
    ["Start", "<code>docker compose up --build</code>", "<code>git pull</code> → <code>make deploy</code> / <code>deploy-backend</code> / <code>deploy-frontend</code>"],
    ["Compose file", "<code>docker-compose.yml</code>", "<code>docker-compose.prod.yml</code> (always)"],
    ["Settings", "<code>config.settings.local</code> (DEBUG)", "<code>config.settings.production</code>"],
    ["Frontend", "Vite on :5173, proxying <code>/api</code>, <code>/accounts</code>, <code>/django-admin</code>, <code>/static</code>", "Static build served by nginx"],
    ["Email", "Mailpit (nothing leaves the machine)", "SES SMTP behind <code>DemoSafeEmailBackend</code>"],
    ["Files", "MinIO (S3-compatible)", "AWS S3, private, presigned"],
    ["TLS", "none", "Let's Encrypt via certbot webroot"],
])}
<p><b>Keys to back up:</b> <code>SECRET_KEY</code> and <code>FIELD_ENCRYPTION_KEY</code>. Losing the second makes every
stored Stripe key undecryptable, and it must never be shared between environments. Schema changes ship as Django
migrations, which the backend entrypoint applies on start.</p></section>""")

    S.append(f"""<section><h2><span class="n">19</span>Known gaps and risks</h2>
{table(["", "Gap", "Impact", "Suggested next step"], [
    ['<span class="pill r">high</span>', "RLS policies not enforced (§3)", "Tenant isolation depends on every queryset filter being right", "Non-owner DB role or <code>FORCE RLS</code>; extend to all workspace tables"],
    ['<span class="pill r">high</span>', "Google OAuth app in Testing status", "Every coach's calendar connection silently dies weekly", "Complete Google verification for the Calendar scope"],
    ['<span class="pill a">med</span>', "Zoom on shared S2S account", "All workspaces' meetings under one Zoom identity", "Resolve the OAuth redirect issue with Zoom; retire <code>ZOOM_OAUTH_ENABLED</code>"],
    ['<span class="pill a">med</span>', "No automated, off-host backups", "Single host + single DB = single point of loss", "Scheduled <code>pg_dump</code> to S3 with retention"],
    ['<span class="pill a">med</span>', "Single EC2 host", "No failover; deploys restart services", "Document RTO/RPO; consider managed Postgres first"],
    ['<span class="pill a">med</span>', "Tests use the live broker", "Smoke test sends Celery tasks to the dev worker", "<code>CELERY_TASK_ALWAYS_EAGER</code> in a test settings module"],
    ['<span class="pill">low</span>', "<code>/portal</code> route is a dead stub", "Confusing next to <code>/client-portal</code>", "Redirect or delete"],
    ['<span class="pill">low</span>', "<code>Assessment.visible_to_client</code> unused", "Field implies a portal feature that doesn't exist", "Build the endpoint or drop the field"],
    ['<span class="pill">low</span>', "<code>late</code> status never set", "Dead state in the lifecycle", "Remove, or set it from the reminder job"],
    ['<span class="pill">low</span>', "<code>dj-stripe</code> unused", "Dead dependency and webhook route", "Remove until platform billing is automated"],
    ['<span class="pill">low</span>', "Errors outside DRF not in ErrorLog", "Public page failures invisible in superadmin", "Django-level exception middleware"],
])}
<div class="callout note">Docs out of date: <code>CLAUDE.md</code> §6–7 still say "5 scheduled jobs" and "no AI/LLM
integration". There are 8 jobs, and Anthropic powers session-note drafts. <code>system_design.md</code> predates the OTP
portal login, email logging, the reschedule workflow and the Zoom changes. This document reflects the code as of
{AS_OF}.</div></section>""")

    body = "\n".join(S)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CoachOS Architecture &amp; Design</title><style>{CSS}</style></head><body>{body}</body></html>"""


def main():
    OUT_HTML.write_text(build(), encoding="utf-8")
    for w in WARNINGS:
        print("WARN", w)
    subprocess.run([CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
                    f"--print-to-pdf={OUT_PDF}", OUT_HTML.as_uri()], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"wrote {OUT_HTML.relative_to(HERE.parent.parent)} and {OUT_PDF.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    sys.exit(main())
