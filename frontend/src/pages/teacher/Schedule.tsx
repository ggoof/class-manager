import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatTimeRange, type SessionDto } from '@cm/shared';
import { api } from '../../lib/api';
import { Card, Empty, Loading, PageHead, SessionBadge } from '../../components/ui';

/** Shared by the teacher and student schedule screens. */
export function useWeek() {
  const [offset, setOffset] = useState(0);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay() + offset * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const label =
    offset === 0
      ? 'This week'
      : offset === 1
        ? 'Next week'
        : offset === -1
          ? 'Last week'
          : `${start.toLocaleDateString()} – ${new Date(end.getTime() - 1).toLocaleDateString()}`;

  return { start, end, offset, setOffset, label };
}

export function WeekNav({ week }: { week: ReturnType<typeof useWeek> }) {
  return (
    <div className="toolbar">
      <button onClick={() => week.setOffset(week.offset - 1)}>← Previous</button>
      <button onClick={() => week.setOffset(0)} disabled={week.offset === 0}>
        Today
      </button>
      <button onClick={() => week.setOffset(week.offset + 1)}>Next →</button>
      <strong style={{ marginLeft: 8 }}>{week.label}</strong>
      <span className="muted">
        {week.start.toLocaleDateString()} – {new Date(week.end.getTime() - 1).toLocaleDateString()}
      </span>
    </div>
  );
}

/** Groups sessions under a heading per calendar day. */
export function SessionsByDay({
  sessions,
  renderAction,
}: {
  sessions: SessionDto[];
  renderAction?: (s: SessionDto) => React.ReactNode;
}) {
  const days = new Map<string, SessionDto[]>();
  for (const s of sessions) {
    const key = new Date(s.startsAt).toDateString();
    days.set(key, [...(days.get(key) ?? []), s]);
  }

  return (
    <>
      {[...days.entries()].map(([day, items]) => (
        <div className="day-group" key={day}>
          <h3>
            {new Date(day).toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
          </h3>
          {items.map((s) => (
            <div className={s.status === 'CANCELLED' ? 'session-row cancelled' : 'session-row'} key={s.id}>
              <span className="time">{formatTimeRange(s.startsAt, s.endsAt)}</span>
              <span>
                <strong className="mono">{s.courseCode}</strong> {s.courseName}
                <span className="who">
                  {' '}
                  · {s.room ?? 'no room'}
                  {s.teacherName ? ` · ${s.teacherName}` : ''}
                </span>
              </span>
              <span className="spacer" />
              <SessionBadge status={s.status} />
              {renderAction?.(s)}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

export function TeacherSchedule() {
  const week = useWeek();
  const sessions = useQuery({
    queryKey: ['teacher', 'schedule', week.start.toISOString()],
    queryFn: () =>
      api.get<SessionDto[]>(
        `/api/teacher/schedule?from=${week.start.toISOString()}&to=${week.end.toISOString()}`,
      ),
  });

  return (
    <>
      <PageHead
        title="My schedule"
        subtitle="Open a session to check yourself in and take the register."
      />
      <WeekNav week={week} />

      <Card>
        {sessions.isLoading && <Loading what="your schedule" />}
        {sessions.data?.length === 0 && <Empty>You have no classes scheduled this week.</Empty>}
        {sessions.data && sessions.data.length > 0 && (
          <SessionsByDay
            sessions={sessions.data}
            renderAction={(s) => (
              <>
                {s.teacherCheckedInAt && <span className="badge ok">checked in</span>}
                <Link to={`/teacher/sessions/${s.id}`}>
                  <button className="small primary">Open</button>
                </Link>
              </>
            )}
          />
        )}
      </Card>
    </>
  );
}
