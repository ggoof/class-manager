import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ScheduleSlotDto } from '@cm/shared';
import { api } from '../../lib/api';
import { Card, Empty, EnrollmentBadge, Loading, Modal, PageHead, SlotList } from '../../components/ui';
import type { EnrollmentStatus } from '@cm/shared';

interface TeacherCourse {
  id: string;
  code: string;
  name: string;
  description: string | null;
  room: string | null;
  term: string;
  capacity: number;
  active: boolean;
  slots: ScheduleSlotDto[];
  enrolledCount: number;
  sessionCount: number;
}

interface Student {
  studentId: string;
  username: string;
  realName: string;
  email: string;
  phone: string | null;
  age: number | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  enrollmentStatus: EnrollmentStatus;
}

export function TeacherClasses() {
  const [viewing, setViewing] = useState<TeacherCourse | null>(null);
  const classes = useQuery({
    queryKey: ['teacher', 'classes'],
    queryFn: () => api.get<TeacherCourse[]>('/api/teacher/classes'),
  });

  return (
    <>
      <PageHead title="My classes" subtitle="The classes you have been assigned to teach." />

      {classes.isLoading && <Loading what="your classes" />}
      {classes.data?.length === 0 && (
        <Card>
          <Empty>You have not been assigned any classes yet. An administrator assigns these.</Empty>
        </Card>
      )}

      {classes.data?.map((c) => (
        <Card
          key={c.id}
          title={`${c.code} — ${c.name}`}
          actions={
            <button className="primary" onClick={() => setViewing(c)}>
              View students ({c.enrolledCount})
            </button>
          }
        >
          <div className="field-row">
            <div>
              <h3>Weekly times</h3>
              <SlotList slots={c.slots} />
            </div>
            <div>
              <h3>Room</h3>
              {c.room ?? '—'}
            </div>
            <div>
              <h3>Term</h3>
              {c.term}
            </div>
            <div>
              <h3>Enrolment</h3>
              {c.enrolledCount} / {c.capacity} · {c.sessionCount} sessions
            </div>
          </div>
          {c.description && <p className="muted">{c.description}</p>}
        </Card>
      ))}

      {viewing && <StudentsModal course={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function StudentsModal({ course, onClose }: { course: TeacherCourse; onClose: () => void }) {
  const students = useQuery({
    queryKey: ['teacher', 'students', course.id],
    queryFn: () => api.get<Student[]>(`/api/teacher/classes/${course.id}/students`),
  });

  return (
    <Modal title={`${course.code} students`} onClose={onClose} wide>
      {students.isLoading && <Loading what="the roster" />}
      {students.data?.length === 0 && <Empty>Nobody is enrolled in this class yet.</Empty>}
      {students.data && students.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Age</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Emergency contact</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {students.data.map((s) => (
                <tr key={s.studentId}>
                  <td>
                    <strong>{s.realName}</strong>
                    <div className="muted mono" style={{ fontSize: 12 }}>
                      {s.username}
                    </div>
                  </td>
                  <td className="num">{s.age ?? '—'}</td>
                  <td>{s.email}</td>
                  <td>{s.phone ?? '—'}</td>
                  <td>
                    {s.emergencyContactName ? (
                      <>
                        {s.emergencyContactName}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {s.emergencyContactRelation ?? 'contact'} · {s.emergencyContactPhone ?? '—'}
                        </div>
                      </>
                    ) : (
                      <span className="muted">Not provided</span>
                    )}
                  </td>
                  <td>
                    <EnrollmentBadge status={s.enrollmentStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
