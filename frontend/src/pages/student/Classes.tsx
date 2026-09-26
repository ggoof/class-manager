import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EnrollmentStatus, ScheduleSlotDto } from '@cm/shared';
import { api } from '../../lib/api';
import { Card, Empty, EnrollmentBadge, Loading, Notice, PageHead, SlotList } from '../../components/ui';

interface MyEnrollment {
  enrollmentId: string;
  status: EnrollmentStatus;
  enrolledAt: string;
  course: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    room: string | null;
    term: string;
    slots: ScheduleSlotDto[];
    teacher: { id: string; realName: string; username: string; email: string } | null;
  };
}

export function StudentClasses() {
  const qc = useQueryClient();
  const [error, setError] = useState('');

  const mine = useQuery({
    queryKey: ['student', 'classes'],
    queryFn: () => api.get<MyEnrollment[]>('/api/student/classes'),
  });

  const drop = useMutation({
    mutationFn: (courseId: string) => api.del(`/api/student/enrollments/${courseId}`),
    onSuccess: () => {
      setError('');
      qc.invalidateQueries({ queryKey: ['student'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const active = mine.data?.filter((e) => e.status !== 'DROPPED') ?? [];
  const dropped = mine.data?.filter((e) => e.status === 'DROPPED') ?? [];

  return (
    <>
      <PageHead
        title="My classes"
        subtitle="Everything you are signed up for this term."
        actions={
          <Link to="/student/catalog">
            <button className="primary">Find another class</button>
          </Link>
        }
      />

      <Notice kind="error">{error}</Notice>

      {mine.isLoading && <Loading what="your classes" />}
      {mine.data && active.length === 0 && (
        <Card>
          <Empty>
            You have not selected any classes yet. <Link to="/student/catalog">Browse the catalog</Link>.
          </Empty>
        </Card>
      )}

      {active.map((e) => (
        <Card
          key={e.enrollmentId}
          title={`${e.course.code} — ${e.course.name}`}
          actions={
            <div className="btn-row">
              <EnrollmentBadge status={e.status} />
              <button
                className="small danger"
                disabled={drop.isPending}
                onClick={() => {
                  if (confirm(`Drop ${e.course.code}?`)) drop.mutate(e.course.id);
                }}
              >
                Drop this class
              </button>
            </div>
          }
        >
          <div className="field-row">
            <div>
              <h3>Teacher</h3>
              {e.course.teacher ? (
                <>
                  {e.course.teacher.realName}
                  <div className="muted" style={{ fontSize: 13 }}>
                    <a href={`mailto:${e.course.teacher.email}`}>{e.course.teacher.email}</a>
                  </div>
                </>
              ) : (
                <span className="muted">Not yet assigned</span>
              )}
            </div>
            <div>
              <h3>Weekly times</h3>
              <SlotList slots={e.course.slots} />
            </div>
            <div>
              <h3>Room</h3>
              {e.course.room ?? '—'}
            </div>
            <div>
              <h3>Term</h3>
              {e.course.term}
            </div>
          </div>
          {e.course.description && <p className="muted">{e.course.description}</p>}
        </Card>
      ))}

      {dropped.length > 0 && (
        <Card title="Dropped">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Class</th>
                  <th>Teacher</th>
                </tr>
              </thead>
              <tbody>
                {dropped.map((e) => (
                  <tr key={e.enrollmentId}>
                    <td className="mono">{e.course.code}</td>
                    <td>{e.course.name}</td>
                    <td>{e.course.teacher?.realName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
