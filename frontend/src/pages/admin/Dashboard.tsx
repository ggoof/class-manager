import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { formatDateTime, type SessionDto } from '@cm/shared';
import { api } from '../../lib/api';
import { Card, Empty, Loading, PageHead, SessionBadge } from '../../components/ui';

interface Stats {
  admins: number;
  teachers: number;
  students: number;
  courses: number;
  sessions: number;
  pendingRequests: number;
  absences: number;
  unassignedCourses: number;
}

export function AdminDashboard() {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api.get<Stats>('/api/admin/stats') });
  const today = useQuery({
    queryKey: ['admin', 'schedule', 'today'],
    queryFn: () => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return api.get<SessionDto[]>(
        `/api/admin/schedule?from=${start.toISOString()}&to=${end.toISOString()}`,
      );
    },
  });

  return (
    <>
      <PageHead title="Dashboard" subtitle="Everything happening across the school." />

      {stats.isLoading && <Loading what="statistics" />}
      {stats.data && (
        <div className="grid" style={{ marginBottom: 18 }}>
          <Stat label="Students" value={stats.data.students} />
          <Stat label="Teachers" value={stats.data.teachers} />
          <Stat label="Administrators" value={stats.data.admins} />
          <Stat label="Active classes" value={stats.data.courses} />
          <Stat label="Scheduled sessions" value={stats.data.sessions} />
          <Stat label="Recorded absences" value={stats.data.absences} />
        </div>
      )}

      {stats.data && (stats.data.pendingRequests > 0 || stats.data.unassignedCourses > 0) && (
        <Card title="Needs your attention">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {stats.data.pendingRequests > 0 && (
              <li>
                <Link to="/admin/requests">
                  {stats.data.pendingRequests} change request
                  {stats.data.pendingRequests === 1 ? '' : 's'} awaiting review
                </Link>
              </li>
            )}
            {stats.data.unassignedCourses > 0 && (
              <li>
                <Link to="/admin/classes">
                  {stats.data.unassignedCourses} active class
                  {stats.data.unassignedCourses === 1 ? '' : 'es'} with no teacher assigned
                </Link>
              </li>
            )}
          </ul>
        </Card>
      )}

      <Card title="Today's sessions">
        {today.isLoading && <Loading what="today's schedule" />}
        {today.data?.length === 0 && <Empty>Nothing is scheduled for today.</Empty>}
        {today.data && today.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Class</th>
                  <th>Teacher</th>
                  <th>Room</th>
                  <th>Status</th>
                  <th>Teacher checked in</th>
                </tr>
              </thead>
              <tbody>
                {today.data.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDateTime(s.startsAt)}</td>
                    <td>
                      <strong>{s.courseCode}</strong> {s.courseName}
                    </td>
                    <td>{s.teacherName ?? <span className="muted">Unassigned</span>}</td>
                    <td>{s.room ?? '—'}</td>
                    <td>
                      <SessionBadge status={s.status} />
                    </td>
                    <td>
                      {s.teacherCheckedInAt ? (
                        formatDateTime(s.teacherCheckedInAt)
                      ) : (
                        <span className="muted">Not yet</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
