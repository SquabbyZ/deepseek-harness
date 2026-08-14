import { useCallback, useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

export type AccountSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'account'>

interface Identity { id: string; provider: string; name: string; email?: string; avatar?: string }

export function AccountSection({ t }: AccountSectionProps) {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch('/auth/github/status')
    setIdentity(await res.json())
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const login = async () => {
    setBusy(true)
    setError(null)
    await fetch('/auth/github/start', { method: 'POST' })
    for (let i = 0; i < 300; i++) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      const res = await fetch('/auth/github/status')
      const current = await res.json() as Identity | null
      if (current !== null) { setIdentity(current); setBusy(false); return }
    }
    setError('github oauth: timed out waiting for authorization')
    setBusy(false)
  }

  const logout = async () => {
    await fetch('/auth/github/logout', { method: 'POST' })
    setIdentity(null)
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
