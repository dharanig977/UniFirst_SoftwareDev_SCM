// Tiny hash router: "#/purchase/new" -> "purchase/new". No extra dependency,
// and it works on any static host (Vercel) without rewrite rules.
import { useEffect, useState } from 'react'

const current = () => window.location.hash.replace(/^#\/?/, '').replace(/\/$/, '')

export function useRoute(): string {
  const [route, setRoute] = useState(current)
  useEffect(() => {
    const onChange = () => {
      setRoute(current())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(path: string) {
  window.location.hash = '/' + path
}

export const href = (path: string) => '#/' + path
