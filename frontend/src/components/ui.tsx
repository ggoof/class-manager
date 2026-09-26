import { useEffect, type ReactNode } from 'react';
import type {
  AttendanceStatus,
  ChangeRequestStatus,
  EnrollmentStatus,
  SessionStatus,
} from '@cm/shared';
import { DAY_NAMES } from '@cm/shared';

export function Card({
  title,
  actions,
  children,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="btn-row">{actions}</div>}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <em className="muted">{hint}</em>}
    </label>
  );
}

export function Notice({ kind, children }: { kind: 'error' | 'success'; children: ReactNode }) {
  if (!children) return null;
  return <div className={`notice ${kind}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Loading({ what = 'data' }: { what?: string }) {
  return <div className="empty">Loading {what}…</div>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={wide ? 'modal wide' : 'modal'} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

type Tone = 'ok' | 'warn' | 'bad' | 'info' | '';

function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={tone ? `badge ${tone}` : 'badge'}>{children}</span>;
}

const attendanceTone: Record<AttendanceStatus, Tone> = {
  PRESENT: 'ok',
  LATE: 'warn',
  ABSENT: 'bad',
  EXCUSED: 'info',
};
export function AttendanceBadge({ status }: { status: AttendanceStatus }) {
  return <Badge tone={attendanceTone[status]}>{status}</Badge>;
}

const enrollmentTone: Record<EnrollmentStatus, Tone> = {
  ENROLLED: 'ok',
  WAITLISTED: 'warn',
  DROPPED: '',
};
export function EnrollmentBadge({ status }: { status: EnrollmentStatus }) {
  return <Badge tone={enrollmentTone[status]}>{status}</Badge>;
}

const requestTone: Record<ChangeRequestStatus, Tone> = {
  PENDING: 'warn',
  APPROVED: 'ok',
  REJECTED: 'bad',
};
export function RequestBadge({ status }: { status: ChangeRequestStatus }) {
  return <Badge tone={requestTone[status]}>{status}</Badge>;
}

const sessionTone: Record<SessionStatus, Tone> = {
  SCHEDULED: 'info',
  COMPLETED: 'ok',
  CANCELLED: 'bad',
};
export function SessionBadge({ status }: { status: SessionStatus }) {
  return <Badge tone={sessionTone[status]}>{status}</Badge>;
}

export function RoleBadge({ role }: { role: string }) {
  const tone: Tone = role === 'ADMIN' ? 'bad' : role === 'TEACHER' ? 'info' : 'ok';
  return <Badge tone={tone}>{role}</Badge>;
}

/** "Mon 09:00–10:30" from a weekly slot. */
export function slotLabel(slot: { dayOfWeek: number; startTime: string; endTime: string }) {
  return `${DAY_NAMES[slot.dayOfWeek].slice(0, 3)} ${slot.startTime}–${slot.endTime}`;
}

export function SlotList({
  slots,
}: {
  slots: { id?: string; dayOfWeek: number; startTime: string; endTime: string }[];
}) {
  if (slots.length === 0) return <span className="muted">No weekly times set</span>;
  return <>{slots.map(slotLabel).join(' · ')}</>;
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
      <span className="muted">
        {first}–{last} of {total}
      </span>
      <span className="spacer" style={{ flex: 1 }} />
      <button className="small" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Prev
      </button>
      <span className="muted">
        Page {page} / {pages}
      </span>
      <button className="small" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next →
      </button>
    </div>
  );
}
