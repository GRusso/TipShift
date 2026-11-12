import { useEffect, useState } from 'react'

export type Route =
  | { page: 'register'; token: string }       // employee registration link  (#register=…)
  | { page: 'checkin'; token: string }        // group check-in QR           (#checkin=…)
  | { page: 'tip'; paymentRef: string; amount: string } // customer payment QR (?payment_ref=…&amount=…)
  | { page: 'claim' }                         // legacy per-slot claim link  (#claim=…)
  | { page: 'console' }                       // signed-in company / local console (?admin=1 or #/console…)
  | { page: 'app'; path: string }             // everything else: #/path

const TOKEN = /^[A-Za-z0-9_-]{32,256}$/

/** Resolve the current URL. Private capability links live in the fragment so they never reach a server log. */
export function resolveRoute(location: Location = window.location): Route {
  const fragment = new URLSearchParams(location.hash.slice(1))
  const register = fragment.get('register')
  if (register && TOKEN.test(register)) return { page: 'register', token: register }
  const checkin = fragment.get('checkin')
  if (checkin && TOKEN.test(checkin)) return { page: 'checkin', token: checkin }
  if (fragment.has('claim')) return { page: 'claim' }
  const query = new URLSearchParams(location.search)
  const paymentRef = query.get('payment_ref'); const amount = query.get('amount')
  if (paymentRef && amount && /^ts-[a-f0-9]{32}$/.test(paymentRef) && /^\d+(\.\d{1,6})?$/.test(amount)) return { page: 'tip', paymentRef, amount }
  if (new URLSearchParams(location.search).get('admin') === '1') return { page: 'console' }
  const path = location.hash.startsWith('#/') ? location.hash.slice(1).split('?')[0] : '/'
  return path === '/console' || path.startsWith('/console/') ? { page: 'console' } : { page: 'app', path }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => resolveRoute())
  useEffect(() => {
    const update = () => setRoute(resolveRoute())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
