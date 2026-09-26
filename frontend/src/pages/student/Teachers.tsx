import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../../lib/api';
import { Card, Empty, Loading, PageHead } from '../../components/ui';

interface TeacherResult {
  id: string;
  username: string;
  realName: string;
  email: string;
  courses: { id: string; code: string; name: string; term: string }[];
}

export function StudentTeachers() {
  const [search, setSearch] = useState('');
  const teachers = useQuery({
    queryKey: ['student', 'teachers', search],
    queryFn: () => api.get<TeacherResult[]>(`/api/student/teachers${qs({ q: search, pageSize: 100 })}`),
  });

  return (
    <>
      <PageHead title="Teachers" subtitle="Search teachers and see what each of them runs." />

      <div className="toolbar">
        <input
          placeholder="Search by name or username…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 300 }}
        />
      </div>

      <Card>
        {teachers.isLoading && <Loading what="teachers" />}
        {teachers.data?.length === 0 && <Empty>No teachers match that search.</Empty>}
        {teachers.data && teachers.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Teacher</th>
                  <th>Contact</th>
                  <th>Classes</th>
                </tr>
              </thead>
              <tbody>
                {teachers.data.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <strong>{t.realName}</strong>
                      <div className="muted mono" style={{ fontSize: 12 }}>
                        {t.username}
                      </div>
                    </td>
                    <td>
                      <a href={`mailto:${t.email}`}>{t.email}</a>
                    </td>
                    <td className="wrap">
                      {t.courses.length === 0 ? (
                        <span className="muted">No active classes</span>
                      ) : (
                        t.courses.map((c) => (
                          <div key={c.id}>
                            <span className="mono">{c.code}</span> {c.name}{' '}
                            <span className="muted">· {c.term}</span>
                          </div>
                        ))
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
