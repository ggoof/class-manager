import { useQuery } from '@tanstack/react-query';
import { formatDateTime, type AttendanceStatus } from '@cm/shared';
import { api } from '../../lib/api';
import { AttendanceBadge, Card, Empty, Loading, PageHead } from '../../components/ui';

interface Mark {
  id: string;
  status: AttendanceStatus;
  note: string | null;
  startsAt: string;
  courseCode: string;
  courseName: string;
}

export function StudentAttendance() {
  const marks = useQuery({
    queryKey: ['student', 'attendance'],
    queryFn: () => api.get<Mark[]>('/api/student/attendance'),
  });

  const total = marks.data?.length ?? 0;
  const present = marks.data?.filter((m) => m.status === 'PRESENT').length ?? 0;
  const rate = total ? Math.round((present / total) * 100) : null;

  return (
    <>
      <PageHead title="My attendance" subtitle="Every register your teachers have taken." />

      {marks.data && total > 0 && (
        <div className="grid" style={{ marginBottom: 18 }}>
          <Stat label="Sessions recorded" value={String(total)} />
          <Stat label="Marked present" value={String(present)} />
          <Stat label="Attendance rate" value={rate === null ? '—' : `${rate}%`} />
          <Stat
            label="Absences"
            value={String(marks.data.filter((m) => m.status === 'ABSENT').length)}
          />
        </div>
      )}

      <Card>
        {marks.isLoading && <Loading what="your attendance" />}
        {marks.data?.length === 0 && (
          <Empty>No attendance has been recorded for you yet.</Empty>
        )}
        {marks.data && marks.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Class</th>
                  <th>Status</th>
                  <th>Note from your teacher</th>
                </tr>
              </thead>
              <tbody>
                {marks.data.map((m) => (
                  <tr key={m.id}>
                    <td>{formatDateTime(m.startsAt)}</td>
                    <td>
                      <span className="mono">{m.courseCode}</span> {m.courseName}
                    </td>
                    <td>
                      <AttendanceBadge status={m.status} />
                    </td>
                    <td className="wrap">{m.note ?? <span className="muted">—</span>}</td>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}
