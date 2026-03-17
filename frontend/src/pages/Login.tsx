import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signIn } from '../utils/auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="grain min-h-screen flex items-center justify-center relative"
      style={{ background: 'var(--surface-0)' }}
    >
      {/* Ambient glow */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(201, 162, 39, 0.06), transparent 70%)' }}
      />

      <div className="card-elevated p-10 w-full max-w-sm animate-in relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center font-display font-bold text-2xl mb-4"
            style={{ background: 'linear-gradient(135deg, var(--gold), var(--gold-bright))', color: 'var(--surface-0)' }}
          >
            F
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            FinTrack
          </h1>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
            Track your path to financial independence
          </p>
        </div>

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
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="input-dark"
              placeholder="Enter your password"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-gold w-full py-2.5"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
