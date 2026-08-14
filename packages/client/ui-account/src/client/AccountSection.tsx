import { useCallback, useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export type AccountSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'account'>

interface Identity { id: string; provider: string; name: string; email?: string; avatar?: string }

export function AccountSection({ t }: AccountSectionProps) {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/auth/github/status')
      if (mounted.current) setIdentity(await res.json())
    } catch {
      if (mounted.current) setError(t('error'))
    }
  }, [t])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false }
  }, [refresh])

  const login = async () => {
    setBusy(true)
    setError(null)
    try {
      await fetch('/auth/github/start', { method: 'POST' })
      for (let i = 0; i < 300; i++) {
        if (!mounted.current) return
        await new Promise(resolve => setTimeout(resolve, 1000))
        if (!mounted.current) return
        const res = await fetch('/auth/github/status')
        const current = await res.json() as Identity | null
        if (current !== null) { setIdentity(current); return }
      }
      if (mounted.current) setError(t('timeout'))
    } catch {
      if (mounted.current) setError(t('error'))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const logout = async () => {
    try {
      await fetch('/auth/github/logout', { method: 'POST' })
      if (mounted.current) setIdentity(null)
    } catch {
      if (mounted.current) setError(t('error'))
    }
  }

  if (identity !== null) {
    return (
      <div>
        <p>{t('signedIn', { name: identity.name })}</p>
        <button type="button" onClick={logout}>{t('logout')}</button>
      </div>
    )
  }

  return (
    <div>
      <button type="button" onClick={login} disabled={busy}>{busy ? t('waiting') : t('login')}</button>
      {error !== null && <p>{error}</p>}
    </div>
  )
}
