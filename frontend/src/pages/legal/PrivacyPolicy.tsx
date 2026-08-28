const updated = 'August 28, 2026'
const contactEmail = 'rassconsulting.co@gmail.com'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{
        fontFamily: "'Cormorant Garamond', serif", fontWeight: 600, fontSize: 22,
        color: '#16130f', margin: '0 0 12px',
      }}>{title}</h2>
      <div style={{ fontSize: 14.5, lineHeight: 1.75, color: '#3a3530' }}>{children}</div>
    </section>
  )
}

export default function PrivacyPolicy() {
  return (
    <div style={{ minHeight: '100vh', background: '#faf8f4' }}>
      <header style={{ background: '#1a2f4e', padding: '20px 24px', textAlign: 'center' }}>
        <span style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: '#f7f4ef', letterSpacing: '.04em' }}>
          Coach<span style={{ color: '#d9b96a' }}>OS</span>
        </span>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: '56px 24px 88px' }}>
        <div style={{
          fontSize: 12, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase',
          color: '#a97e1f', marginBottom: 12,
        }}>Legal</div>
        <h1 style={{
          fontFamily: "'Cormorant Garamond', serif", fontWeight: 500, fontSize: 42,
          lineHeight: 1.1, margin: '0 0 10px', color: '#16130f',
        }}>Privacy Policy</h1>
        <p style={{ fontSize: 13.5, color: '#8c8279', marginBottom: 44 }}>Last updated {updated}</p>

        <div style={{
          background: '#fff', border: '1px solid #ede9e1', borderRadius: 10,
          padding: '20px 24px', marginBottom: 44, fontSize: 14, lineHeight: 1.7, color: '#3a3530',
        }}>
          CoachOS is a practice-management platform used by independent coaches and consulting
          businesses ("<strong>Businesses</strong>") to run their client work — scheduling, notes,
          invoicing, and payments. If you are the client of a Business that uses CoachOS, that
          Business is responsible for its own client relationship with you; this policy describes
          how the CoachOS software itself collects and handles information on their behalf.
        </div>

        <Section title="Information we collect">
          <p style={{ margin: '0 0 12px' }}>Businesses using CoachOS may enter or generate the following information within the platform:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li style={{ marginBottom: 6 }}><strong>Client contact details</strong> — name, email, phone number, and company/affiliation.</li>
            <li style={{ marginBottom: 6 }}><strong>Scheduling and session data</strong> — appointment times, session notes, and meeting links.</li>
            <li style={{ marginBottom: 6 }}><strong>Billing information</strong> — invoices, line items, and payment status. CoachOS records that a payment occurred and its amount; it does not receive or store full card numbers (see "Payments" below).</li>
            <li style={{ marginBottom: 6 }}><strong>Files and documents</strong> uploaded to a Business's client library.</li>
            <li style={{ marginBottom: 6 }}><strong>Communications</strong> sent through the platform, such as invoice or session emails.</li>
            <li style={{ marginBottom: 0 }}><strong>Account and usage data</strong> for the coach/team members operating a Business's workspace, including login activity.</li>
          </ul>
        </Section>

        <Section title="Payments">
          <p style={{ margin: 0 }}>
            Each Business connects its own Stripe account to accept online payments. When a client
            pays an invoice, card details are entered directly on Stripe's own secure checkout
            page — CoachOS never receives or stores raw card numbers. CoachOS records the resulting
            payment confirmation (amount, date, status) sent back by Stripe. A Business's Stripe
            API credentials are encrypted at rest and are never displayed again once saved.
          </p>
        </Section>

        <Section title="How this information is used">
          <p style={{ margin: 0 }}>
            Information is used solely to operate the platform on behalf of the Business that
            collected it: scheduling and running sessions, generating and sending invoices,
            processing payments, storing shared documents, and providing the Business with reports
            on their own client activity. CoachOS does not sell client information, and does not
            use it for advertising.
          </p>
        </Section>

        <Section title="Sharing with service providers">
          <p style={{ margin: '0 0 12px' }}>
            To operate the platform, CoachOS relies on a small number of service providers who
            process data on our behalf, under their own security commitments:
          </p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li style={{ marginBottom: 6 }}><strong>Stripe</strong> — payment processing, when a Business enables online payments.</li>
            <li style={{ marginBottom: 6 }}><strong>Cloud infrastructure and storage providers</strong> — hosting the application and uploaded files.</li>
            <li style={{ marginBottom: 0 }}><strong>Email delivery providers</strong> — sending invoices, receipts, and notifications on a Business's behalf.</li>
          </ul>
        </Section>

        <Section title="Data security">
          <p style={{ margin: 0 }}>
            Sensitive credentials — including a Business's own Stripe API keys — are encrypted at
            rest using a key held separately from other application secrets. Access to a
            Business's data within CoachOS is restricted to that Business's own team members,
            based on their assigned role.
          </p>
        </Section>

        <Section title="Data retention and deletion">
          <p style={{ margin: 0 }}>
            Information is retained for as long as the Business's workspace remains active, or as
            needed to satisfy invoicing and financial record-keeping obligations. A Business or one
            of its clients may request access to, correction of, or deletion of personal
            information by contacting us at the address below.
          </p>
        </Section>

        <Section title="Children's privacy">
          <p style={{ margin: 0 }}>
            CoachOS is intended for use by businesses and their adult clients. It is not directed
            at, and we do not knowingly collect information from, children under 16.
          </p>
        </Section>

        <Section title="Changes to this policy">
          <p style={{ margin: 0 }}>
            We may update this policy as the platform evolves. Material changes will be reflected
            by updating the date at the top of this page.
          </p>
        </Section>

        <Section title="Contact us">
          <p style={{ margin: 0 }}>
            Questions about this policy, or requests regarding your personal information, can be
            sent to{' '}
            <a href={`mailto:${contactEmail}`} style={{ color: '#1a2f4e', fontWeight: 600 }}>{contactEmail}</a>.
          </p>
        </Section>
      </main>
    </div>
  )
}
