import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CHANGE_REQUEST_STATUSES,
  formatDateTime,
  type ChangeRequestDto,
  type ChangeRequestStatus,
  type Paginated,
} from '@cm/shared';
import { api, qs } from '../../lib/api';
import { Card, Empty, Loading, Notice, PageHead, Pager, RequestBadge } from '../../components/ui';

export function AdminRequests() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | ChangeRequestStatus>('PENDING');
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const pageSize = 25;

  const list = useQuery({
    queryKey: ['admin', 'requests', status, page],
    queryFn: () =>
      api.get<Paginated<ChangeRequestDto>>(
        `/api/admin/change-requests${qs({ status, page, pageSize })}`,
      ),
  });

  const review = useMutation({
    mutationFn: (v: { id: string; status: 'APPROVED' | 'REJECTED'; reviewNote: string }) =>
      api.patch(`/api/admin/change-requests/${v.id}`, {
        status: v.status,
        reviewNote: v.reviewNote || null,
      }),
    onSuccess: () => {
      setError('');
      qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  function decide(r: ChangeRequestDto, decision: 'APPROVED' | 'REJECTED') {
    const reviewNote = prompt(
      `Note for ${r.requester.realName} (optional):`,
      decision === 'APPROVED' ? 'Approved.' : 'Not possible this term.',
    );
    if (reviewNote === null) return; // cancelled the prompt
    review.mutate({ id: r.id, status: decision, reviewNote });
  }

  return (
    <>
      <PageHead
        title="Change requests"
        subtitle="Schedule, room and roster changes submitted by teachers."
      />

      <Notice kind="error">{error}</Notice>

      <div className="toolbar">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as '' | ChangeRequestStatus);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {CHANGE_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <Card>
        {list.isLoading && <Loading what="requests" />}
        {list.data?.items.length === 0 && <Empty>Nothing here — no requests match.</Empty>}
        {list.data && list.data.items.length > 0 && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Submitted</th>
                    <th>Teacher</th>
                    <th>Type</th>
                    <th>Class</th>
                    <th>Details</th>
                    <th>Proposed</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDateTime(r.createdAt)}</td>
                      <td>{r.requester.realName}</td>
                      <td>{r.type.replace(/_/g, ' ').toLowerCase()}</td>
                      <td>
                        {r.course ? <span className="mono">{r.course.code}</span> : '—'}
                        {r.session && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {formatDateTime(r.session.startsAt)}
                          </div>
                        )}
                      </td>
                      <td className="wrap">{r.details}</td>
                      <td>{r.proposedValue ?? '—'}</td>
                      <td>
                        <RequestBadge status={r.status} />
                        {r.reviewNote && (
                          <div className="muted" style={{ fontSize: 12 }}>
                            {r.reviewNote}
                          </div>
                        )}
                      </td>
                      <td>
                        {r.status === 'PENDING' ? (
                          <div className="btn-row">
                            <button
                              className="small primary"
                              disabled={review.isPending}
                              onClick={() => decide(r, 'APPROVED')}
                            >
                              Approve
                            </button>
                            <button
                              className="small danger"
                              disabled={review.isPending}
                              onClick={() => decide(r, 'REJECTED')}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="muted">
                            {r.reviewedAt ? formatDateTime(r.reviewedAt) : 'reviewed'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Card title="What approval does">
        <p className="muted" style={{ margin: 0 }}>
          Approving a <strong>Cancel session</strong> request marks that session cancelled straight
          away. Other types are recorded as decisions — apply the actual schedule or room edit on the
          class page.
        </p>
      </Card>
    </>
  );
}
