// src/components/chat/PinInput.tsx — 6-digit UPI-style PIN entry (SP-1-02)
import { useRef } from 'react'

export default function PinInput({
  value, onChange, autoFocus, error,
}: { value: string; onChange: (v: string) => void; autoFocus?: boolean; error?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '')

  function setDigit(i: number, raw: string) {
    const clean = raw.replace(/\D/g, '').slice(-1)
    const next = digits.slice()
    next[i] = clean
    onChange(next.join(''))
    if (clean && i < 5) refs.current[i + 1]?.focus()
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus()
  }

  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
      {digits.map((d, i) => (
        <input key={i} ref={el => { refs.current[i] = el }} value={d}
          onChange={e => setDigit(i, e.target.value)}
          onKeyDown={e => onKeyDown(i, e)}
          autoFocus={autoFocus && i === 0}
          inputMode="numeric" type="password" maxLength={1}
          style={{
            width: 44, height: 52, textAlign: 'center', fontSize: 24, fontWeight: 700,
            borderRadius: 10, border: `1.5px solid ${error ? 'var(--danger)' : 'var(--input-border)'}`,
            background: 'var(--input-bg)', color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
          }} />
      ))}
    </div>
  )
}
