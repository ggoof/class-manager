import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLES, type Paginated, type PublicUser, type Role } from '@cm/shared';
import { api, downloadCsv, qs } from '../../lib/api';
import {
  Card,
  Empty,
  Field,
  Loading,
  Modal,
  Notice,
  PageHead,
  Pager,
  RoleBadge,
} from '../../components/ui';

const BLANK = {
  username: '',
  password: '',
  role: 'STUDENT' as Role,
  realName: '',
  email: '',
  age: '',
  phone: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelation: '',
  active: true,
};
type FormState = typeof BLANK;

export function AdminUsers() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'' | Role>('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<PublicUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const pageSize = 25;
  const list = useQuery({
    queryKey: ['admin', 'users', search, role, page],
    queryFn: () =>
      api.get<Paginated<PublicUser>>(`/api/admin/users${qs({ q: search, role, page, pageSize })}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <>
      <PageHead
        title="Users"
        subtitle="Every account in the system. Create, edit, deactivate or export."
        actions={
          <>
            <button onClick={() => downloadCsv('/api/admin/export/user', 'users.csv')}>
              Export CSV
            </button>
            <button className="primary" onClick={() => setCreating(true)}>
              New user
            </button>
          </>
        }
      />

      <Notice kind="error">{error}</Notice>

      <div className="toolbar">
        <input
          placeholder="Search name, username, email or phone…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          style={{ minWidth: 300 }}
        />
        <select
          value={role}
          onChange={(e) => {
            setRole(e.target.value as '' | Role);
            setPage(1);
          }}
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <Card>
        {list.isLoading && <Loading what="users" />}
        {list.data?.items.length === 0 && <Empty>No users match that search.</Empty>}
        {list.data && list.data.items.length > 0 && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Age</th>
                    <th>Emergency contact</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.realName}</strong>
                      </td>
                      <td className="mono">{u.username}</td>
                      <td>
                        <RoleBadge role={u.role} />
                      </td>
                      <td>{u.email}</td>
                      <td>{u.phone ?? '—'}</td>
                      <td className="num">{u.age ?? '—'}</td>
                      <td>
                        {u.emergencyContactName ? (
                          <>
                            {u.emergencyContactName}
                            <span className="muted">
                              {' '}
                              ({u.emergencyContactRelation ?? 'contact'}) {u.emergencyContactPhone}
                            </span>
                          </>
                        ) : (
                          <span className="muted">Not provided</span>
                        )}
                      </td>
                      <td>
                        {u.active ? (
                          <span className="badge ok">Active</span>
                        ) : (
                          <span className="badge bad">Disabled</span>
                        )}
                      </td>
                      <td>
                        <div className="btn-row">
                          <button className="small" onClick={() => setEditing(u)}>
                            Edit
                          </button>
                          <button
                            className="small danger"
                            onClick={() => {
                              if (confirm(`Permanently delete ${u.realName}? This cannot be undone.`))
                                remove.mutate(u.id);
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      {creating && <UserModal onClose={() => setCreating(false)} />}
      {editing && <UserModal user={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function UserModal({ user, onClose }: { user?: PublicUser; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState<FormState>(
    user
      ? {
          ...BLANK,
          username: user.username,
          role: user.role,
          realName: user.realName,
          email: user.email,
          age: user.age?.toString() ?? '',
          phone: user.phone ?? '',
          emergencyContactName: user.emergencyContactName ?? '',
          emergencyContactPhone: user.emergencyContactPhone ?? '',
          emergencyContactRelation: user.emergencyContactRelation ?? '',
          active: user.active,
        }
      : BLANK,
  );

  const set = (k: keyof FormState) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        realName: form.realName,
        email: form.email,
        role: form.role,
        active: form.active,
        age: form.age ? Number(form.age) : null,
        phone: form.phone || null,
        emergencyContactName: form.emergencyContactName || null,
        emergencyContactPhone: form.emergencyContactPhone || null,
        emergencyContactRelation: form.emergencyContactRelation || null,
      };
      return user
        ? api.patch(`/api/admin/users/${user.id}`, {
            ...payload,
            // An empty box means "leave the password alone".
            ...(form.password ? { password: form.password } : {}),
          })
        : api.post('/api/admin/users', {
            ...payload,
            username: form.username,
            password: form.password,
          });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    save.mutate();
  }

  return (
    <Modal
      title={user ? `Edit ${user.realName}` : 'New user'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" form="user-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit}>
        <Notice kind="error">{error}</Notice>

        <div className="field-row">
          <Field label="Username" hint={user ? 'Cannot be changed after creation' : undefined}>
            <input value={form.username} onChange={set('username')} disabled={!!user} required />
          </Field>
          <Field label="Real name">
            <input value={form.realName} onChange={set('realName')} required />
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={set('role')}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
        </div>

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

        <h3>Emergency contact</h3>
        <div className="field-row">
          <Field label="Name">
            <input value={form.emergencyContactName} onChange={set('emergencyContactName')} />
          </Field>
          <Field label="Phone">
            <input value={form.emergencyContactPhone} onChange={set('emergencyContactPhone')} />
          </Field>
          <Field label="Relationship">
            <input value={form.emergencyContactRelation} onChange={set('emergencyContactRelation')} />
          </Field>
        </div>

        <div className="field-row">
          <Field
            label={user ? 'Reset password' : 'Password'}
            hint={user ? 'Leave blank to keep the current password' : 'At least 8 characters'}
          >
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
              required={!user}
            />
          </Field>
          <Field label="Account status">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 8 }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              <span style={{ fontWeight: 400 }}>Active — can sign in</span>
            </label>
          </Field>
        </div>
      </form>
    </Modal>
  );
}
