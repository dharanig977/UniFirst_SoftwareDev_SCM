// Loads all CRM data once after sign-in and shares it with every page.
// The data set is small (a few thousand rows), so one request is simplest.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { Account, CrmData } from '../lib/types'

interface Ctx {
  data: CrmData | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  accountById: Map<string, Account>
}

const CrmDataContext = createContext<Ctx | null>(null)

export function CrmDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<CrmData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.bootstrap())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const accountById = useMemo(() => new Map((data?.accounts ?? []).map((a) => [a.account_id, a])), [data])
  return <CrmDataContext.Provider value={{ data, loading, error, reload, accountById }}>{children}</CrmDataContext.Provider>
}

export function useCrmData(): Ctx {
  const ctx = useContext(CrmDataContext)
  if (!ctx) throw new Error('useCrmData must be used inside CrmDataProvider')
  return ctx
}
