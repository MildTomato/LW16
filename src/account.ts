/**
 * Who's making the ticket. The button always says "Log in with Supabase";
 * where it goes depends on where the site runs:
 *
 * - on supabase.com (VITE_LOGIN=supabase-com): the dashboard's own sign-in,
 *   which sends you back here; the session is the one www and the dashboard keep.
 * - on previews and localhost (the default): our mock sign-in page, made to
 *   look the same, signing in for real to this site's own Supabase project.
 *
 * Either way the access token goes to /api/ticket, which checks it with the
 * matching auth server before anything is saved.
 */
import { AuthClient, navigatorLock, type User } from '@supabase/supabase-js';
import { supabase } from './tickets.ts';

export const LOGIN: 'supabase-com' | 'mock' = import.meta.env.VITE_LOGIN === 'supabase-com' ? 'supabase-com' : 'mock';

/** the dashboard's sign-in, and the key and lock its session lives under (one session, refreshed by whichever tab gets there first) */
const DASHBOARD_SIGN_IN = 'https://supabase.com/dashboard/sign-in';
const DASHBOARD_STORAGE_KEY = 'supabase.dashboard.auth.token';

const platform =
  LOGIN === 'supabase-com' && typeof window !== 'undefined'
    ? new AuthClient({
        url: import.meta.env.VITE_PLATFORM_AUTH_URL as string,
        storageKey: DASHBOARD_STORAGE_KEY,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        lock: globalThis.navigator?.locks ? navigatorLock : undefined,
      })
    : null;

/** the auth this site signs in with */
const auth = () => platform ?? supabase?.auth ?? null;

/** a signed-in account, and the username it suggests */
export interface Account {
  id: string;
  suggested: string;
}

const usernameOf = (user: User) => {
  const m = user.user_metadata ?? {};
  const name = [m.user_name, m.preferred_username, m.username].find((v) => typeof v === 'string' && v);
  return String(name ?? user.email?.split('@')[0] ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24);
};

const accountOf = (user: User | null | undefined): Account | null => (user ? { id: user.id, suggested: usernameOf(user) } : null);

/** The access token for /api/ticket, or null if nobody's logged in. */
export async function accountToken(): Promise<string | null> {
  const a = auth();
  if (!a) return null;
  const { data } = await a.getSession();
  return data.session?.access_token ?? null;
}

/** The account as it changes (logging in, out, or a token refresh). Returns the unsubscribe. */
export function onAccount(handler: (a: Account | null) => void): () => void {
  const a = auth();
  if (!a) {
    handler(null);
    return () => {};
  }
  const { data } = a.onAuthStateChange((_event, session) => handler(accountOf(session?.user)));
  return () => data.subscription.unsubscribe();
}

/** a draft waiting for its owner to come back from logging in */
const PENDING_KEY = 'lw16:pending-ticket';

/** Log in with Supabase: off to the sign-in page, and back here afterwards with whatever was in progress. */
export function logIn(pending?: unknown) {
  if (pending !== undefined) sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const back = `${window.location.pathname}${window.location.search}`;
  const page =
    LOGIN === 'supabase-com' ? DASHBOARD_SIGN_IN : `${window.location.origin}${import.meta.env.BASE_URL}sign-in.html`;
  window.location.assign(`${page}?returnTo=${encodeURIComponent(back)}`);
}

/** Whatever was in progress before logging in, once (it's forgotten as it's taken). */
export function takePending<T>(): T | null {
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  try {
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function logOut() {
  await auth()?.signOut();
}
