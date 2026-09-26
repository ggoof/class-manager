import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DAY_NAMES,
  type CourseSummary,
  type EnrollmentStatus,
  type Paginated,
} from '@cm/shared';
import { api, qs } from '../../lib/api';
import {
  Card,
  Empty,
  EnrollmentBadge,
  Loading,
  Notice,
  PageHead,
  Pager,
  SlotList,
} from '../../components/ui';

interface CatalogEntry extends CourseSummary {
  seatsLeft: number;
  myStatus: EnrollmentStatus | null;
}

export function StudentCatalog() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [day, setDay] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const pageSize = 20;

  const catalog = useQuery({
    queryKey: ['student', 'catalog', search, day, page],
    queryFn: () =>
      api.get<Paginated<CatalogEntry>>(
        `/api/student/catalog${qs({ q: search, dayOfWeek: day, page, pageSize })}`,
      ),
  });

  const select = useMutation({
    mutationFn: (courseId: string) =>
      api.post<{ status: EnrollmentStatus }>('/api/student/enrollments', { courseId }),
    onSuccess: (res) => {
      setError('');
      setNote(
        res.status === 'WAITLISTED'
          ? 'That class was full, so you have been added to the waitlist.'
          : 'You are signed up.',
      );
      qc.invalidateQueries({ queryKey: ['student'] });
    },
    onError: (e: Error) => {
      setNote('');
      setError(e.message);
    },
  });

  const drop = useMutation({
    mutationFn: (courseId: string) => api.del(`/api/student/enrollments/${courseId}`),
    onSuccess: () => {
      setError('');
      setNote('You have been removed from that class.');
      qc.invalidateQueries({ queryKey: ['student'] });
    },
    onError: (e: Error) => {
      setNote('');
      setError(e.message);
    },
  });

  return (
    <>
      <PageHead
        title="Find a class"
        subtitle="Search by class name, code, description or teacher — then sign yourself up."
      />

      <Notice kind="error">{error}</Notice>
      <Notice kind="success">{note}</Notice>

      <div className="toolbar">
        <input
          placeholder="Search classes or teachers…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          style={{ minWidth: 300 }}
        />
        <select
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            setPage(1);
          }}
        >
          <option value="">Any day</option>
          {DAY_NAMES.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <Card>
        {catalog.isLoading && <Loading what="the catalog" />}
        {catalog.data?.items.length === 0 && <Empty>No classes match that search.</Empty>}
        {catalog.data && catalog.data.items.length > 0 && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Class</th>
                    <th>Teacher</th>
                    <th>Weekly times</th>
                    <th>Room</th>
                    <th>Seats</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {catalog.data.items.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">{c.code}</td>
                      <td className="wrap">
                        <strong>{c.name}</strong>
                        {c.description && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {c.description}
                          </div>
                        )}
                      </td>
                      <td>{c.teacher?.realName ?? <span className="muted">Unassigned</span>}</td>
                      <td>
                        <SlotList slots={c.slots} />
                      </td>
                      <td>{c.room ?? '—'}</td>
                      <td className="num">
                        {c.seatsLeft > 0 ? (
                          `${c.seatsLeft} of ${c.capacity}`
                        ) : (
                          <span className="badge warn">Full</span>
                        )}
                      </td>
                      <td>
                        {c.myStatus && c.myStatus !== 'DROPPED' ? (
                          <div className="btn-row">
                            <EnrollmentBadge status={c.myStatus} />
                            <button
                              className="small danger"
                              disabled={drop.isPending}
                              onClick={() => drop.mutate(c.id)}
                            >
                              Drop
                            </button>
                          </div>
                        ) : (
                          <button
                            className="small primary"
                            disabled={select.isPending}
                            onClick={() => select.mutate(c.id)}
                          >
                            {c.seatsLeft > 0 ? 'Select' : 'Join waitlist'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={pageSize} total={catalog.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Card>
        <p className="muted" style={{ margin: 0 }}>
          You cannot sign up for two classes that meet at the same time — the system checks your
          timetable and will tell you which class clashes.
        </p>
      </Card>
    </>
  );
}
