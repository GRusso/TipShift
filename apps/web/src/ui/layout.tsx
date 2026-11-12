import type { ReactNode } from 'react'
import './ui.css'
import { useTheme } from '../theme'
import { useCopy, useLang } from './i18n'

const shared = {
  en: { night: 'Night', day: 'Day', toggleTheme: 'Switch day / night' },
  es: { night: 'Noche', day: 'Día', toggleTheme: 'Cambiar día / noche' },
}

export function Brand({ href = '#/' }: { href?: string }) {
  return <a className="ts-brand" href={href}><span className="ts-brand-mark">T</span>tipshift</a>
}

/** EN/ES + day/night, present on every screen (UX_SPEC: operational screens must offer both). */
export function Controls() {
  const { lang, toggleLang } = useLang()
  const { theme, toggleTheme } = useTheme()
  const c = useCopy(shared)
  const dark = theme === 'dark'
  return <div className="ts-controls">
    <button type="button" className="ts-chip" onClick={toggleLang} aria-label="Language">{lang === 'en' ? 'ES' : 'EN'}</button>
    <button type="button" className="ts-chip" onClick={toggleTheme} aria-label={c.toggleTheme}><span>{dark ? '☀' : '☾'}</span> {dark ? c.day : c.night}</button>
  </div>
}

/** Public / employee / customer pages: ribbon, brand header, centered content. */
export function PublicFrame({ ribbon, nav, children }: { ribbon?: string; nav?: ReactNode; children: ReactNode }) {
  return <div className="ts-root">
    {ribbon && <div className="ts-ribbon">{ribbon}</div>}
    <div className="ts-wrap">
      <div className="ts-header" role="banner">
        <Brand />
        <div className="ts-nav">{nav}<Controls /></div>
      </div>
      {children}
    </div>
  </div>
}

export type NavItem = { id: string; label: string; icon: string; href: string }

/** Console pages (company owner, local admin): sidebar + topbar. */
export function ConsoleShell({ workspace, location, nav, active, footer, title, eyebrow, actions, children }: {
  workspace: string; location?: ReactNode; nav: NavItem[]; active: string; footer?: ReactNode
  title: string; eyebrow?: string; actions?: ReactNode; children: ReactNode
}) {
  return <div className="ts-root">
    <div className="ts-shell">
      <aside className="ts-side">
        <Brand />
        <p className="ts-side-label">{workspace}</p>
        {location && <div className="ts-switch">{location}</div>}
        <nav aria-label="Console">
          {nav.map((item) => <a key={item.id} href={item.href} className={item.id === active ? 'active' : undefined}><span>{item.icon}</span>{item.label}</a>)}
        </nav>
        {footer && <div className="ts-side-foot">{footer}</div>}
      </aside>
      <main className="ts-main">
        <div className="ts-top">
          <div>{eyebrow && <p className="ts-eyebrow">{eyebrow}</p>}<h1>{title}</h1></div>
          <div className="ts-controls">{actions}<Controls /></div>
        </div>
        {children}
      </main>
    </div>
  </div>
}
