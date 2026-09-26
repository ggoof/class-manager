/**
 * The Class Manager data model on Firestore.
 *
 * Each former Prisma model is a top-level collection. Two things a relational
 * database did implicitly are done explicitly here, and they are the parts worth
 * reading before changing anything:
 *
 *  - **Composite uniqueness is the document id.** An enrollment lives at
 *    `enrollments/{studentId}__{courseId}`, an attendance mark at
 *    `attendance/{sessionId}__{studentId}`, a session at
 *    `sessions/{courseId}__{startsAtMillis}`. That makes "one row per pair" a
 *    property of the store rather than a check in a handler, and it makes every
 *    upsert a plain `set(..., { merge: true })`.
 *  - **Referential actions are code.** Firestore has no `ON DELETE CASCADE`, so
 *    `deleteUser` / `deleteCourse` / `deleteSession` below do the cascade and the
 *    set-null fan-out that `schema.prisma` used to declare.
 *
 * Collections are small (a school, not a social network), so list endpoints load
 * the candidate set and filter, join and sort in memory. That is what lets the
 * API keep offering substring search, multi-field OR and sorting by a joined
 * field — none of which Firestore can express as a query.
 */
import type { CollectionReference, DocumentData, Query } from 'firebase-admin/firestore';
import type { BrowsableTable } from '@cm/shared';
import {
  Batcher,
  claimUnique,
  countQuery,
  deleteQuery,
  fetchDocs,
  firestore,
  newId,
  queryIn,
  reclaimUnique,
  releaseUnique,
  runQuery,
  toDate,
  toDateOrNull,
  type UniqueKey,
} from './firestore.js';

// ------------------------------------------------------------------- entities

export interface UserDoc {
  id: string;
  username: string;
  passwordHash: string;
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
}

export interface CourseDoc {
  id: string;
  code: string;
  name: string;
  description: string | null;
  room: string | null;
  term: string;
  capacity: number;
  active: boolean;
  teacherId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScheduleSlotDoc {
  id: string;
  courseId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface SessionDoc {
  id: string;
  courseId: string;
  startsAt: Date;
  endsAt: Date;
  room: string | null;
  status: string;
  teacherCheckedInAt: Date | null;
  teacherNote: string | null;
}

export interface EnrollmentDoc {
  id: string;
  studentId: string;
  courseId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttendanceDoc {
  id: string;
  sessionId: string;
  studentId: string;
  status: string;
  note: string | null;
  recordedById: string | null;
  recordedAt: Date;
}

export interface ChangeRequestDoc {
  id: string;
  type: string;
  status: string;
  details: string;
  proposedValue: string | null;
  requesterId: string;
  courseId: string | null;
  sessionId: string | null;
  reviewedById: string | null;
  reviewNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface AuditLogDoc {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------- normalizers

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);

const asUser = (id: string, d: DocumentData): UserDoc => ({
  id,
  username: str(d.username),
  passwordHash: str(d.passwordHash),
  role: str(d.role, 'STUDENT'),
  realName: str(d.realName),
  email: str(d.email),
  age: numOrNull(d.age),
  phone: strOrNull(d.phone),
  emergencyContactName: strOrNull(d.emergencyContactName),
  emergencyContactPhone: strOrNull(d.emergencyContactPhone),
  emergencyContactRelation: strOrNull(d.emergencyContactRelation),
  active: d.active !== false,
  createdAt: toDate(d.createdAt),
  updatedAt: toDate(d.updatedAt ?? d.createdAt),
});

const asCourse = (id: string, d: DocumentData): CourseDoc => ({
  id,
  code: str(d.code),
  name: str(d.name),
  description: strOrNull(d.description),
  room: strOrNull(d.room),
  term: str(d.term),
  capacity: typeof d.capacity === 'number' ? d.capacity : 30,
  active: d.active !== false,
  teacherId: strOrNull(d.teacherId),
  createdAt: toDate(d.createdAt),
  updatedAt: toDate(d.updatedAt ?? d.createdAt),
});

const asSlot = (id: string, d: DocumentData): ScheduleSlotDoc => ({
  id,
  courseId: str(d.courseId),
  dayOfWeek: typeof d.dayOfWeek === 'number' ? d.dayOfWeek : 0,
  startTime: str(d.startTime),
  endTime: str(d.endTime),
});

const asSession = (id: string, d: DocumentData): SessionDoc => ({
  id,
  courseId: str(d.courseId),
  startsAt: toDate(d.startsAt),
  endsAt: toDate(d.endsAt),
  room: strOrNull(d.room),
  status: str(d.status, 'SCHEDULED'),
  teacherCheckedInAt: toDateOrNull(d.teacherCheckedInAt),
  teacherNote: strOrNull(d.teacherNote),
});

const asEnrollment = (id: string, d: DocumentData): EnrollmentDoc => ({
  id,
  studentId: str(d.studentId),
  courseId: str(d.courseId),
  status: str(d.status, 'ENROLLED'),
  createdAt: toDate(d.createdAt),
  updatedAt: toDate(d.updatedAt ?? d.createdAt),
});

const asAttendance = (id: string, d: DocumentData): AttendanceDoc => ({
  id,
  sessionId: str(d.sessionId),
  studentId: str(d.studentId),
  status: str(d.status, 'PRESENT'),
  note: strOrNull(d.note),
  recordedById: strOrNull(d.recordedById),
  recordedAt: toDate(d.recordedAt),
});

const asChangeRequest = (id: string, d: DocumentData): ChangeRequestDoc => ({
  id,
  type: str(d.type, 'OTHER'),
  status: str(d.status, 'PENDING'),
  details: str(d.details),
  proposedValue: strOrNull(d.proposedValue),
  requesterId: str(d.requesterId),
  courseId: strOrNull(d.courseId),
  sessionId: strOrNull(d.sessionId),
  reviewedById: strOrNull(d.reviewedById),
  reviewNote: strOrNull(d.reviewNote),
  reviewedAt: toDateOrNull(d.reviewedAt),
  createdAt: toDate(d.createdAt),
});

const asAuditLog = (id: string, d: DocumentData): AuditLogDoc => ({
  id,
  actorId: strOrNull(d.actorId),
  action: str(d.action),
  entity: str(d.entity),
  entityId: strOrNull(d.entityId),
  detail: strOrNull(d.detail),
  createdAt: toDate(d.createdAt),
});

// ---------------------------------------------------------------- collections

interface Stamps {
  createdAt?: boolean;
  updatedAt?: boolean;
}

/** A typed view over one Firestore collection. */
class Repo<T extends { id: string }> {
  readonly ref: CollectionReference;

  constructor(
    readonly name: string,
    private readonly map: (id: string, data: DocumentData) => T,
    private readonly stamps: Stamps = {},
  ) {
    this.ref = firestore.collection(name);
  }

  doc(id: string) {
    return this.ref.doc(id);
  }

  newId() {
    return newId(this.name);
  }

  async get(id: string): Promise<T | null> {
    if (!id) return null;
    const snap = await this.doc(id).get();
    return snap.exists ? this.map(snap.id, snap.data() as DocumentData) : null;
  }

  getMany(ids: string[]): Promise<T[]> {
    const wanted = [...new Set(ids.filter(Boolean))];
    return fetchDocs(
      wanted.map((id) => this.doc(id)),
      this.map,
    );
  }

  all(): Promise<T[]> {
    return runQuery(this.ref, this.map);
  }

  run(query: Query): Promise<T[]> {
    return runQuery(query, this.map);
  }

  by(field: keyof T & string, value: unknown): Promise<T[]> {
    return runQuery(this.ref.where(field, '==', value), this.map);
  }

  in(field: keyof T & string, values: string[]): Promise<T[]> {
    return queryIn(this.ref, field, values, this.map);
  }

  async first(field: keyof T & string, value: unknown): Promise<T | null> {
    const [found] = await runQuery(this.ref.where(field, '==', value).limit(1), this.map);
    return found ?? null;
  }

  count(query: Query = this.ref): Promise<number> {
    return countQuery(query);
  }

  countWhere(field: keyof T & string, value: unknown): Promise<number> {
    return countQuery(this.ref.where(field, '==', value));
  }

  /** Writes a whole document. `id` lets callers use a deterministic key. */
  async create(data: Omit<T, 'id'> | Record<string, unknown>, id?: string): Promise<T> {
    const docId = id ?? this.newId();
    const now = new Date();
    const payload: Record<string, unknown> = { ...(data as Record<string, unknown>) };
    if (this.stamps.createdAt) payload.createdAt ??= now;
    if (this.stamps.updatedAt) payload.updatedAt ??= now;
    await this.doc(docId).set(payload);
    return this.map(docId, payload as DocumentData);
  }

  /** Create-or-merge on a deterministic id. `undefined` fields leave the stored value alone. */
  async upsert(id: string, create: Record<string, unknown>, update: Record<string, unknown>) {
    const now = new Date();
    const existing = await this.doc(id).get();
    const payload: Record<string, unknown> = existing.exists ? { ...update } : { ...create };
    if (!existing.exists && this.stamps.createdAt) payload.createdAt ??= now;
    if (this.stamps.updatedAt) payload.updatedAt = now;
    await this.doc(id).set(payload, { merge: true });
    return (await this.get(id)) as T;
  }

  async update(id: string, patch: Record<string, unknown>): Promise<T> {
    const payload: Record<string, unknown> = { ...patch };
    if (this.stamps.updatedAt) payload.updatedAt = new Date();
    // `set(..., merge)` rather than `update` so a document written before a field
    // existed does not fail the write.
    await this.doc(id).set(payload, { merge: true });
    return (await this.get(id)) as T;
  }

  async delete(id: string): Promise<void> {
    await this.doc(id).delete();
  }

  /** Deletes everything matching a query. Used by the cascades below. */
  deleteWhere(field: keyof T & string, value: unknown): Promise<number> {
    return deleteQuery(this.ref.where(field, '==', value));
  }

  /** Sets one field to null on every document matching another field. */
  async nullOut(match: keyof T & string, value: unknown, field: keyof T & string): Promise<number> {
    const snap = await this.ref.where(match, '==', value).get();
    if (snap.empty) return 0;
    const batch = new Batcher();
    for (const doc of snap.docs) batch.update(doc.ref, { [field]: null });
    return batch.commit();
  }
}

export const users = new Repo<UserDoc>('users', asUser, { createdAt: true, updatedAt: true });
export const courses = new Repo<CourseDoc>('courses', asCourse, {
  createdAt: true,
  updatedAt: true,
});
export const scheduleSlots = new Repo<ScheduleSlotDoc>('scheduleSlots', asSlot);
export const sessions = new Repo<SessionDoc>('sessions', asSession);
export const enrollments = new Repo<EnrollmentDoc>('enrollments', asEnrollment, {
  createdAt: true,
  updatedAt: true,
});
export const attendance = new Repo<AttendanceDoc>('attendance', asAttendance);
export const changeRequests = new Repo<ChangeRequestDoc>('changeRequests', asChangeRequest, {
  createdAt: true,
});
export const auditLogs = new Repo<AuditLogDoc>('auditLogs', asAuditLog, { createdAt: true });

/** The shape the admin console's raw table browser needs, whatever the entity. */
export interface TableRepo {
  readonly ref: CollectionReference;
  run(query: Query): Promise<unknown[]>;
  count(query?: Query): Promise<number>;
}

/** Keyed by the table names the admin console browses. */
export const collections: Record<BrowsableTable, TableRepo> = {
  user: users,
  course: courses,
  scheduleSlot: scheduleSlots,
  session: sessions,
  enrollment: enrollments,
  attendance,
  changeRequest: changeRequests,
  auditLog: auditLogs,
};

// ------------------------------------------------------- deterministic ids

export const enrollmentId = (studentId: string, courseId: string) => `${studentId}__${courseId}`;
export const attendanceId = (sessionId: string, studentId: string) => `${sessionId}__${studentId}`;
export const sessionId = (courseId: string, startsAt: Date) =>
  `${courseId}__${startsAt.getTime()}`;

// ----------------------------------------------------------------- uniqueness

export const userKeys = (u: { username: string; email: string }): UniqueKey[] => [
  { scope: 'username', value: u.username },
  { scope: 'email', value: u.email },
];

export const courseKeys = (c: { code: string }): UniqueKey[] => [
  { scope: 'courseCode', value: c.code },
];

export { claimUnique, releaseUnique, reclaimUnique, UniqueViolation } from './firestore.js';

// --------------------------------------------------- guarded create / update
//
// Everything that touches a unique value goes through these four, so the
// reservation collection can never drift from the documents it guards.

type NewUser = Omit<UserDoc, 'id' | 'createdAt' | 'updatedAt'>;

export async function createUser(data: NewUser): Promise<UserDoc> {
  const id = users.newId();
  await claimUnique(userKeys(data), id);
  try {
    return await users.create(data, id);
  } catch (err) {
    await releaseUnique(userKeys(data)); // never leave a key reserved for a user that failed to write
    throw err;
  }
}

export async function updateUser(
  existing: UserDoc,
  patch: Record<string, unknown>,
): Promise<UserDoc> {
  const nextEmail = typeof patch.email === 'string' ? patch.email : existing.email;
  if (nextEmail.toLowerCase() !== existing.email.toLowerCase()) {
    await reclaimUnique(
      userKeys({ username: existing.username, email: nextEmail }),
      userKeys(existing),
      existing.id,
    );
  }
  return users.update(existing.id, patch);
}

type NewCourse = Omit<CourseDoc, 'id' | 'createdAt' | 'updatedAt'>;

export async function createCourse(data: NewCourse): Promise<CourseDoc> {
  const id = courses.newId();
  await claimUnique(courseKeys(data), id);
  try {
    return await courses.create(data, id);
  } catch (err) {
    await releaseUnique(courseKeys(data));
    throw err;
  }
}

export async function updateCourse(
  existing: CourseDoc,
  patch: Record<string, unknown>,
): Promise<CourseDoc> {
  const nextCode = typeof patch.code === 'string' ? patch.code : existing.code;
  if (nextCode.toLowerCase() !== existing.code.toLowerCase()) {
    await reclaimUnique(courseKeys({ code: nextCode }), courseKeys(existing), existing.id);
  }
  return courses.update(existing.id, patch);
}

// ------------------------------------------------------------------- cascades

/**
 * `onDelete: Cascade` for the rows a user owns, `SetNull` everywhere they are
 * merely referenced — the same fan-out `schema.prisma` used to declare.
 */
export async function deleteUser(user: UserDoc): Promise<void> {
  await Promise.all([
    enrollments.deleteWhere('studentId', user.id),
    attendance.deleteWhere('studentId', user.id),
    changeRequests.deleteWhere('requesterId', user.id),
  ]);
  await Promise.all([
    courses.nullOut('teacherId', user.id, 'teacherId'),
    attendance.nullOut('recordedById', user.id, 'recordedById'),
    changeRequests.nullOut('reviewedById', user.id, 'reviewedById'),
    auditLogs.nullOut('actorId', user.id, 'actorId'),
  ]);
  await users.delete(user.id);
  await releaseUnique(userKeys(user));
}

export async function deleteCourse(course: CourseDoc): Promise<void> {
  const courseSessions = await sessions.by('courseId', course.id);
  await Promise.all(courseSessions.map((s) => attendance.deleteWhere('sessionId', s.id)));
  await Promise.all([
    scheduleSlots.deleteWhere('courseId', course.id),
    sessions.deleteWhere('courseId', course.id),
    enrollments.deleteWhere('courseId', course.id),
  ]);
  await Promise.all([
    changeRequests.nullOut('courseId', course.id, 'courseId'),
    ...courseSessions.map((s) => changeRequests.nullOut('sessionId', s.id, 'sessionId')),
  ]);
  await courses.delete(course.id);
  await releaseUnique(courseKeys(course));
}

export async function deleteSession(id: string): Promise<void> {
  await attendance.deleteWhere('sessionId', id);
  await changeRequests.nullOut('sessionId', id, 'sessionId');
  await sessions.delete(id);
}

// ---------------------------------------------------------------------- audit

export async function audit(
  actorId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
  detail?: unknown,
) {
  await auditLogs.create({
    actorId,
    action,
    entity,
    entityId: entityId ?? null,
    detail: detail === undefined ? null : JSON.stringify(detail),
  });
}

/** Nothing to close — the Firestore client has no pooled connections to drain. */
export async function disconnect(): Promise<void> {
  await firestore.terminate();
}
