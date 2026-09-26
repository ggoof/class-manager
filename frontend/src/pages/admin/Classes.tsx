import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DAY_NAMES,
  type CourseSummary,
  type Paginated,
  type PublicUser,
  type ScheduleSlotDto,
} from '@cm/shared';
import { api, downloadCsv, qs } from '../../lib/api';
import { Card, Empty, Field, Loading, Modal, Notice, PageHead, Pager, SlotList } from '../../components/ui';

type SlotDraft = Omit<ScheduleSlotDto, 'id'>;

export function AdminClasses() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const pageSize = 25;

  const list = useQuery({
    queryKey: ['admin', 'courses', search, page],
    queryFn: () =>
      api.get<Paginated<CourseSummary>>(`/api/admin/courses${qs({ q: search, page, pageSize })}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/admin/courses/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <>
      <PageHead
        title="Classes"
        subtitle="Create classes, assign a teacher and set the weekly timetable."
        actions={
          <>
            <button onClick={() => downloadCsv('/api/admin/export/course', 'classes.csv')}>
              Export CSV
            </button>
            <button className="primary" onClick={() => setCreating(true)}>
              New class
            </button>
          </>
        }
      />

      <Notice kind="error">{error}</Notice>

      <div className="toolbar">
        <input
          placeholder="Search by code or name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          style={{ minWidth: 280 }}
        />
      </div>

      <Card>
        {list.isLoading && <Loading what="classes" />}
        {list.data?.items.length === 0 && <Empty>No classes yet. Create one to get started.</Empty>}
        {list.data && list.data.items.length > 0 && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Teacher</th>
                    <th>Weekly times</th>
                    <th>Room</th>
                    <th>Term</th>
                    <th>Enrolled</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((c) => (
                    <tr key={c.id}>
                      <td className="mono">
                        <Link to={`/admin/classes/${c.id}`}>{c.code}</Link>
                      </td>
                      <td>
                        {c.name} {!c.active && <span className="badge">inactive</span>}
                      </td>
                      <td>
                        {c.teacher ? (
                          c.teacher.realName
                        ) : (
                          <span className="badge warn">Unassigned</span>
                        )}
                      </td>
                      <td>
                        <SlotList slots={c.slots} />
                      </td>
                      <td>{c.room ?? '—'}</td>
                      <td>{c.term}</td>
                      <td className="num">
                        {c.enrolledCount} / {c.capacity}
                      </td>
                      <td>
                        <div className="btn-row">
                          <Link to={`/admin/classes/${c.id}`}>
                            <button className="small">Manage</button>
                          </Link>
                          <button
                            className="small danger"
                            onClick={() => {
                              if (
                                confirm(
                                  `Delete ${c.code}? Its sessions, roster and attendance go with it.`,
                                )
                              )
                                remove.mutate(c.id);
                            }}
                          >
                            Delete
                          </button>
                        </div>
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

      {creating && <ClassModal onClose={() => setCreating(false)} />}
    </>
  );
}

export function ClassModal({
  course,
  onClose,
}: {
  course?: CourseSummary;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    code: course?.code ?? '',
    name: course?.name ?? '',
    description: course?.description ?? '',
    room: course?.room ?? '',
    term: course?.term ?? '2026-Fall',
    capacity: course?.capacity?.toString() ?? '30',
    teacherId: course?.teacher?.id ?? '',
    active: course?.active ?? true,
  });
  const [slots, setSlots] = useState<SlotDraft[]>(
    course?.slots.map((s) => ({
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
    })) ?? [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:30' }],
  );

  const teachers = useQuery({
    queryKey: ['admin', 'users', 'teachers'],
    queryFn: () =>
      api.get<Paginated<PublicUser>>('/api/admin/users?role=TEACHER&pageSize=200'),
  });

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        code: form.code,
        name: form.name,
        description: form.description || null,
        room: form.room || null,
        term: form.term,
        capacity: Number(form.capacity),
        active: form.active,
        teacherId: form.teacherId || null,
        slots,
      };
      return course
        ? api.patch(`/api/admin/courses/${course.id}`, payload)
        : api.post('/api/admin/courses', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const bad = slots.find((s) => s.startTime >= s.endTime);
    if (bad) return setError('Every slot must end after it starts.');
    save.mutate();
  }

  return (
    <Modal
      title={course ? `Edit ${course.code}` : 'New class'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" form="class-form" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="class-form" onSubmit={submit}>
        <Notice kind="error">{error}</Notice>

        <div className="field-row">
          <Field label="Class code">
            <input value={form.code} onChange={set('code')} placeholder="MATH-201" required />
          </Field>
          <Field label="Name">
            <input value={form.name} onChange={set('name')} required />
          </Field>
        </div>

        <Field label="Description">
          <textarea value={form.description} onChange={set('description')} />
        </Field>

        <div className="field-row">
          <Field label="Teacher">
            <select value={form.teacherId} onChange={set('teacherId')}>
              <option value="">— Unassigned —</option>
              {teachers.data?.items.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.realName} ({t.username})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Room">
            <input value={form.room} onChange={set('room')} />
          </Field>
          <Field label="Term">
            <input value={form.term} onChange={set('term')} required />
          </Field>
          <Field label="Capacity">
            <input type="number" min={1} value={form.capacity} onChange={set('capacity')} required />
          </Field>
        </div>

        <h3>Weekly times</h3>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          The recurring pattern. Dated sessions are generated from this on the class page.
        </p>
        {slots.map((slot, i) => (
          <div key={i} className="toolbar">
            <select
              value={slot.dayOfWeek}
              onChange={(e) =>
                setSlots(
                  slots.map((s, j) => (i === j ? { ...s, dayOfWeek: Number(e.target.value) } : s)),
                )
              }
            >
              {DAY_NAMES.map((d, idx) => (
                <option key={d} value={idx}>
                  {d}
                </option>
              ))}
            </select>
            <input
              type="time"
              value={slot.startTime}
              onChange={(e) =>
                setSlots(slots.map((s, j) => (i === j ? { ...s, startTime: e.target.value } : s)))
              }
            />
            <span className="muted">to</span>
            <input
              type="time"
              value={slot.endTime}
              onChange={(e) =>
                setSlots(slots.map((s, j) => (i === j ? { ...s, endTime: e.target.value } : s)))
              }
            />
            <button type="button" className="small danger" onClick={() => setSlots(slots.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="small"
          onClick={() => setSlots([...slots, { dayOfWeek: 1, startTime: '09:00', endTime: '10:30' }])}
        >
          + Add a time slot
        </button>

        <div style={{ marginTop: 16 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Active — students can find and select this class
          </label>
        </div>
      </form>
    </Modal>
  );
}
