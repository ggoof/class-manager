import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Card, Field, Notice, PageHead, RoleBadge } from '../components/ui';

export function Profile() {
  const { user, refresh } = useAuth();
  const [form, setForm] = useState({
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    age: user?.age?.toString() ?? '',
    emergencyContactName: user?.emergencyContactName ?? '',
    emergencyContactPhone: user?.emergencyContactPhone ?? '',
    emergencyContactRelation: user?.emergencyContactRelation ?? '',
  });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  if (!user) return null;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      await api.patch('/api/auth/me', {
        ...form,
        age: form.age ? Number(form.age) : null,
        phone: form.phone || null,
        emergencyContactName: form.emergencyContactName || null,
        emergencyContactPhone: form.emergencyContactPhone || null,
        emergencyContactRelation: form.emergencyContactRelation || null,
        ...(passwords.newPassword ? passwords : {}),
      });
      setPasswords({ currentPassword: '', newPassword: '' });
      setSaved('Profile saved.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  }

  return (
    <>
      <PageHead
        title="My profile"
        subtitle={`${user.realName} · ${user.username}`}
        actions={<RoleBadge role={user.role} />}
      />

      <form onSubmit={save}>
        <Notice kind="error">{error}</Notice>
        <Notice kind="success">{saved}</Notice>

        <Card title="Contact details">
          <div className="field-row">
            <Field label="Email">
              <input type="email" value={form.email} onChange={set('email')} required />
            </Field>
            <Field label="Phone">
              <input value={form.phone} onChange={set('phone')} />
            </Field>
            <Field label="Age">
              <input type="number" min={3} max={120} value={form.age} onChange={set('age')} />
            </Field>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Your username, real name and role can only be changed by an administrator.
          </p>
        </Card>

        <Card title="Emergency contact">
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
                placeholder="Parent, guardian, spouse…"
              />
            </Field>
          </div>
        </Card>

        <Card title="Change password">
          <div className="field-row">
            <Field label="Current password">
              <input
                type="password"
                value={passwords.currentPassword}
                autoComplete="current-password"
                onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })}
              />
            </Field>
            <Field label="New password" hint="At least 8 characters">
              <input
                type="password"
                value={passwords.newPassword}
                autoComplete="new-password"
                onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
              />
            </Field>
          </div>
        </Card>

        <button className="primary">Save changes</button>
      </form>
    </>
  );
}
