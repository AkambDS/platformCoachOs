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

export default function TermsOfService() {
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
        }}>Terms of Service</h1>
        <p style={{ fontSize: 13.5, color: '#8c8279', marginBottom: 44 }}>Last updated {updated}</p>

        <div style={{
          background: '#fff', border: '1px solid #ede9e1', borderRadius: 10,
          padding: '20px 24px', marginBottom: 44, fontSize: 14, lineHeight: 1.7, color: '#3a3530',
        }}>
          These Terms of Service ("<strong>Terms</strong>") govern use of CoachOS, a practice-management
          platform for independent coaches and consulting businesses ("<strong>Businesses</strong>",
          "<strong>you</strong>"). By creating a workspace or otherwise using CoachOS, you agree to these Terms.
        </div>

        <Section title="Your account and workspace">
          <p style={{ margin: 0 }}>
            A Business registers a workspace and invites its own team members (coaches, assistants) into it.
            You're responsible for the accuracy of information entered into your workspace, for keeping your
            login credentials confidential, and for the actions taken by team members you invite. Each
            workspace's data — clients, sessions, invoices, files — belongs to that Business, not to CoachOS.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p style={{ margin: '0 0 12px' }}>You agree not to use CoachOS to:</p>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li style={{ marginBottom: 6 }}>Violate any law, or the rights of your clients or any third party.</li>
            <li style={{ marginBottom: 6 }}>Upload malicious code, or attempt to gain unauthorized access to another workspace's data.</li>
            <li style={{ marginBottom: 6 }}>Interfere with the platform's normal operation or overload its infrastructure.</li>
            <li style={{ marginBottom: 0 }}>Use the platform to send spam or unsolicited communications to clients.</li>
          </ul>
        </Section>

        <Section title="Third-party integrations">
          <p style={{ margin: 0 }}>
            CoachOS optionally connects to third-party services you choose to enable — including Stripe for
            payments, Zoom for meeting links, and Google Calendar for session syncing. Connecting one of these
            services is your choice, requires your explicit authorization, and can be revoked at any time from
            your Settings page or directly from the third-party provider's own account settings. Your use of
            those third-party services is additionally governed by their own terms.
          </p>
        </Section>

        <Section title="Billing">
          <p style={{ margin: 0 }}>
            Where CoachOS itself charges a subscription fee for platform access, that fee, billing cycle, and
            plan details are as presented to you at signup or in your account settings. Payments a Business
            collects from its own clients through its connected Stripe account are between that Business and
            its client — CoachOS is not a party to that transaction and does not take a cut of it.
          </p>
        </Section>

        <Section title="Data ownership">
          <p style={{ margin: 0 }}>
            You own the client, session, and business data you enter into your workspace. We access it only
            to operate the platform, provide support, or as required by law — see our{' '}
            <a href="/privacy-policy" style={{ color: '#1a2f4e', fontWeight: 600 }}>Privacy Policy</a> for
            details on how it's collected, used, and retained.
          </p>
        </Section>

        <Section title="Availability and changes">
          <p style={{ margin: 0 }}>
            We aim to keep CoachOS available and reliable but don't guarantee uninterrupted service. Features
            may be added, changed, or removed as the platform evolves; material changes to these Terms will be
            reflected by updating the date at the top of this page.
          </p>
        </Section>

        <Section title="Termination">
          <p style={{ margin: 0 }}>
            You may stop using CoachOS at any time. We may suspend or terminate a workspace's access if these
            Terms are violated, or if required by law. On termination, a Business's data is handled as
            described in our Privacy Policy's retention and deletion terms.
          </p>
        </Section>

        <Section title="Disclaimer and limitation of liability">
          <p style={{ margin: 0 }}>
            CoachOS is provided "as is," without warranties of any kind. To the extent permitted by law, we
            are not liable for indirect, incidental, or consequential damages arising from use of the
            platform, including data loss, business interruption, or third-party service outages.
          </p>
        </Section>

        <Section title="Contact us">
          <p style={{ margin: 0 }}>
            Questions about these Terms can be sent to{' '}
            <a href={`mailto:${contactEmail}`} style={{ color: '#1a2f4e', fontWeight: 600 }}>{contactEmail}</a>.
          </p>
        </Section>
      </main>
    </div>
  )
}
