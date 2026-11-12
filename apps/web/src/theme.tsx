import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const STORAGE_KEY = 'tipshift-theme'

function storedTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* storage unavailable: fall back to the system preference */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(storedTheme)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { window.localStorage.setItem(STORAGE_KEY, theme) } catch { /* ignore */ }
  }, [theme])
  const toggleTheme = useCallback(() => setTheme((current) => current === 'dark' ? 'light' : 'dark'), [])
  return { theme, toggleTheme }
}

export function FloatingThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const dark = theme === 'dark'
  return <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label={dark ? 'Switch to day mode' : 'Switch to night mode'} title={dark ? 'Day mode' : 'Night mode'}>{dark ? '☀' : '☾'}</button>
}
