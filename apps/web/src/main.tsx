import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AdminTurnCreator } from './admin'
import { RecipientClaim } from './claim'
import './styles.css'

const isAdminRoute = new URLSearchParams(window.location.search).get('admin') === '1'
const isRecipientClaim = new URLSearchParams(window.location.hash.slice(1)).has('claim')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isRecipientClaim ? <RecipientClaim /> : isAdminRoute ? <AdminTurnCreator /> : <App />}</StrictMode>,
)
