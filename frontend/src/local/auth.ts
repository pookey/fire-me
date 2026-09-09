// Drop-in replacement for utils/auth.ts used by vite.local.config.ts so the
// frontend runs in Docker without Cognito. Type-only import: the real module
// calls Amplify.configure() at import time, and a value import here would
// execute it (and pull the Amplify bundle back in).
import type * as Real from '../utils/auth';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// One key holding the whole session so a stale token can never outlive its
// user id. localStorage rather than module state so it survives a reload.
const SESSION_KEY = 'fintrack-local-session';

interface Session {
  token: string;
  userId: string;
  username: string;
}

function readSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  // A corrupted value must read as signed out, not lock the user out of the
  // Login page with an unparseable session.
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' && parsed !== null &&
      typeof (parsed as Session).token === 'string' &&
      typeof (parsed as Session).userId === 'string' &&
      typeof (parsed as Session).username === 'string'
    ) {
      return parsed as Session;
    }
  } catch {
    // fall through
  }
  localStorage.removeItem(SESSION_KEY);
  return null;
}

function writeSession(session: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

// A rejected fetch is a bare TypeError('Failed to fetch'), which Login.tsx
// would show verbatim; say where we were trying to reach instead.
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new Error(`Could not reach the local API at ${API_BASE}`);
  }
}

function bearer(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

// Error bodies are `{ message }` from the local server, but a proxy 502 or an
// empty body is possible too, so never assume JSON.
async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { message?: unknown } | null)?.message;
    if (typeof message === 'string' && message) return message;
  } catch {
    // fall through
  }
  return fallback;
}

export const signIn: typeof Real.signIn = async (email, password) => {
  const response = await request('/local/auth/sign-in', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Sign in failed'));
  }
  const session: Session = await response.json();
  writeSession(session);
  return { isSignedIn: true, nextStep: { signInStep: 'DONE' } };
};

export const signOut: typeof Real.signOut = async () => {
  const session = readSession();
  if (session) {
    // Best effort: the browser is signing out whether or not the server
    // still knows about the token, and Layout.tsx redirects only on resolve.
    try {
      await request('/local/auth/sign-out', { method: 'POST', headers: bearer(session.token) });
    } catch {
      // ignore
    }
  }
  clearSession();
};

export const getCurrentUser: typeof Real.getCurrentUser = async () => {
  const session = readSession();
  if (!session) {
    throw new Error('Not signed in');
  }
  // Always confirm with the server: `docker compose down -v` wipes its
  // sessions while the browser still holds a token, and without this check
  // the app would look signed in while every API call 401s.
  const response = await request('/local/auth/session', { headers: bearer(session.token) });
  if (response.status === 401) {
    clearSession();
    throw new Error('Session expired');
  }
  if (!response.ok) {
    // Keep the stored session: a 5xx says nothing about whether the token is
    // still valid, and a reload should not force a fresh sign-in.
    throw new Error(await errorMessage(response, 'Could not verify session'));
  }
  const { userId, username }: { userId: string; username: string } = await response.json();
  return { username, userId };
};

export const confirmPasswordReset: typeof Real.confirmPasswordReset = async (email, code, newPassword) => {
  const response = await request('/local/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, code, newPassword }),
  });
  if (!response.ok) {
    throw new Error(await errorMessage(response, 'Password reset failed'));
  }
};

// The local server has no forced-password-change flow, so sign-in never
// answers CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED and Login.tsx never
// reaches this. It exists only to keep the module shape.
export const confirmNewPassword: typeof Real.confirmNewPassword = async () => {
  return { isSignedIn: true, nextStep: { signInStep: 'DONE' } };
};

// Storage only, no round trip: api.ts calls this before every request, so
// validating here would double the traffic. getCurrentUser does the check.
export const getAuthToken: typeof Real.getAuthToken = async () => {
  const session = readSession();
  if (!session) {
    throw new Error('No auth token available');
  }
  return session.token;
};

// Drift guard: fails `tsc -b` if utils/auth.ts gains an export this stub lacks
// (missing property) or the stub keeps one upstream removed (excess property).
// An expression statement rather than a const because noUnusedLocals would
// reject an unused binding.
({
  signIn,
  signOut,
  getCurrentUser,
  confirmPasswordReset,
  confirmNewPassword,
  getAuthToken,
}) satisfies typeof Real;
