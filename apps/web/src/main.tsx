import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './admin'
import { RecipientClaim } from './claim'
import { FloatingThemeToggle } from './theme'
import { LangProvider } from './ui/i18n'
import { useRoute } from './ui/router'
import { CheckIn } from './ui/pages/CheckIn'
import { EmployeeRegister } from './ui/pages/EmployeeRegister'
import { Console } from './ui/pages/Console'
import { Tip } from './ui/pages/Tip'
import { Landing } from './ui/pages/Landing'
import './styles.css'
import './theme.css'

function Legacy({ children }: { children: React.ReactNode }) {
  return <><FloatingThemeToggle />{children}</>
}

function Root() {
  const route = useRoute()
  switch (route.page) {
    case 'register': return <EmployeeRegister token={route.token} />
    case 'checkin': return <CheckIn token={route.token} />
    case 'tip': return <Tip paymentRef={route.paymentRef} amount={route.amount} />
    case 'claim': return <Legacy><RecipientClaim /></Legacy>
    case 'console': return <Console />
    default:
      if (route.path === '/demo') return <App />
      if (route.path === '/company') return <Console />
      return <Landing />
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><LangProvider><Root /></LangProvider></StrictMode>,
)
