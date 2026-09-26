import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { homeFor, useAuth } from '../lib/auth';
import { Field, Loading, Notice } from '../components/ui';

const DEMO = [
  ['admin', 'Admin'],
  ['tanaka', 'Teacher'],
  ['alice', 'Student'],
] as const;

export function Login() {
  const { user, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading what="your account" />;
  if (user) return <Navigate to={homeFor[user.role]} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const signedIn = await signIn(username, password);
      navigate(homeFor[signedIn.role], { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>Class Manager</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
          Sign in to your account.
        </p>

        <Notice kind="error">{error}</Notice>

        <Field label="Username">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>

        <button className="primary" style={{ width: '100%' }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p style={{ textAlign: 'center', marginBottom: 0 }}>
          New here? <Link to="/register">Create a student account</Link>.
        </p>

        <div className="demo-accounts">
          Demo accounts (password <code className="mono">password123</code>):
          <div>
            {DEMO.map(([name, role]) => (
              <button
                key={name}
                type="button"
                className="small"
                onClick={() => {
                  setUsername(name);
                  setPassword('password123');
                }}
              >
                {role} · {name}
              </button>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
}
