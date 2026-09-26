import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatDateTime,
  type CourseSummary,
  type EnrollmentStatus,
  type Paginated,
  type PublicUser,
  type SessionDto,
} from '@cm/shared';
import { api } from '../../lib/api';
import {
  Card,
  Empty,
  EnrollmentBadge,
  Field,
  Loading,
  Notice,
  PageHead,
  SessionBadge,
  SlotList,
} from '../../components/ui';
import { ClassModal } from './Classes';

interface CourseDetail extends CourseSummary {
  roster: {
    id: string;
    username: string;
    realName: string;
    email: string;
    enrollmentStatus: EnrollmentStatus;
  }[];
  sessions: SessionDto[];
}

export function AdminClassDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [studentId, setStudentId] = useState('');
  const [range, setRange] = useState(() => {
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + 60);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  });

  const course = useQuery({
    queryKey: ['admin', 'course', id],
    queryFn: () => api.get<CourseDetail>(`/api/admin/courses/${id}`),
  });
  const students = useQuery({
    queryKey: ['admin', 'users', 'students'],
    queryFn: () => api.get<Paginated<PublicUser>>('/api/admin/users?role=STUDENT&pageSize=500'),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });
  const fail = (e: Error) => {
    setNote('');
    setError(e.message);
  };

  const enroll = useMutation({
    mutationFn: (payload: { studentId: string; status: EnrollmentStatus }) =>
      api.post(`/api/admin/courses/${id}/enrollments`, payload),
    onSuccess: () => {
      setError('');
      setStudentId('');
      refresh();
    },
    onError: fail,
  });

  const unenroll = useMutation({
    mutationFn: (sid: string) => api.del(`/api/admin/courses/${id}/enrollments/${sid}`),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: fail,
  });

  const generate = useMutation({
    mutationFn: (replaceExisting: boolean) =>
      api.post<{ created: number; considered: number }>(`/api/admin/courses/${id}/sessions`, {
        from: range.from,
        to: range.to,
        replaceExisting,
      }),
    onSuccess: (res) => {
      setError('');
      setNote(`Created ${res.created} session${res.created === 1 ? '' : 's'} (${res.considered} in range).`);
      refresh();
    },
    onError: fail,
  });

  const dropSession = useMutation({
    mutationFn: (sid: string) => api.del(`/api/admin/sessions/${sid}`),
    onSuccess: refresh,
    onError: fail,
  });

  if (course.isLoading) return <Loading what="this class" />;
  if (course.isError || !course.data)
    return <Notice kind="error">This class could not be loaded.</Notice>;

  const c = course.data;
  const onRoster = new Set(c.roster.map((r) => r.id));
  const available = (students.data?.items ?? []).filter((s) => !onRoster.has(s.id));

  return (
    <>
      <PageHead
        title={`${c.code} — ${c.name}`}
        subtitle={`${c.term} · ${c.room ?? 'no room'} · ${c.enrolledCount}/${c.capacity} enrolled`}
        actions={
          <>
            <Link to="/admin/classes">
              <button>← All classes</button>
            </Link>
            <button className="primary" onClick={() => setEditing(true)}>
              Edit class
            </button>
          </>
        }
      />

      <Notice kind="error">{error}</Notice>
      <Notice kind="success">{note}</Notice>

      <Card title="Details">
        <div className="field-row">
          <div>
            <h3>Teacher</h3>
            {c.teacher ? (
              <>
                {c.teacher.realName} <span className="muted mono">{c.teacher.username}</span>
              </>
            ) : (
              <span className="badge warn">Unassigned — edit the class to assign one</span>
            )}
          </div>
          <div>
            <h3>Weekly times</h3>
            <SlotList slots={c.slots} />
          </div>
          <div>
            <h3>Status</h3>
            {c.active ? <span className="badge ok">Active</span> : <span className="badge">Inactive</span>}
          </div>
        </div>
        {c.description && <p className="muted">{c.description}</p>}
      </Card>

      <Card title={`Roster (${c.roster.length})`}>
        <div className="toolbar">
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={{ minWidth: 260 }}>
            <option value="">Add a student…</option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.realName} ({s.username})
              </option>
            ))}
          </select>
          <button
            disabled={!studentId || enroll.isPending}
            onClick={() => enroll.mutate({ studentId, status: 'ENROLLED' })}
          >
            Enroll
          </button>
          <button
            disabled={!studentId || enroll.isPending}
            onClick={() => enroll.mutate({ studentId, status: 'WAITLISTED' })}
          >
            Add to waitlist
          </button>
        </div>

        {c.roster.length === 0 ? (
          <Empty>Nobody is enrolled yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {c.roster.map((s) => (
                  <tr key={s.id}>
                    <td>{s.realName}</td>
                    <td className="mono">{s.username}</td>
                    <td>{s.email}</td>
                    <td>
                      <EnrollmentBadge status={s.enrollmentStatus} />
                    </td>
                    <td>
                      <button className="small danger" onClick={() => unenroll.mutate(s.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Sessions (${c.sessions.length})`}>
        <div className="toolbar">
          <Field label="From">
            <input
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </Field>
          <Field label="To">
            <input
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </Field>
          <button disabled={generate.isPending} onClick={() => generate.mutate(false)}>
            Generate sessions
          </button>
          <button
            className="danger"
            disabled={generate.isPending}
            onClick={() => {
              if (confirm('Replace every session in that range? Attendance recorded against them is deleted too.'))
                generate.mutate(true);
            }}
          >
            Regenerate (replace)
          </button>
        </div>

        {c.sessions.length === 0 ? (
          <Empty>No sessions yet — set weekly times, then generate over a date range.</Empty>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Room</th>
                  <th>Status</th>
                  <th>Teacher check-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {c.sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDateTime(s.startsAt)}</td>
                    <td>{s.room ?? '—'}</td>
                    <td>
                      <SessionBadge status={s.status} />
                    </td>
                    <td>
                      {s.teacherCheckedInAt ? (
                        formatDateTime(s.teacherCheckedInAt)
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <button className="small danger" onClick={() => dropSession.mutate(s.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {editing && <ClassModal course={c} onClose={() => setEditing(false)} />}
    </>
  );
}
