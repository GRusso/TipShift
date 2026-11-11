import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AdminTurnCreator } from './admin'
import './styles.css'

const isAdminRoute = new URLSearchParams(window.location.search).get('admin') === '1'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isAdminRoute ? <AdminTurnCreator /> : <App />}</StrictMode>,
)
