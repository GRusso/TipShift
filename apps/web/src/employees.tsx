import type { SupabaseClient } from '@supabase/supabase-js'
import { useCallback, useEffect, useState } from 'react'
import { toDataURL } from 'qrcode'

type Employee = { employee_id: string; initials: string; created_at: string }

const linkKey = (userId: string, branchRef: string) => `tipshift-registration-link:${userId}:${branchRef}`

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function savedToken(userId: string, branchRef: string) {
  try { return window.localStorage.getItem(linkKey(userId, branchRef)) } catch { return null }
}

// Manager view of a branch's employees: initials only, plus the permanent registration link.
// Only the SHA-256 hash of the link is stored server-side, so the issuing browser keeps the link.
export function EmployeesPanel({ client, userId, venueRef, branchRef }: { client: SupabaseClient; userId: string; venueRef: string; branchRef: string }) {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [token, setToken] = useState<string | null>(() => savedToken(userId, branchRef))
  const [qr, setQr] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const url = token ? `${window.location.origin}${window.location.pathname}#register=${token}` : null

  const load = useCallback(async () => {
    const { data } = await client.functions.invoke('tipshift-claims', { body: { action: 'admin_branch_employees', branchRef } })
    const rows = (data as { employees?: Employee[] } | null)?.employees
    setEmployees(Array.isArray(rows) ? rows : [])
  }, [client, branchRef])

  useEffect(() => { setToken(savedToken(userId, branchRef)); void load() }, [userId, branchRef, load])
  useEffect(() => { if (url) void toDataURL(url, { width: 220, margin: 1 }).then(setQr); else setQr(null) }, [url])

  const issue = async () => {
    setBusy(true); setMessage(null)
    const next = newToken()
    const { error } = await client.functions.invoke('tipshift-claims', { body: { action: 'admin_set_registration_link', venueRef, branchRef, token: next } })
    setBusy(false)
    if (error) { setMessage('The registration link could not be created.'); return }
    try { window.localStorage.setItem(linkKey(userId, branchRef), next) } catch { /* storage unavailable */ }
    setToken(next)
    setMessage('New registration link created. The previous one no longer works.')
  }

  return <>
    <p className="admin-message">Employees register once per branch with their own wallet. You see only their initials.</p>
    <div className="actions"><button className="primary" disabled={busy} onClick={() => void issue()}>{token ? 'Replace registration link' : 'Create registration link'}</button><button className="secondary" onClick={() => void load()}>Refresh</button></div>
    {message && <p className="admin-message" role="status">{message}</p>}
    {url && <div className="claim-links"><article><strong>Registration link for employees</strong>{qr && <img src={qr} alt="Registration QR for this branch" />}<a href={url}>{url}</a></article></div>}
    <h2>Registered employees ({employees.length})</h2>
    {employees.length === 0 ? <p className="admin-message">Nobody has registered yet.</p> : <div className="rows">{employees.map((employee, index) => <article key={employee.employee_id}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{employee.initials}</strong><small>Registered {new Date(employee.created_at).toLocaleDateString()}</small></span></article>)}</div>}
  </>
}
