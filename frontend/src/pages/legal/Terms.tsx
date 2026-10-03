// src/pages/legal/Terms.tsx
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Footer from '../../components/layout/Footer'

export default function Terms() {
  const navigate = useNavigate()
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px 60px' }}>
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--link)', fontWeight: 600, marginBottom: 20, minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={16} aria-hidden />Back</button>
      <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 900, color: 'var(--text)', marginBottom: 6 }}>Terms of Service</h1>
      <p style={{ fontSize: 13, color: 'var(--text4)', marginBottom: 8 }}>Effective: 1 January 2026 · Spandik by Vively Technology Solutions Pvt. Ltd.</p>
      <p style={{ fontSize: 12, color: 'var(--text4)', marginBottom: 32, lineHeight: 1.7 }}>
        Spandik is a product of Vively Technology Solutions Private Limited.<br />
        CIN: U62099WR2026PTC292269 · Registered office: LP-28/13/1/1, Ramkrishna Pally (W), Nimta, North 24 Parganas, West Bengal 700049, India
      </p>

      {[
        { title: '1. Acceptance', body: 'By creating an account on Spandik, you agree to these Terms and our Privacy Policy. You must be at least 18 years old to use Spandik. If you do not agree, do not use our service.' },
        { title: '2. Your Account', body: 'You are responsible for keeping your account secure. Use a strong, unique password. Enable two-factor authentication for extra protection. Do not share your credentials with anyone.' },
        { title: '3. Your Content', body: 'You retain ownership of all content you post on Spandik. By posting, you grant Spandik a non-exclusive, royalty-free license to display and distribute your content on the platform. You are solely responsible for your content.' },
        { title: '4. Prohibited Content', body: 'You must not post: content involving minors in any sexual context; hate speech or content promoting violence based on race, religion, gender, or other characteristics; spam or coordinated inauthentic behavior; content that infringes third-party intellectual property rights; false information intended to deceive.' },
        { title: '5. Privacy & Data', body: 'We collect and process your personal data as described in our Privacy Policy, in compliance with the Digital Personal Data Protection Act 2023 (India). Your chat messages are end-to-end encrypted. Spandik does not store your unencrypted chat key.' },
        { title: '6. Termination', body: 'We may suspend or terminate your account for violations of these Terms. You may delete your account at any time from Settings. Upon deletion, your profile and posts are hidden and your login is disabled immediately; full removal of your stored data follows as our deletion process completes, except where required by law.' },
        { title: '7. Limitation of Liability', body: 'Spandik is provided "as is" without warranties of any kind. To the maximum extent permitted by law, Vively Technology Solutions Pvt. Ltd. shall not be liable for any indirect, incidental, or consequential damages arising from use of the platform.' },
        { title: '8. Governing Law', body: 'These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of courts in Kolkata, West Bengal.' },
        { title: '9. Contact', body: 'For questions about these Terms, contact us at legal@spandik.com. To file a formal complaint under the IT Rules 2021, use our Grievance Redressal page (Settings → About → Grievance Redressal, or /legal/grievance).' },
      ].map(section => (
        <div key={section.title} style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{section.title}</h2>
          <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.8 }}>{section.body}</p>
        </div>
      ))}
      <Footer />
    </div>
  )
}
