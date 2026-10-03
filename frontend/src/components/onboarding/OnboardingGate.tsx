// src/components/onboarding/OnboardingGate.tsx — SP-11-01: the resume path
// (Section 25). Register.tsx already sends a just-registered account
// straight to /onboarding — this gate is what covers every OTHER way an
// incomplete account can reach the app (closed the browser mid-onboarding,
// logged in again later, deep-linked somewhere else). Mounted once in
// App.tsx alongside PinModal/SecureChatsPrompt/ReconsentPrompt — same
// "always-mounted, decides for itself whether to act" shape. Server truth
// only: never decides completion from localStorage/session state.
import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../stores/authStore'
import { userApi } from '../../utils/api'

export default function OnboardingGate() {
  const user = useAuthStore(s => s.user)
  const navigate = useNavigate()
  const location = useLocation()

  const { data } = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => userApi.onboarding().then(r => r.data.data),
    enabled: !!user,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!user || !data) return
    if (data.completed) return
    if (location.pathname === '/onboarding') return
    navigate('/onboarding', { replace: true })
  }, [user, data, location.pathname, navigate])

  return null
}
