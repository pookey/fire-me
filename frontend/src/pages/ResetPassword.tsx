import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { confirmPasswordReset } from '../utils/auth';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      await confirmPasswordReset(email, code, newPassword);
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="grain min-h-screen flex items-center justify-center relative"
      style={{ background: 'var(--surface-0)' }}
    >
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(201, 162, 39, 0.06), transparent 70%)' }}
      />

      <div className="card-elevated p-10 w-full max-w-sm animate-in relative z-10">
        <div className="flex flex-col items-center mb-10">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center font-display font-bold text-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, var(--gold), var(--gold-bright))', color: 'var(--surface-0)' }}
          >
            F
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Reset Password
          </h1>
          <p className="text-xs mt-1.5 text-center" style={{ color: 'var(--text-tertiary)' }}>
            Enter the code you received and your new password
          </p>
        </div>

        {success ? (
          <div
            className="text-sm px-4 py-3 rounded-lg animate-in text-center"
            style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#86efac', border: '1px solid rgba(34, 197, 94, 0.2)' }}
          >
            Password reset successful. Redirecting to login...
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div
                className="text-sm px-4 py-3 rounded-lg animate-in"
                style={{ background: 'var(--negative-dim)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.2)' }}
              >
                {error}
              </div>
            )}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="input-dark"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                Verification Code
              </label>
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                required
                className="input-dark"
                placeholder="Enter 6-digit code"
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                required
                className="input-dark"
                placeholder="Enter new password"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                required
                className="input-dark"
                placeholder="Confirm new password"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-gold w-full py-2.5"
            >
              {loading ? 'Resetting...' : 'Reset Password'}
            </button>
            <div className="text-center">
              <Link
                to="/login"
                className="text-xs hover:underline"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
