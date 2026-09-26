import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { SessionDto } from '@cm/shared';
import { api } from '../../lib/api';
import { Card, Empty, Loading, PageHead } from '../../components/ui';
import { SessionsByDay, WeekNav, useWeek } from '../teacher/Schedule';

export function StudentSchedule() {
  const week = useWeek();
  const sessions = useQuery({
    queryKey: ['student', 'schedule', week.start.toISOString()],
    queryFn: () =>
      api.get<SessionDto[]>(
        `/api/student/schedule?from=${week.start.toISOString()}&to=${week.end.toISOString()}`,
      ),
  });

  return (
    <>
      <PageHead title="My schedule" subtitle="Every class you are signed up for, week by week." />
      <WeekNav week={week} />

      <Card>
        {sessions.isLoading && <Loading what="your schedule" />}
        {sessions.data?.length === 0 && (
          <Empty>
            Nothing scheduled this week. <Link to="/student/catalog">Find a class</Link> to get
            started.
          </Empty>
        )}
        {sessions.data && sessions.data.length > 0 && <SessionsByDay sessions={sessions.data} />}
      </Card>
    </>
  );
}
