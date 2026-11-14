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

const ERRORS: [RegExp, { en: string; es: string }][] = [
  [/^No wallet was connected\.?$/, { en: 'No wallet was connected.', es: 'No se conectó ninguna wallet.' }],
  [/^The wallet did not return a testnet account/, { en: 'The wallet did not return a testnet account.', es: 'La wallet no devolvió una cuenta de testnet.' }],
  [/^Unable to read the wallet balance/, { en: 'Couldn’t read the wallet balance.', es: 'No se pudo leer el saldo de la wallet.' }],
  [/^Unable to read testnet state/, { en: 'Couldn’t read the network state.', es: 'No se pudo leer el estado de la red.' }],
  [/^Enter a positive USDC amount/, { en: 'Enter a positive USDC amount with up to 6 decimals.', es: 'Ingresá un monto positivo de USDC con hasta 6 decimales.' }],
  [/^The tip amount must be greater than zero/, { en: 'The tip must be greater than zero.', es: 'La propina tiene que ser mayor que cero.' }],
  [/^The network has not confirmed the step yet/, { en: 'The network hasn’t confirmed the step yet. Refresh in a few seconds and try again.', es: 'La red todavía no confirmó el paso. Actualizá en unos segundos y probá de nuevo.' }],
  [/^The network has not confirmed the payouts yet/, { en: 'The network hasn’t confirmed the payouts yet. Refresh in a few seconds.', es: 'La red todavía no confirmó los pagos. Actualizá en unos segundos.' }],
  [/^This location’s pool isn’t available/, { en: 'This location’s pool isn’t available.', es: 'El pool de este local no está disponible.' }],
  [/^The pool is in state/, { en: 'The pool isn’t ready to be paid out yet.', es: 'El pool todavía no está listo para repartirse.' }],
]

/** Turns a thrown error into text in the current language. Known technical messages are translated; anything else in Spanish falls back to the page's own message. */
export function useErrorText() {
  const { lang } = useLang()
  return (error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
    const known = ERRORS.find(([pattern]) => pattern.test(message))
    if (known) return known[1][lang]
    if (!message) return fallback
    // Messages the pages wrote themselves are already in the right language; raw English from libraries is not shown in Spanish.
    return lang === 'es' && !/[áéíóúñ¿¡]|\b(el|la|los|las|de|que|no|se|una|tu|con|por|para)\b/i.test(message) ? fallback : message
  }
}
