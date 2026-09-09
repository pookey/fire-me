// Drop-in replacement for utils/auth.ts used by vite.local.config.ts so the
// frontend runs in Docker without Cognito. Type-only import: the real module
// calls Amplify.configure() at import time, and a value import here would
// execute it (and pull the Amplify bundle back in).
import type * as Real from '../utils/auth';

// Sign-out state lives in localStorage rather than module state so it survives
// a page reload, which is what a real session would do.
const SIGNED_OUT_KEY = 'fintrack-local-signed-out';

export const signIn: typeof Real.signIn = async () => {
  localStorage.removeItem(SIGNED_OUT_KEY);
  return { isSignedIn: true, nextStep: { signInStep: 'DONE' } };
};

export const signOut: typeof Real.signOut = async () => {
  localStorage.setItem(SIGNED_OUT_KEY, '1');
};

export const getCurrentUser: typeof Real.getCurrentUser = async () => {
  if (localStorage.getItem(SIGNED_OUT_KEY)) {
    throw new Error('Signed out (local stub)');
  }
  return { username: 'local', userId: 'local' };
};

export const confirmPasswordReset: typeof Real.confirmPasswordReset = async () => {};

export const confirmNewPassword: typeof Real.confirmNewPassword = async () => {
  return { isSignedIn: true, nextStep: { signInStep: 'DONE' } };
};

// The local backend ignores the bearer token; api.ts only needs one to exist.
export const getAuthToken: typeof Real.getAuthToken = async () => 'local-dev-token';

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
