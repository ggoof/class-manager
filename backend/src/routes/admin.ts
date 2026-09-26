import type { FastifyInstance } from 'fastify';
import { BROWSABLE_TABLES, type BrowsableTable } from '@cm/shared';
import {
  attendance,
  audit,
  auditLogs,
  changeRequests,
  collections,
  courses,
  createCourse,
  createUser,
  deleteCourse,
  deleteSession,
  deleteUser,
  enrollmentId,
  enrollments,
  scheduleSlots,
  sessionId,
  sessions,
  updateCourse,
  updateUser,
  users,
} from '../db.js';
import { Batcher, countQuery } from '../firestore.js';
import { currentUser, hashPassword, requireAuth, requireRole } from '../auth.js';
import {
  createCourseSchema,
  createUserSchema,
  enrollSchema,
  generateSessionsSchema,
  listQuerySchema,
  rangeQuerySchema,
  reviewChangeRequestSchema,
  updateCourseSchema,
  updateUserSchema,
} from '../schemas.js';
import { courseSummaries, enrollmentCounts, sessionDtos } from '../joins.js';
import {
  contains,
  expandSlots,
  indexBy,
  paginate,
  parseOr400,
  sortBy,
  toCsv,
  toPublicUser,
} from '../util.js';

/**
 * How each browsable collection is ordered when the admin console pages through
 * it raw. These are single-field orderings on purpose: Firestore serves them
 * from the automatic indexes, so no composite index has to be deployed first.
 */
const tableOrder: Record<BrowsableTable, { field: string; dir: 'asc' | 'desc' }> = {
  user: { field: 'createdAt', dir: 'desc' },
  course: { field: 'code', dir: 'asc' },
  scheduleSlot: { field: 'courseId', dir: 'asc' },
  session: { field: 'startsAt', dir: 'desc' },
  enrollment: { field: 'createdAt', dir: 'desc' },
  attendance: { field: 'recordedAt', dir: 'desc' },
  changeRequest: { field: 'createdAt', dir: 'desc' },
  auditLog: { field: 'createdAt', dir: 'desc' },
};

async function readTable(
  table: BrowsableTable,
  take: number,
  skip: number,
): Promise<Record<string, unknown>[]> {
  const repo = collections[table];
  const order = tableOrder[table];
  const rows = (await repo.run(
    repo.ref.orderBy(order.field, order.dir).offset(skip).limit(take),
  )) as Record<string, unknown>[];
  // Password hashes never leave the server, not even in a raw table dump.
  if (table === 'user') return rows.map(({ passwordHash: _drop, ...rest }) => rest);
  return rows;
}

function isBrowsable(name: string): name is BrowsableTable {
  return (BROWSABLE_TABLES as readonly string[]).includes(name);
}

export async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('ADMIN'));

  // ---------------------------------------------------------------- dashboard

  app.get('/api/admin/stats', async () => {
    const [admins, teachers, students, activeCourses, sessionCount, pendingRequests, absences] =
      await Promise.all([
        users.countWhere('role', 'ADMIN'),
        users.countWhere('role', 'TEACHER'),
        users.countWhere('role', 'STUDENT'),
        courses.by('active', true),
        sessions.count(),
        changeRequests.countWhere('status', 'PENDING'),
        attendance.countWhere('status', 'ABSENT'),
      ]);
    return {
      admins,
      teachers,
      students,
      courses: activeCourses.length,
      sessions: sessionCount,
      pendingRequests,
      absences,
      unassignedCourses: activeCourses.filter((c) => !c.teacherId).length,
    };
  });

  // -------------------------------------------------------------------- users

  app.get('/api/admin/users', async (req, reply) => {
    const q = parseOr400(listQuerySchema, req.query, reply);
    if (!q) return;

    const matched = (await users.all()).filter((u) => {
      if (q.role && u.role !== q.role) return false;
      if (!q.q) return true;
      return (
        contains(u.username, q.q) ||
        contains(u.realName, q.q) ||
        contains(u.email, q.q) ||
        contains(u.phone, q.q)
      );
    });

    const ordered = sortBy(matched, (u) => u.role, (u) => u.realName);
    return {
      items: paginate(ordered, q.page, q.pageSize).map(toPublicUser),
      total: matched.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  });

  app.post('/api/admin/users', async (req, reply) => {
    const body = parseOr400(createUserSchema, req.body, reply);
    if (!body) return;

    const [byUsername, byEmail] = await Promise.all([
      users.first('username', body.username),
      users.first('email', body.email),
    ]);
    if (byUsername || byEmail) {
      return reply.code(409).send({
        error: byUsername ? 'That username is already taken' : 'That email is already registered',
      });
    }

    const { password, ...rest } = body;
    const user = await createUser({
      username: rest.username,
      passwordHash: await hashPassword(password),
      role: rest.role,
      realName: rest.realName,
      email: rest.email,
      age: rest.age ?? null,
      phone: rest.phone ?? null,
      emergencyContactName: rest.emergencyContactName ?? null,
      emergencyContactPhone: rest.emergencyContactPhone ?? null,
      emergencyContactRelation: rest.emergencyContactRelation ?? null,
      active: rest.active ?? true,
    });
    await audit(currentUser(req).sub, 'user.create', 'User', user.id, { role: user.role });
    return reply.code(201).send(toPublicUser(user));
  });

  app.get('/api/admin/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = await users.get(id);
    if (!user) return reply.code(404).send({ error: 'User not found' });

    const [taught, mine] = await Promise.all([
      courses.by('teacherId', id),
      enrollments.by('studentId', id),
    ]);
    const enrolledIn = indexBy(await courses.getMany(mine.map((e) => e.courseId)), (c) => c.id);

    return {
      ...toPublicUser(user),
      taughtCourses: taught.map((c) => ({ id: c.id, code: c.code, name: c.name })),
      enrollments: mine.flatMap((e) => {
        const course = enrolledIn.get(e.courseId);
        return course
          ? [{ status: e.status, course: { id: course.id, code: course.code, name: course.name } }]
          : [];
      }),
    };
  });

  app.patch('/api/admin/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseOr400(updateUserSchema, req.body, reply);
    if (!body) return;

    const target = await users.get(id);
    if (!target) return reply.code(404).send({ error: 'User not found' });

    const me = currentUser(req);
    if (target.id === me.sub && (body.role === 'STUDENT' || body.role === 'TEACHER')) {
      return reply.code(400).send({ error: 'You cannot demote your own admin account' });
    }
    if (target.id === me.sub && body.active === false) {
      return reply.code(400).send({ error: 'You cannot deactivate your own account' });
    }

    const { password, ...rest } = body;
    const data: Record<string, unknown> = { ...rest };
    if (password) data.passwordHash = await hashPassword(password);

    const updated = await updateUser(target, data);
    await audit(me.sub, 'user.update', 'User', id, Object.keys(data));
    return toPublicUser(updated);
  });

  app.delete('/api/admin/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const me = currentUser(req);
    if (id === me.sub) return reply.code(400).send({ error: 'You cannot delete your own account' });

    const target = await users.get(id);
    if (!target) return reply.code(404).send({ error: 'User not found' });

    await deleteUser(target);
    await audit(me.sub, 'user.delete', 'User', id, { username: target.username });
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ classes

  app.get('/api/admin/courses', async (req, reply) => {
    const q = parseOr400(listQuerySchema, req.query, reply);
    if (!q) return;

    const matched = (await courses.all()).filter((c) => {
      if (q.term && c.term !== q.term) return false;
      if (q.teacherId && c.teacherId !== q.teacherId) return false;
      if (!q.q) return true;
      return contains(c.code, q.q) || contains(c.name, q.q);
    });

    const page = paginate(sortBy(matched, (c) => c.code), q.page, q.pageSize);
    return {
      items: await courseSummaries(page),
      total: matched.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  });

  app.post('/api/admin/courses', async (req, reply) => {
    const body = parseOr400(createCourseSchema, req.body, reply);
    if (!body) return;

    if (await courses.first('code', body.code)) {
      return reply.code(409).send({ error: `Class code "${body.code}" already exists` });
    }
    const teacherError = await validateTeacher(body.teacherId);
    if (teacherError) return reply.code(400).send({ error: teacherError });

    const { slots, teacherId, ...rest } = body;
    const course = await createCourse({
      code: rest.code,
      name: rest.name,
      description: rest.description ?? null,
      room: rest.room ?? null,
      term: rest.term,
      capacity: rest.capacity,
      active: rest.active,
      teacherId: teacherId ?? null,
    });
    await replaceSlots(course.id, slots);

    await audit(currentUser(req).sub, 'course.create', 'Course', course.id, { code: course.code });
    const [summary] = await courseSummaries([course]);
    return reply.code(201).send(summary);
  });

  app.get('/api/admin/courses/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const course = await courses.get(id);
    if (!course) return reply.code(404).send({ error: 'Class not found' });

    const [[summary], roster, courseSessions] = await Promise.all([
      courseSummaries([course]),
      enrollments.by('courseId', id),
      sessions.by('courseId', id),
    ]);
    const students = indexBy(await users.getMany(roster.map((e) => e.studentId)), (u) => u.id);

    return {
      ...summary,
      roster: sortBy(roster, (e) => e.createdAt.getTime()).flatMap((e) => {
        const student = students.get(e.studentId);
        return student
          ? [
              {
                id: student.id,
                username: student.username,
                realName: student.realName,
                email: student.email,
                enrollmentStatus: e.status,
              },
            ]
          : [];
      }),
      sessions: await sessionDtos(sortBy(courseSessions, (s) => s.startsAt.getTime())),
    };
  });

  app.patch('/api/admin/courses/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseOr400(updateCourseSchema, req.body, reply);
    if (!body) return;

    const existing = await courses.get(id);
    if (!existing) return reply.code(404).send({ error: 'Class not found' });
    if (body.teacherId !== undefined) {
      const teacherError = await validateTeacher(body.teacherId);
      if (teacherError) return reply.code(400).send({ error: teacherError });
    }
    if (body.code && body.code !== existing.code) {
      const clash = await courses.first('code', body.code);
      if (clash && clash.id !== id) {
        return reply.code(409).send({ error: `Class code "${body.code}" already exists` });
      }
    }

    const { slots, ...rest } = body;
    // Slots are replaced wholesale — the editor always sends the full set.
    if (slots) await replaceSlots(id, slots);
    const course = await updateCourse(existing, rest);

    await audit(currentUser(req).sub, 'course.update', 'Course', id, Object.keys(body));
    const [summary] = await courseSummaries([course]);
    return summary;
  });

  app.delete('/api/admin/courses/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const course = await courses.get(id);
    if (!course) return reply.code(404).send({ error: 'Class not found' });

    await deleteCourse(course);
    await audit(currentUser(req).sub, 'course.delete', 'Course', id);
    return reply.code(204).send();
  });

  // ------------------------------------------------------- sessions & roster

  app.post('/api/admin/courses/:id/sessions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseOr400(generateSessionsSchema, req.body, reply);
    if (!body) return;

    const course = await courses.get(id);
    if (!course) return reply.code(404).send({ error: 'Class not found' });
    const slots = await scheduleSlots.by('courseId', id);
    if (slots.length === 0) {
      return reply.code(400).send({ error: 'Add at least one weekly time slot first' });
    }

    const from = new Date(body.from);
    const to = new Date(body.to);
    const wanted = expandSlots(slots, from, to);

    if (body.replaceExisting) {
      const inRange = (await sessions.by('courseId', id)).filter(
        (s) => s.startsAt >= from && s.startsAt <= to,
      );
      // Attendance hangs off a session, so each one goes through the cascade.
      for (const s of inRange) await deleteSession(s.id);
    }

    // The meeting's (class, start time) IS its document id, so re-running over an
    // overlapping range cannot produce a duplicate — the ones already there are
    // simply skipped rather than rewritten.
    const ids = wanted.map((w) => sessionId(id, w.startsAt));
    const taken = new Set((await sessions.getMany(ids)).map((s) => s.id));
    const fresh = wanted.filter((w) => !taken.has(sessionId(id, w.startsAt)));

    const batch = new Batcher();
    for (const w of fresh) {
      batch.set(sessions.doc(sessionId(id, w.startsAt)), {
        courseId: id,
        startsAt: w.startsAt,
        endsAt: w.endsAt,
        room: course.room,
        status: 'SCHEDULED',
        teacherCheckedInAt: null,
        teacherNote: null,
      });
    }
    const created = await batch.commit();

    await audit(currentUser(req).sub, 'session.generate', 'Course', id, { created });
    return { created, considered: wanted.length };
  });

  app.delete('/api/admin/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await sessions.get(id))) {
      return reply.code(404).send({ error: 'Session not found' });
    }
    await deleteSession(id);
    await audit(currentUser(req).sub, 'session.delete', 'Session', id);
    return reply.code(204).send();
  });

  app.post('/api/admin/courses/:id/enrollments', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseOr400(enrollSchema, req.body, reply);
    if (!body) return;

    const [course, student] = await Promise.all([courses.get(id), users.get(body.studentId)]);
    if (!course) return reply.code(404).send({ error: 'Class not found' });
    if (!student || student.role !== 'STUDENT') {
      return reply.code(400).send({ error: 'That user is not a student' });
    }

    const counts = await enrollmentCounts([id]);
    if (body.status === 'ENROLLED' && (counts.get(id) ?? 0) >= course.capacity) {
      return reply.code(409).send({ error: 'Class is at capacity — enroll as waitlisted instead' });
    }

    const enrollment = await enrollments.upsert(
      enrollmentId(body.studentId, id),
      { studentId: body.studentId, courseId: id, status: body.status },
      { status: body.status },
    );
    await audit(currentUser(req).sub, 'enrollment.upsert', 'Enrollment', enrollment.id, {
      courseId: id,
      studentId: body.studentId,
      status: body.status,
    });
    return reply.code(201).send(enrollment);
  });

  app.delete('/api/admin/courses/:id/enrollments/:studentId', async (req, reply) => {
    const { id, studentId } = req.params as { id: string; studentId: string };
    const key = enrollmentId(studentId, id);
    if (!(await enrollments.get(key))) {
      return reply.code(404).send({ error: 'That student is not on this roster' });
    }

    await enrollments.delete(key);
    await audit(currentUser(req).sub, 'enrollment.delete', 'Enrollment', key, {
      courseId: id,
      studentId,
    });
    return reply.code(204).send();
  });

  // ---------------------------------------------------------- change requests

  app.get('/api/admin/change-requests', async (req, reply) => {
    const q = parseOr400(listQuerySchema, req.query, reply);
    if (!q) return;

    const matched = q.status
      ? await changeRequests.by('status', q.status)
      : await changeRequests.all();
    const ordered = sortBy(matched, (r) => r.status, (r) => -r.createdAt.getTime());
    const page = paginate(ordered, q.page, q.pageSize);

    const [requesters, relatedCourses, relatedSessions] = await Promise.all([
      users.getMany(page.map((r) => r.requesterId)),
      courses.getMany(page.map((r) => r.courseId ?? '')),
      sessions.getMany(page.map((r) => r.sessionId ?? '')),
    ]);
    const byUser = indexBy(requesters, (u) => u.id);
    const byCourse = indexBy(relatedCourses, (c) => c.id);
    const bySession = indexBy(relatedSessions, (s) => s.id);

    return {
      items: page.map((r) => {
        const requester = byUser.get(r.requesterId);
        const course = r.courseId ? byCourse.get(r.courseId) : undefined;
        const session = r.sessionId ? bySession.get(r.sessionId) : undefined;
        return {
          ...r,
          createdAt: r.createdAt.toISOString(),
          reviewedAt: r.reviewedAt?.toISOString() ?? null,
          requester: requester
            ? { id: requester.id, realName: requester.realName, username: requester.username }
            : null,
          course: course ? { id: course.id, code: course.code, name: course.name } : null,
          session: session ? { id: session.id, startsAt: session.startsAt.toISOString() } : null,
        };
      }),
      total: matched.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  });

  app.patch('/api/admin/change-requests/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = parseOr400(reviewChangeRequestSchema, req.body, reply);
    if (!body) return;

    const existing = await changeRequests.get(id);
    if (!existing) return reply.code(404).send({ error: 'Request not found' });
    if (existing.status !== 'PENDING') {
      return reply.code(409).send({ error: 'This request has already been reviewed' });
    }

    const me = currentUser(req);
    const updated = await changeRequests.update(id, {
      status: body.status,
      reviewNote: body.reviewNote ?? null,
      reviewedById: me.sub,
      reviewedAt: new Date(),
    });

    // Approving a cancellation is the one request type we can action directly.
    if (body.status === 'APPROVED' && existing.type === 'CANCEL_SESSION' && existing.sessionId) {
      await sessions.update(existing.sessionId, { status: 'CANCELLED' });
    }

    await audit(me.sub, `change_request.${body.status.toLowerCase()}`, 'ChangeRequest', id);
    return updated;
  });

  // ----------------------------------------------- raw database browse/export

  app.get('/api/admin/tables', async () => {
    return Promise.all(
      BROWSABLE_TABLES.map(async (t) => ({ table: t, count: await collections[t].count() })),
    );
  });

  app.get('/api/admin/tables/:table', async (req, reply) => {
    const { table } = req.params as { table: string };
    if (!isBrowsable(table)) return reply.code(404).send({ error: `Unknown table "${table}"` });

    const q = parseOr400(listQuerySchema, req.query, reply);
    if (!q) return;

    const [items, total] = await Promise.all([
      readTable(table, q.pageSize, (q.page - 1) * q.pageSize),
      collections[table].count(),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  });

  app.get('/api/admin/export/:table', async (req, reply) => {
    const { table } = req.params as { table: string };
    if (!isBrowsable(table)) return reply.code(404).send({ error: `Unknown table "${table}"` });

    // Exports are whole-table by design; the console warns above ~50k rows.
    const rows = await readTable(table, 100_000, 0);
    await audit(currentUser(req).sub, 'data.export', table, null, { rows: rows.length });

    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${table}-${stamp}.csv"`)
      .send(toCsv(rows));
  });

  app.get('/api/admin/audit', async (req, reply) => {
    const q = parseOr400(listQuerySchema, req.query, reply);
    if (!q) return;

    const [items, total] = await Promise.all([
      auditLogs.run(
        auditLogs.ref
          .orderBy('createdAt', 'desc')
          .offset((q.page - 1) * q.pageSize)
          .limit(q.pageSize),
      ),
      countQuery(auditLogs.ref),
    ]);

    const actors = indexBy(await users.getMany(items.map((i) => i.actorId ?? '')), (u) => u.id);
    return {
      items: items.map((i) => ({
        ...i,
        actor: i.actorId
          ? (() => {
              const a = actors.get(i.actorId);
              return a ? { username: a.username, realName: a.realName } : null;
            })()
          : null,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  });

  // Everything scheduled in a window, across all classes.
  app.get('/api/admin/schedule', async (req, reply) => {
    const q = parseOr400(rangeQuerySchema, req.query, reply);
    if (!q) return;

    // Both bounds narrow `startsAt`, which keeps this to a single-field range
    // Firestore can serve. A meeting always ends after it starts, so bounding the
    // start by `to` never drops a row the `endsAt` filter below would have kept.
    let query = sessions.ref.orderBy('startsAt', 'asc');
    if (q.from) query = query.where('startsAt', '>=', new Date(q.from));
    if (q.to) query = query.where('startsAt', '<=', new Date(q.to));

    const found = await sessions.run(query.limit(500));
    const to = q.to ? new Date(q.to) : null;
    return sessionDtos(to ? found.filter((s) => s.endsAt <= to) : found);
  });
}

/** Returns an error message when the id is present but not a usable teacher. */
async function validateTeacher(teacherId: string | null | undefined): Promise<string | null> {
  if (!teacherId) return null;
  const teacher = await users.get(teacherId);
  if (!teacher) return 'That teacher does not exist';
  if (teacher.role !== 'TEACHER') return 'That user is not a teacher';
  if (!teacher.active) return 'That teacher account is deactivated';
  return null;
}

/** Drops a class's weekly pattern and writes the replacement in one go. */
async function replaceSlots(
  courseId: string,
  slots: { dayOfWeek: number; startTime: string; endTime: string }[],
) {
  await scheduleSlots.deleteWhere('courseId', courseId);
  if (slots.length === 0) return;
  const batch = new Batcher();
  for (const slot of slots) {
    batch.set(scheduleSlots.doc(scheduleSlots.newId()), { ...slot, courseId });
  }
  await batch.commit();
}
