import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BROWSABLE_TABLES, type BrowsableTable, type Paginated } from '@cm/shared';
import { api, downloadCsv, qs } from '../../lib/api';
import { Card, Empty, Loading, Notice, PageHead, Pager } from '../../components/ui';

type Row = Record<string, unknown>;

export function AdminDatabase() {
  const [table, setTable] = useState<BrowsableTable>('user');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const pageSize = 50;

  const counts = useQuery({
    queryKey: ['admin', 'tables'],
    queryFn: () => api.get<{ table: BrowsableTable; count: number }[]>('/api/admin/tables'),
  });

  const rows = useQuery({
    queryKey: ['admin', 'table', table, page],
    queryFn: () => api.get<Paginated<Row>>(`/api/admin/tables/${table}${qs({ page, pageSize })}`),
  });

  const columns = rows.data?.items.length ? Object.keys(rows.data.items[0]) : [];

  return (
    <>
      <PageHead
        title="Database"
        subtitle="Read every table directly, and export any of them to CSV."
        actions={
          <button
            className="primary"
            onClick={() =>
              downloadCsv(`/api/admin/export/${table}`, `${table}.csv`).catch((e: Error) =>
                setError(e.message),
              )
            }
          >
            Export {table} as CSV
          </button>
        }
      />

      <Notice kind="error">{error}</Notice>

      <div className="toolbar">
        {BROWSABLE_TABLES.map((t) => {
          const count = counts.data?.find((c) => c.table === t)?.count;
          return (
            <button
              key={t}
              className={t === table ? 'primary small' : 'small'}
              onClick={() => {
                setTable(t);
                setPage(1);
              }}
            >
              {t}
              {count !== undefined && <span className="muted"> · {count}</span>}
            </button>
          );
        })}
      </div>

      <Card>
        {rows.isLoading && <Loading what={table} />}
        {rows.data?.items.length === 0 && <Empty>This table is empty.</Empty>}
        {rows.data && rows.data.items.length > 0 && (
          <>
            <div className="table-wrap" style={{ maxHeight: '62vh', overflow: 'auto' }}>
              <table className="mono">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.data.items.map((row, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c}>{render(row[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={pageSize} total={rows.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Card title="A note on this view">
        <p className="muted" style={{ margin: 0 }}>
          Password hashes are stripped from the <code>user</code> table before it ever leaves the
          server, in both this browser and the CSV export. Editing is deliberately done through the
          Users and Classes screens so validation and the audit log always apply.
        </p>
      </Card>
    </>
  );
}

/** Compact cell rendering: nulls dimmed, long text clipped, objects as JSON. */
function render(value: unknown) {
  if (value === null || value === undefined) return <span className="muted">null</span>;
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  const s = String(value);
  return s.length > 60 ? <span title={s}>{s.slice(0, 60)}…</span> : s;
}
