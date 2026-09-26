import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import type { PublicUser, Role, SessionStatus } from '@cm/shared';

/** Validate a request body/query, replying 400 with field details on failure. */
export function parseOr400<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  reply: FastifyReply,
): z.infer<T> | undefined {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  reply.code(400).send({
    error: 'Invalid request',
    details: result.error.issues.map((i) => ({
      field: i.path.join('.') || '(root)',
      message: i.message,
    })),
  });
  return undefined;
}

type UserRow = {
  id: string;
  username: string;
  role: string;
  realName: string;
  email: string;
  age: number | null;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** Strips `passwordHash` — every user-shaped response goes through here. */
export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    username: u.username,
    role: u.role as Role,
    realName: u.realName,
    email: u.email,
    age: u.age,
    phone: u.phone,
    emergencyContactName: u.emergencyContactName,
    emergencyContactPhone: u.emergencyContactPhone,
    emergencyContactRelation: u.emergencyContactRelation,
    active: u.active,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

type SessionRow = {
  id: string;
  courseId: string;
  startsAt: Date;
  endsAt: Date;
  room: string | null;
  status: string;
  teacherCheckedInAt: Date | null;
};

/**
 * Firestore stores no relations, so the class and its teacher are joined by the
 * caller and handed in rather than travelling on the session document.
 */
export function toSessionDto(
  s: SessionRow,
  course: { code: string; name: string; room: string | null } | null,
  teacherName: string | null,
) {
  return {
    id: s.id,
    courseId: s.courseId,
    courseCode: course?.code ?? '',
    courseName: course?.name ?? '',
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    room: s.room ?? course?.room ?? null,
    status: s.status as SessionStatus,
    teacherCheckedInAt: s.teacherCheckedInAt?.toISOString() ?? null,
    teacherName,
  };
}

/**
 * Expand a class's weekly slots into concrete dated meetings between two dates
 * (inclusive), in server-local time.
 */
export function expandSlots(
  slots: { dayOfWeek: number; startTime: string; endTime: string }[],
  from: Date,
  to: Date,
): { startsAt: Date; endsAt: Date }[] {
  const out: { startsAt: Date; endsAt: Date }[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());

  while (cursor <= last) {
    for (const slot of slots) {
      if (slot.dayOfWeek !== cursor.getDay()) continue;
      out.push({
        startsAt: atTime(cursor, slot.startTime),
        endsAt: atTime(cursor, slot.endTime),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

function atTime(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
}

/** Do two [start, end) intervals overlap? Used for enrollment clash detection. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}

/** RFC 4180-ish CSV. Values are stringified; Dates become ISO strings. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const s =
      value instanceof Date
        ? value.toISOString()
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(row[c])).join(','));
  return lines.join('\r\n');
}

/** Defaults an unbounded date range to "this week" so list endpoints stay cheap. */
export function resolveRange(from?: string, to?: string) {
  const now = new Date();
  const start = from ? new Date(from) : startOfWeek(now);
  const end = to ? new Date(to) : addDays(startOfWeek(now), 7);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Invalid date range');
  }
  return { start, end };
}

export function startOfWeek(d: Date) {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

export function addDays(d: Date, n: number) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

// ------------------------------------------------- in-memory query helpers
//
// Firestore cannot do substring search, OR across fields, or sorting by a joined
// field, so the list endpoints load their candidate set and finish the job here.

/** An error Fastify's handler turns into a real status code rather than a 500. */
export function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

/** Case-insensitive substring match, matching SQLite's `LIKE` on ASCII. */
export function contains(haystack: string | null | undefined, needle: string): boolean {
  return (haystack ?? '').toLowerCase().includes(needle.toLowerCase());
}

/** Sorts by a sequence of key extractors, ascending, without mutating the input. */
export function sortBy<T>(items: T[], ...keys: ((item: T) => string | number)[]): T[] {
  return [...items].sort((a, b) => {
    for (const key of keys) {
      const av = key(a);
      const bv = key(b);
      if (av < bv) return -1;
      if (av > bv) return 1;
    }
    return 0;
  });
}

export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/** `[{id, …}] -> Map<id, item>`, for stitching joins back together. */
export function indexBy<T, K>(items: T[], key: (item: T) => K): Map<K, T> {
  return new Map(items.map((item) => [key(item), item]));
}

/** `[{courseId, …}] -> Map<courseId, item[]>`, the one-to-many version. */
export function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = out.get(k);
    if (bucket) bucket.push(item);
    else out.set(k, [item]);
  }
  return out;
}
