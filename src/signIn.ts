/**
 * The mock sign-in page (sign-in.html), for previews and localhost: a real
 * email and password account on this site's own Supabase project, then back
 * to where the visitor came from. The client is made the same way as the
 * site's, so the session it saves is the one the site reads.
 */
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL as string, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLFormElement>('form');
const email = $<HTMLInputElement>('email');
const password = $<HTMLInputElement>('password');
const submit = $<HTMLButtonElement>('submit');
const msg = $<HTMLDivElement>('msg');
let signingUp = false;

/** back to the page that sent them: only a path on this site */
function returnTo() {
  const back = new URLSearchParams(window.location.search).get('returnTo') ?? '/';
  return back.startsWith('/') && !back.startsWith('//') ? back : '/';
}

function say(text: string, ok = false) {
  msg.textContent = text;
  msg.classList.toggle('ok', ok);
}

function setMode(up: boolean) {
  signingUp = up;
  $('title').textContent = up ? 'Get started' : 'Welcome back';
  $('sub').textContent = up ? 'Create a new account' : 'Sign in to your account';
  submit.textContent = up ? 'Sign Up' : 'Sign In';
  password.autocomplete = up ? 'new-password' : 'current-password';
  $('switch').firstChild!.textContent = up ? 'Have an account? ' : "Don't have an account? ";
  $('mode').textContent = up ? 'Sign In Now' : 'Sign Up Now';
  say('');
}

$('mode').addEventListener('click', () => setMode(!signingUp));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!email.value || password.value.length < 6) return say('Enter your email and a password of at least 6 characters.');
  submit.disabled = true;
  say('');
  const creds = { email: email.value.trim(), password: password.value };
  const { data, error } = signingUp ? await supabase.auth.signUp(creds) : await supabase.auth.signInWithPassword(creds);
  submit.disabled = false;
  if (error) return say(error.message);
  if (!data.session) return say('Check your email to confirm your account, then sign in.', true);
  window.location.replace(returnTo());
});

// already signed in: straight back
supabase.auth.getSession().then(({ data }) => {
  if (data.session) window.location.replace(returnTo());
});
