// src/pages/legal/Privacy.tsx
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Footer from '../../components/layout/Footer'

export default function Privacy() {
  const navigate = useNavigate()
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px 60px' }}>
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--link)', fontWeight: 600, marginBottom: 20, minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={16} aria-hidden />Back</button>
      <h1 style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 900, color: 'var(--text)', marginBottom: 6 }}>Privacy Policy</h1>
      <p style={{ fontSize: 13, color: 'var(--text4)', marginBottom: 8 }}>Effective: 1 January 2026 · Compliant with DPDP Act 2023 (India)</p>
      <p style={{ fontSize: 12, color: 'var(--text4)', marginBottom: 32, lineHeight: 1.7 }}>
        Spandik is a product of Vively Technology Solutions Private Limited.<br />
        CIN: U62099WR2026PTC292269 · Registered office: LP-28/13/1/1, Ramkrishna Pally (W), Nimta, North 24 Parganas, West Bengal 700049, India
      </p>

      {[
        { title: '1. Data We Collect', body: 'We collect information you provide when creating an account (name, email, date of birth), content you post (text, images, videos), and technical data (IP address, device type, login timestamps). We do not collect sensitive personal data beyond what is necessary to provide the service.' },
        { title: '2. How We Use Your Data', body: 'We use your data to operate and improve Spandik, personalize your experience, send you important notifications, detect and prevent fraud or abuse, and comply with legal obligations. We do not sell your personal data to third parties.' },
        { title: '3. End-to-End Encryption', body: 'Direct messages on Spandik are end-to-end encrypted using industry-standard cryptography. Spandik does not store your unencrypted chat key. Message content is stored encrypted on our servers and is decrypted by the intended recipients. A longer recovery passphrase (available from Settings) gives stronger protection than a 6-digit PIN alone.' },
        { title: '4. Content Moderation', body: 'Public posts, comments, bios, and story captions are automatically screened by AI (Cloudflare Workers AI, with a fallback provider) to detect content that violates our Community Guidelines — hate speech, violence, and similar categories. Clearly severe violations are removed automatically; borderline content is published but flagged for human review. Private, end-to-end encrypted chat messages are never scanned or moderated by Spandik — Spandik does not store your unencrypted chat key, and chat safety relies entirely on the report and block features available in every conversation.' },
        { title: '5. Data Sharing', body: 'We share data with: cloud service providers (Cloudflare) who process data on our behalf under strict data processing agreements; law enforcement when legally required; no advertising networks — Spandik does not show ads and does not share data for advertising purposes.' },
        { title: '6. Data Storage & Retention', body: 'Your data is stored on Cloudflare infrastructure. We retain your data for as long as your account is active. Upon account deletion, your profile and posts are hidden and your login is disabled immediately; full removal of your stored data follows as our deletion process completes, except where retention is required by applicable law.' },
        { title: '7. Your Rights (DPDP Act 2023)', body: 'Under the Digital Personal Data Protection Act 2023, you have the right to: access your personal data; correct inaccurate data; erase your data (right to be forgotten); data portability (export your data); withdraw consent at any time. Exercise these rights from Settings > Data & Privacy or by contacting privacy@spandik.com.' },
        { title: '8. Children', body: 'Spandik is not intended for users under 18 years of age. We do not knowingly collect data from minors. If we become aware of such data, we will delete it immediately.' },
        { title: '9. Cookies & Local Storage', body: 'We use browser local storage to remember your preferences (theme, language) and to maintain your login session. We do not use third-party tracking cookies.' },
        { title: '10. Changes to This Policy', body: 'We may update this Privacy Policy. We will notify you of significant changes via email or in-app notification at least 30 days before the change takes effect.' },
        { title: '11. Contact', body: 'Privacy Officer: privacy@spandik.com\nGrievance Officer: grievance@spandik.com (see our Grievance Redressal page for full details and a complaint form)\nVively Technology Solutions Pvt. Ltd.\nLP-28/13/1/1, Ramkrishna Pally (W), Nimta, North 24 Parganas, West Bengal 700049, India' },
      ].map(section => (
        <div key={section.title} style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>{section.title}</h2>
          <p style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.8, whiteSpace: 'pre-line' }}>{section.body}</p>
        </div>
      ))}
      <Footer />
    </div>
  )
}
