import { createClient } from '@supabase/supabase-js'

/** Public, session-less client for capability-link pages (employee registration and check-in).
 *  It only needs the public Supabase URL and publishable key; it never touches a seed phrase. */
export function publicClient() {
  const url = import.meta.env.VITE_TIPSHIFT_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_TIPSHIFT_SUPABASE_ANON_KEY?.trim()
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null
}

export type PublicClient = NonNullable<ReturnType<typeof publicClient>>

export async function callTipshift<T>(client: PublicClient, body: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await client.functions.invoke('tipshift-claims', { body })
  return error || !data ? null : data as T
}
