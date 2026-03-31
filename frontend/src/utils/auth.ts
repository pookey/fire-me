import { Amplify } from 'aws-amplify';
import { signIn as amplifySignIn, signOut as amplifySignOut, getCurrentUser as amplifyGetCurrentUser, fetchAuthSession, confirmResetPassword as amplifyConfirmResetPassword, confirmSignIn as amplifyConfirmSignIn } from '@aws-amplify/auth';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_USER_POOL_ID || 'PLACEHOLDER_USER_POOL_ID',
      userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID || 'PLACEHOLDER_USER_POOL_CLIENT_ID',
    },
  },
});

export async function signIn(username: string, password: string) {
  return amplifySignIn({ username, password });
}

export async function signOut() {
  return amplifySignOut();
}

export async function getCurrentUser() {
  return amplifyGetCurrentUser();
}

export async function confirmPasswordReset(username: string, confirmationCode: string, newPassword: string) {
  return amplifyConfirmResetPassword({ username, confirmationCode, newPassword });
}

export async function confirmNewPassword(newPassword: string) {
  return amplifyConfirmSignIn({ challengeResponse: newPassword });
}

export async function getAuthToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  if (!token) {
    throw new Error('No auth token available');
  }
  return token;
}
