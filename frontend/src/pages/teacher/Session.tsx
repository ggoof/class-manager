import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ATTENDANCE_STATUSES,
  formatDateTime,
  formatTimeRange,
  type AttendanceStatus,
  type RosterEntry,
  type SessionDto,
} from '@cm/shared';
import { api } from '../../lib/api';
import {
  AttendanceBadge,
  Card,
  Empty,
  EnrollmentBadge,
  Loading,
  Notice,
  PageHead,
  SessionBadge,
} from '../../components/ui';

interface SessionDetail {
  session: SessionDto;
  roster: RosterEntry[];
}

type Draft = Record<string, { status: AttendanceStatus; note: string }>;

export function TeacherSession() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const detail = useQuery({
    queryKey: ['teacher', 'session', id],
    queryFn: () => api.get<SessionDetail>(`/api/teacher/sessions/${id}`),
  });

  // Seed the register from whatever is already recorded; unmarked students
  // default to PRESENT so a full class is one click.
  useEffect(() => {
    if (!detail.data) return;
    const seeded: Draft = {};
    for (const r of detail.data.roster) {
      seeded[r.studentId] = {
        status: r.attendance?.status ?? 'PRESENT',
        note: r.attendance?.note ?? '',
      };
    }
    setDraft(seeded);
  }, [detail.data]);

  const checkIn = useMutation({
    mutationFn: () => api.post(`/api/teacher/sessions/${id}/check-in`, {}),
    onSuccess: () => {
      setError('');
      setNote('You are checked in to this class.');
      qc.invalidateQueries({ queryKey: ['teacher'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const submit = useMutation({
    mutationFn: () =>
      api.post<{ marked: number; absences: number }>(`/api/teacher/sessions/${id}/attendance`, {
        marks: Object.entries(draft).map(([studentId, d]) => ({
          studentId,
          status: d.status,
          note: d.note || null,
        })),
      }),
    onSuccess: (res) => {
      setError('');
      setNote(`Register saved — ${res.marked} students, ${res.absences} absent.`);
      qc.invalidateQueries({ queryKey: ['teacher'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const complete = useMutation({
    mutationFn: () => api.patch(`/api/teacher/sessions/${id}`, { status: 'COMPLETED' }),
    onSuccess: () => {
      setError('');
      setNote('Session marked complete.');
      qc.invalidateQueries({ queryKey: ['teacher'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  if (detail.isLoading) return <Loading what="this session" />;
  if (detail.isError || !detail.data)
    return <Notice kind="error">This session could not be loaded, or it is not one of yours.</Notice>;

  const { session, roster } = detail.data;
  const setAll = (status: AttendanceStatus) =>
    setDraft(Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, { ...v, status }])));

  const counts = ATTENDANCE_STATUSES.map((s) => ({
    status: s,
    n: Object.values(draft).filter((d) => d.status === s).length,
  })).filter((c) => c.n > 0);

  return (
    <>
      <PageHead
        title={`${session.courseCode} — ${session.courseName}`}
        subtitle={`${formatDateTime(session.startsAt)} · ${formatTimeRange(session.startsAt, session.endsAt)} · ${session.room ?? 'no room'}`}
        actions={
          <Link to="/teacher">
            <button>← Back to schedule</button>
          </Link>
        }
      />

      <Notice kind="error">{error}</Notice>
      <Notice kind="success">{note}</Notice>

      <Card title="This session">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <SessionBadge status={session.status} />
          {session.teacherCheckedInAt ? (
            <span className="badge ok">You checked in at {formatDateTime(session.teacherCheckedInAt)}</span>
          ) : (
            <button
              className="primary"
              disabled={checkIn.isPending || session.status === 'CANCELLED'}
              onClick={() => checkIn.mutate()}
            >
              Check in to this class
            </button>
          )}
          <span className="spacer" style={{ flex: 1 }} />
          <button disabled={complete.isPending || session.status !== 'SCHEDULED'} onClick={() => complete.mutate()}>
            Mark session complete
          </button>
        </div>
      </Card>

      <Card
        title={`Register (${roster.length} students)`}
        actions={
          <div className="btn-row">
            {counts.map((c) => (
              <span key={c.status} className="badge">
                {c.n} {c.status.toLowerCase()}
              </span>
            ))}
          </div>
        }
      >
        {roster.length === 0 ? (
          <Empty>Nobody is enrolled in this class yet.</Empty>
        ) : (
          <>
            <div className="toolbar">
              <span className="muted">Set everyone to:</span>
              {ATTENDANCE_STATUSES.map((s) => (
                <button key={s} className="small" onClick={() => setAll(s)}>
                  {s.toLowerCase()}
                </button>
              ))}
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Enrolment</th>
                    <th>Attendance</th>
                    <th>Note</th>
                    <th>Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => {
                    const d = draft[r.studentId];
                    if (!d) return null;
                    return (
                      <tr key={r.studentId}>
                        <td>
                          <strong>{r.realName}</strong>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {r.phone ?? r.email}
                            {r.emergencyContactPhone && ` · emergency ${r.emergencyContactPhone}`}
                          </div>
                        </td>
                        <td>
                          <EnrollmentBadge status={r.enrollmentStatus} />
                        </td>
                        <td>
                          <select
                            value={d.status}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                [r.studentId]: { ...d, status: e.target.value as AttendanceStatus },
                              })
                            }
                          >
                            {ATTENDANCE_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            placeholder={d.status === 'ABSENT' ? 'Reason for absence…' : 'Optional note'}
                            value={d.note}
                            onChange={(e) =>
                              setDraft({ ...draft, [r.studentId]: { ...d, note: e.target.value } })
                            }
                            style={{ minWidth: 220 }}
                          />
                        </td>
                        <td>
                          {r.attendance ? (
                            <AttendanceBadge status={r.attendance.status} />
                          ) : (
                            <span className="muted">not yet</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="btn-row" style={{ marginTop: 14 }}>
              <button className="primary" disabled={submit.isPending} onClick={() => submit.mutate()}>
                {submit.isPending ? 'Saving…' : 'Save register'}
              </button>
              <span className="muted" style={{ alignSelf: 'center' }}>
                Absences are reported to the admin console the moment you save.
              </span>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
