import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type Lang = 'en' | 'es'
const STORAGE_KEY = 'tipshift-lang'

function storedLang(): Lang {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'es') return saved
  } catch { /* storage unavailable */ }
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : 'en'
}

const LangContext = createContext<{ lang: Lang; toggleLang: () => void }>({ lang: 'en', toggleLang: () => {} })

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(storedLang)
  useEffect(() => {
    document.documentElement.lang = lang
    try { window.localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
  }, [lang])
  const toggleLang = useCallback(() => setLang((current) => current === 'en' ? 'es' : 'en'), [])
  const value = useMemo(() => ({ lang, toggleLang }), [lang, toggleLang])
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang() {
  return useContext(LangContext)
}

/** Pick the copy for the current language. Each page keeps its own { en, es } dictionary. */
export function useCopy<T>(copy: { en: T; es: T }): T {
  return copy[useLang().lang]
}
