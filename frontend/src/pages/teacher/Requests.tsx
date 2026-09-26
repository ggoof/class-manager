import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CHANGE_REQUEST_TYPES,
  formatDateTime,
  type ChangeRequestStatus,
  type ChangeRequestType,
  type SessionDto,
} from '@cm/shared';
import { api } from '../../lib/api';
import { Card, Empty, Field, Loading, Modal, Notice, PageHead, RequestBadge } from '../../components/ui';

interface MyRequest {
  id: string;
  type: ChangeRequestType;
  status: ChangeRequestStatus;
  details: string;
  proposedValue: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  course: { id: string; code: string; name: string } | null;
  session: { id: string; startsAt: string } | null;
  reviewedBy: { realName: string } | null;
}

interface TeacherCourse {
  id: string;
  code: string;
  name: string;
}

const TYPE_LABEL: Record<ChangeRequestType, string> = {
  SCHEDULE_CHANGE: 'Schedule change',
  ROOM_CHANGE: 'Room change',
  CANCEL_SESSION: 'Cancel a session',
  ROSTER_CHANGE: 'Roster change',
  OTHER: 'Something else',
};

export function TeacherRequests() {
  const [open, setOpen] = useState(false);
  const requests = useQuery({
    queryKey: ['teacher', 'requests'],
    queryFn: () => api.get<MyRequest[]>('/api/teacher/change-requests'),
  });

  return (
    <>
      <PageHead
        title="Change requests"
        subtitle="Ask an administrator to change a schedule, room, roster or cancel a session."
        actions={
          <button className="primary" onClick={() => setOpen(true)}>
            New request
          </button>
        }
      />

      <Card>
        {requests.isLoading && <Loading what="your requests" />}
        {requests.data?.length === 0 && <Empty>You have not submitted any requests.</Empty>}
        {requests.data && requests.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Submitted</th>
                  <th>Type</th>
                  <th>Class</th>
                  <th>Details</th>
                  <th>Proposed</th>
                  <th>Status</th>
                  <th>Reply</th>
                </tr>
              </thead>
              <tbody>
                {requests.data.map((r) => (
                  <tr key={r.id}>
                    <td>{formatDateTime(r.createdAt)}</td>
                    <td>{TYPE_LABEL[r.type]}</td>
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
                    </td>
                    <td className="wrap">
                      {r.reviewNote ? (
                        <>
                          {r.reviewNote}
                          <div className="muted" style={{ fontSize: 12 }}>
                            {r.reviewedBy?.realName}
                            {r.reviewedAt && ` · ${formatDateTime(r.reviewedAt)}`}
                          </div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {open && <RequestModal onClose={() => setOpen(false)} />}
    </>
  );
}

function RequestModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    type: 'SCHEDULE_CHANGE' as ChangeRequestType,
    courseId: '',
    sessionId: '',
    details: '',
    proposedValue: '',
  });

  const classes = useQuery({
    queryKey: ['teacher', 'classes'],
    queryFn: () => api.get<TeacherCourse[]>('/api/teacher/classes'),
  });

  // Only needed when cancelling: the teacher's upcoming meetings.
  const upcoming = useQuery({
    enabled: form.type === 'CANCEL_SESSION',
    queryKey: ['teacher', 'upcoming'],
    queryFn: () => {
      const from = new Date().toISOString();
      const to = new Date(Date.now() + 90 * 86_400_000).toISOString();
      return api.get<SessionDto[]>(`/api/teacher/schedule?from=${from}&to=${to}`);
    },
  });

  const save = useMutation({
    mutationFn: () =>
      api.post('/api/teacher/change-requests', {
        type: form.type,
        details: form.details,
        proposedValue: form.proposedValue || null,
        courseId: form.courseId || null,
        sessionId: form.sessionId || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teacher'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    save.mutate();
  }

  return (
    <Modal
      title="New change request"
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" form="req-form" disabled={save.isPending}>
            {save.isPending ? 'Submitting…' : 'Submit request'}
          </button>
        </>
      }
    >
      <form id="req-form" onSubmit={submit}>
        <Notice kind="error">{error}</Notice>

        <Field label="What do you need changed?">
          <select
            value={form.type}
            onChange={(e) =>
              setForm({ ...form, type: e.target.value as ChangeRequestType, sessionId: '' })
            }
          >
            {CHANGE_REQUEST_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Class">
          <select value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })}>
            <option value="">— Not about a specific class —</option>
            {classes.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </Field>

        {form.type === 'CANCEL_SESSION' && (
          <Field label="Which session?" hint="Approving this cancels the session immediately.">
            <select
              value={form.sessionId}
              onChange={(e) => setForm({ ...form, sessionId: e.target.value })}
              required
            >
              <option value="">— Pick a session —</option>
              {upcoming.data
                ?.filter((s) => s.status !== 'CANCELLED')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.courseCode} · {formatDateTime(s.startsAt)}
                  </option>
                ))}
            </select>
          </Field>
        )}

        <Field label="Details">
          <textarea
            value={form.details}
            onChange={(e) => setForm({ ...form, details: e.target.value })}
            placeholder="Explain what needs to change and why."
            required
          />
        </Field>

        <Field label="Proposed replacement" hint="Optional — e.g. “Thu 13:00–15:30” or “Room A-210”">
          <input
            value={form.proposedValue}
            onChange={(e) => setForm({ ...form, proposedValue: e.target.value })}
          />
        </Field>
      </form>
    </Modal>
  );
}
