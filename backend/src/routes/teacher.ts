import type { FastifyInstance } from 'fastify';
import type { AttendanceStatus, EnrollmentStatus, RosterEntry } from '@cm/shared';
import {
  attendance,
  attendanceId,
  audit,
  changeRequests,
  courses,
  enrollments,
  sessions,
  users,
  type CourseDoc,
  type SessionDoc,
} from '../db.js';
import { Batcher } from '../firestore.js';
import { currentUser, requireAuth, requireRole } from '../auth.js';
import {
  bulkAttendanceSchema,
  createChangeRequestSchema,
  rangeQuerySchema,
  sessionStatusSchema,
  teacherCheckInSchema,
} from '../schemas.js';
import { sessionDto, sessionDtos, slotsByCourse, toSlotDto } from '../joins.js';
import { indexBy, parseOr400, resolveRange, sortBy } from '../util.js';

export async function teacherRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('TEACHER'));

  app.get('/api/teacher/classes', async (req) => {
    const me = currentUser(req);
    const mine = sortBy(await courses.by('teacherId', me.sub), (c) => c.code);
    const ids = mine.map((c) => c.id);

    const [slots, enrolled, courseSessions] = await Promise.all([
      slotsByCourse(ids),
      enrollments.in('courseId', ids),
      sessions.in('courseId', ids),
    ]);
    const countIn = (rows: { courseId: string }[], id: string) =>
      rows.filter((r) => r.courseId === id).length;

    return mine.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      room: c.room,
      term: c.term,
      capacity: c.capacity,
      active: c.active,
      slots: (slots.get(c.id) ?? []).map(toSlotDto),
      enrolledCount: countIn(enrolled, c.id),
      sessionCount: countIn(courseSessions, c.id),
    }));
  });

  app.get('/api/teacher/schedule', async (req, reply) => {
    const q = parseOr400(rangeQuerySchema, req.query, reply);
    if (!q) return;
    const me = currentUser(req);
    const { start, end } = resolveRange(q.from, q.to);

    const mine = new Set((await courses.by('teacherId', me.sub)).map((c) => c.id));
    const inRange = await sessions.run(
      sessions.ref.where('startsAt', '>=', start).where('startsAt', '<', end),
    );
    return sessionDtos(sortBy(inRange.filter((s) => mine.has(s.courseId)), (s) => s.startsAt.getTime()));
  });

  app.get('/api/teacher/classes/:id/students', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = currentUser(req);

    const course = await courses.get(id);
    if (!course) return reply.code(404).send({ error: 'Class not found' });
    if (course.teacherId !== me.sub) {
      return reply.code(403).send({ error: 'You do not teach this class' });
    }

    const roster = await enrollments.by('courseId', id);
    const students = indexBy(await users.getMany(roster.map((e) => e.studentId)), (u) => u.id);

    return sortBy(
      roster.flatMap((e) => {
        const student = students.get(e.studentId);
        if (!student) return []; // the user was deleted out from under the roster
        return [
          {
            studentId: student.id,
            username: student.username,
            realName: student.realName,
            email: student.email,
            phone: student.phone,
            age: student.age,
            emergencyContactName: student.emergencyContactName,
            emergencyContactPhone: student.emergencyContactPhone,
            emergencyContactRelation: student.emergencyContactRelation,
            enrollmentStatus: e.status as EnrollmentStatus,
          },
        ];
      }),
      (r) => r.realName,
    );
  });

  /** The roster for one meeting, with any attendance already recorded. */
  app.get('/api/teacher/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const owned = await loadOwnedSession(id, currentUser(req).sub);
    if (!owned) return reply.code(404).send({ error: 'Session not found for one of your classes' });

    const [roster, marks] = await Promise.all([
      enrollments.by('courseId', owned.session.courseId),
      attendance.by('sessionId', id),
    ]);
    const active = roster.filter((e) => e.status !== 'DROPPED');
    const students = indexBy(await users.getMany(active.map((e) => e.studentId)), (u) => u.id);
    const byStudent = indexBy(marks, (m) => m.studentId);

    const entries: RosterEntry[] = active.flatMap((e) => {
      const student = students.get(e.studentId);
      if (!student) return [];
      const mark = byStudent.get(e.studentId);
      return [
        {
          studentId: student.id,
          username: student.username,
          realName: student.realName,
          email: student.email,
          phone: student.phone,
          emergencyContactName: student.emergencyContactName,
          emergencyContactPhone: student.emergencyContactPhone,
          enrollmentStatus: e.status as EnrollmentStatus,
          attendance: mark ? { status: mark.status as AttendanceStatus, note: mark.note } : null,
        },
      ];
    });

    return {
      session: await sessionDto(owned.session),
      roster: sortBy(entries, (r) => r.realName),
    };
  });

  /** Teacher checks *themselves* in to the class meeting. */
  app.post('/api/teacher/sessions/:id/check-in', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseOr400(teacherCheckInSchema, req.body, reply);
    if (!body) return;

    const me = currentUser(req);
    const owned = await loadOwnedSession(id, me.sub);
    if (!owned) return reply.code(404).send({ error: 'Session not found for one of your classes' });
    if (owned.session.status === 'CANCELLED') {
      return reply.code(409).send({ error: 'This session was cancelled' });
    }

    const updated = await sessions.update(id, {
      teacherCheckedInAt: owned.session.teacherCheckedInAt ?? new Date(),
      teacherNote: body.note ?? owned.session.teacherNote,
    });
    await audit(me.sub, 'session.teacher_check_in', 'Session', id);
    return sessionDto(updated);
  });

  /** Check students in — one call marks the whole roster. */
  app.post('/api/teacher/sessions/:id/attendance', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseOr400(bulkAttendanceSchema, req.body, reply);
    if (!body) return;

    const me = currentUser(req);
    const owned = await loadOwnedSession(id, me.sub);
    if (!owned) return reply.code(404).send({ error: 'Session not found for one of your classes' });

    const enrolled = new Set(
      (await enrollments.by('courseId', owned.session.courseId))
        .filter((e) => e.status !== 'DROPPED')
        .map((e) => e.studentId),
    );

    const stray = body.marks.filter((m) => !enrolled.has(m.studentId));
    if (stray.length > 0) {
      return reply
        .code(400)
        .send({ error: 'Some students are not enrolled in this class', details: stray });
    }

    // The document id carries the (session, student) uniqueness, so a merging
    // write is the whole upsert — no read, no conflict handling.
    const batch = new Batcher();
    const recordedAt = new Date();
    for (const m of body.marks) {
      batch.set(
        attendance.doc(attendanceId(id, m.studentId)),
        {
          sessionId: id,
          studentId: m.studentId,
          status: m.status,
          note: m.note ?? null,
          recordedById: me.sub,
          recordedAt,
        },
        { merge: true },
      );
    }
    await batch.commit();

    const absences = body.marks.filter((m) => m.status === 'ABSENT').length;
    await audit(me.sub, 'attendance.record', 'Session', id, {
      marked: body.marks.length,
      absences,
    });
    return { marked: body.marks.length, absences };
  });

  app.patch('/api/teacher/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseOr400(sessionStatusSchema, req.body, reply);
    if (!body) return;

    const me = currentUser(req);
    const owned = await loadOwnedSession(id, me.sub);
    if (!owned) return reply.code(404).send({ error: 'Session not found for one of your classes' });
    // Teachers may close out a meeting, but only an admin can cancel one — that
    // goes through a change request.
    if (body.status === 'CANCELLED') {
      return reply
        .code(403)
        .send({ error: 'Submit a "Cancel session" change request for an admin to approve' });
    }

    const updated = await sessions.update(id, { status: body.status });
    await audit(me.sub, 'session.status', 'Session', id, { status: body.status });
    return sessionDto(updated);
  });

  // ---------------------------------------------------------- change requests

  app.get('/api/teacher/change-requests', async (req) => {
    const me = currentUser(req);
    const items = sortBy(
      await changeRequests.by('requesterId', me.sub),
      (r) => -r.createdAt.getTime(),
    );

    const [relatedCourses, relatedSessions, reviewers] = await Promise.all([
      courses.getMany(items.map((r) => r.courseId ?? '')),
      sessions.getMany(items.map((r) => r.sessionId ?? '')),
      users.getMany(items.map((r) => r.reviewedById ?? '')),
    ]);
    const byCourse = indexBy(relatedCourses, (c) => c.id);
    const bySession = indexBy(relatedSessions, (s) => s.id);
    const byReviewer = indexBy(reviewers, (u) => u.id);

    return items.map((r) => {
      const course = r.courseId ? byCourse.get(r.courseId) : undefined;
      const session = r.sessionId ? bySession.get(r.sessionId) : undefined;
      const reviewer = r.reviewedById ? byReviewer.get(r.reviewedById) : undefined;
      return {
        ...r,
        course: course ? { id: course.id, code: course.code, name: course.name } : null,
        session: session ? { id: session.id, startsAt: session.startsAt } : null,
        reviewedBy: reviewer ? { realName: reviewer.realName } : null,
      };
    });
  });

  app.post('/api/teacher/change-requests', async (req, reply) => {
    const body = parseOr400(createChangeRequestSchema, req.body, reply);
    if (!body) return;
    const me = currentUser(req);

    if (body.courseId) {
      const course = await courses.get(body.courseId);
      if (!course || course.teacherId !== me.sub) {
        return reply.code(403).send({ error: 'You do not teach that class' });
      }
    }
    if (body.sessionId && !(await loadOwnedSession(body.sessionId, me.sub))) {
      return reply.code(403).send({ error: 'That session is not one of yours' });
    }
    if (body.type === 'CANCEL_SESSION' && !body.sessionId) {
      return reply.code(400).send({ error: 'Pick the session you want cancelled' });
    }

    const created = await changeRequests.create({
      type: body.type,
      status: 'PENDING',
      details: body.details,
      proposedValue: body.proposedValue ?? null,
      courseId: body.courseId ?? null,
      sessionId: body.sessionId ?? null,
      requesterId: me.sub,
      reviewedById: null,
      reviewNote: null,
      reviewedAt: null,
    });
    await audit(me.sub, 'change_request.create', 'ChangeRequest', created.id, { type: body.type });
    return reply.code(201).send(created);
  });
}

/** Loads a session only if it belongs to a class this teacher owns. */
async function loadOwnedSession(
  id: string,
  teacherId: string,
): Promise<{ session: SessionDoc; course: CourseDoc } | null> {
  const session = await sessions.get(id);
  if (!session) return null;
  const course = await courses.get(session.courseId);
  if (!course || course.teacherId !== teacherId) return null;
  return { session, course };
}
