import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { homeFor, useAuth } from '../lib/auth';
import { Field, Loading, Notice } from '../components/ui';

const BLANK = {
  username: '',
  password: '',
  confirm: '',
  realName: '',
  email: '',
  age: '',
  phone: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelation: '',
};

export function Register() {
  const { user, loading, register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(BLANK);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading what="your account" />;
  if (user) return <Navigate to={homeFor[user.role]} replace />;

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const created = await register({
        username: form.username,
        password: form.password,
        realName: form.realName,
        email: form.email,
        age: form.age ? Number(form.age) : null,
        phone: form.phone || null,
        emergencyContactName: form.emergencyContactName || null,
        emergencyContactPhone: form.emergencyContactPhone || null,
        emergencyContactRelation: form.emergencyContactRelation || null,
      });
      navigate(homeFor[created.role], { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-up failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" style={{ maxWidth: 520 }} onSubmit={submit}>
        <h1>Create your account</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
          Sign up as a student. You can browse classes and select the ones you want straight away.
        </p>

        <Notice kind="error">{error}</Notice>

        <div className="field-row">
          <Field label="Username" hint="Letters, digits, dot, underscore, dash">
            <input value={form.username} onChange={set('username')} autoComplete="username" required />
          </Field>
          <Field label="Full name">
            <input value={form.realName} onChange={set('realName')} required />
          </Field>
        </div>

        <div className="field-row">
          <Field label="Email">
            <input type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
          </Field>
          <Field label="Phone">
            <input value={form.phone} onChange={set('phone')} autoComplete="tel" />
          </Field>
          <Field label="Age">
            <input type="number" min={3} max={120} value={form.age} onChange={set('age')} />
          </Field>
        </div>

        <div className="field-row">
          <Field label="Password" hint="At least 8 characters">
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
              required
            />
          </Field>
          <Field label="Confirm password">
            <input
              type="password"
              value={form.confirm}
              onChange={set('confirm')}
              autoComplete="new-password"
              required
            />
          </Field>
        </div>

        <h3 style={{ marginTop: 8 }}>Emergency contact</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Optional now — you can add or change this later on your profile.
        </p>
        <div className="field-row">
          <Field label="Name">
            <input value={form.emergencyContactName} onChange={set('emergencyContactName')} />
          </Field>
          <Field label="Phone">
            <input value={form.emergencyContactPhone} onChange={set('emergencyContactPhone')} />
          </Field>
          <Field label="Relationship">
            <input
              value={form.emergencyContactRelation}
              onChange={set('emergencyContactRelation')}
              placeholder="Parent, guardian…"
            />
          </Field>
        </div>

        <button className="primary" style={{ width: '100%', marginTop: 4 }} disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </button>

        <div className="demo-accounts">
          Already have an account? <Link to="/login">Sign in</Link>.
        </div>
      </form>
    </div>
  );
}
