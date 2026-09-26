import type { FastifyInstance } from 'fastify';
import {
  attendance,
  audit,
  courses,
  enrollmentId,
  enrollments,
  scheduleSlots,
  sessions,
  users,
  type CourseDoc,
  type ScheduleSlotDoc,
} from '../db.js';
import { currentUser, requireAuth, requireRole } from '../auth.js';
import { listQuerySchema, rangeQuerySchema } from '../schemas.js';
import {
  enrollmentCounts,
  sessionDtos,
  slotsByCourse,
  teachersFor,
  toSlotDto,
} from '../joins.js';
import {
  contains,
  indexBy,
  overlaps,
  paginate,
  parseOr400,
  resolveRange,
  sortBy,
} from '../util.js';

export async function studentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole('STUDENT'));

  /** Browse and search classes: by code, name, teacher name, term or weekday. */
  app.get('/api/student/catalog', async (req, reply) => {
    const q = parseOr400(listQuerySchema, req.query, reply);
    if (!q) return;
    const me = currentUser(req);

    const active = await courses.by('active', true);
    const [slots, teachers] = await Promise.all([
      slotsByCourse(active.map((c) => c.id)),
      teachersFor(active),
    ]);

    const matched = active.filter((c) => {
      if (q.term && c.term !== q.term) return false;
      if (q.teacherId && c.teacherId !== q.teacherId) return false;
      if (q.dayOfWeek !== undefined) {
        if (!(slots.get(c.id) ?? []).some((s) => s.dayOfWeek === q.dayOfWeek)) return false;
      }
      if (!q.q) return true;
      const teacher = c.teacherId ? teachers.get(c.teacherId) : undefined;
      return (
        contains(c.code, q.q) ||
        contains(c.name, q.q) ||
        contains(c.description, q.q) ||
        contains(teacher?.realName, q.q) ||
        contains(teacher?.username, q.q)
      );
    });

    const page = paginate(sortBy(matched, (c) => c.code), q.page, q.pageSize);
    const [counts, mine] = await Promise.all([
      enrollmentCounts(page.map((c) => c.id)),
      enrollments.by('studentId', me.sub),
    ]);
    const myStatus = new Map(mine.map((e) => [e.courseId, e.status]));

    return {
      items: page.map((c) => {
        const teacher = c.teacherId ? teachers.get(c.teacherId) : undefined;
        const enrolledCount = counts.get(c.id) ?? 0;
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          description: c.description,
          room: c.room,
          term: c.term,
          capacity: c.capacity,
          active: c.active,
          teacher: teacher
            ? { id: teacher.id, realName: teacher.realName, username: teacher.username }
            : null,
          slots: (slots.get(c.id) ?? []).map(toSlotDto),
          enrolledCount,
          seatsLeft: Math.max(0, c.capacity - enrolledCount),
          myStatus: myStatus.get(c.id) ?? null,
        };
      }),
      total: matched.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  });

  /** Search teachers, with the classes each of them runs. */
  app.get('/api/student/teachers', async (req, reply) => {
    const q = parseOr400(listQuerySchema, req.query, reply);
    if (!q) return;

    const matched = (await users.by('role', 'TEACHER')).filter(
      (t) => t.active && (!q.q || contains(t.realName, q.q) || contains(t.username, q.q)),
    );
    const page = sortBy(matched, (t) => t.realName).slice(0, q.pageSize);

    const taught = (await courses.in('teacherId', page.map((t) => t.id))).filter((c) => c.active);

    // Students see a teacher's work contact only — never their emergency details.
    return page.map((t) => ({
      id: t.id,
      username: t.username,
      realName: t.realName,
      email: t.email,
      courses: sortBy(
        taught.filter((c) => c.teacherId === t.id),
        (c) => c.code,
      ).map((c) => ({ id: c.id, code: c.code, name: c.name, term: c.term })),
    }));
  });

  app.get('/api/student/classes', async (req) => {
    const me = currentUser(req);
    const mine = sortBy(
      await enrollments.by('studentId', me.sub),
      (e) => -e.createdAt.getTime(),
    );

    const enrolledIn = await courses.getMany(mine.map((e) => e.courseId));
    const byCourse = indexBy(enrolledIn, (c) => c.id);
    const [slots, teachers] = await Promise.all([
      slotsByCourse(enrolledIn.map((c) => c.id)),
      teachersFor(enrolledIn),
    ]);

    return mine.flatMap((e) => {
      const course = byCourse.get(e.courseId);
      if (!course) return [];
      const teacher = course.teacherId ? teachers.get(course.teacherId) : undefined;
      return [
        {
          enrollmentId: e.id,
          status: e.status,
          enrolledAt: e.createdAt.toISOString(),
          course: {
            ...course,
            teacher: teacher
              ? {
                  id: teacher.id,
                  realName: teacher.realName,
                  username: teacher.username,
                  email: teacher.email,
                }
              : null,
            slots: (slots.get(course.id) ?? []).map(toSlotDto),
          },
        },
      ];
    });
  });

  app.post('/api/student/enrollments', async (req, reply) => {
    const { courseId } = (req.body ?? {}) as { courseId?: string };
    if (!courseId) return reply.code(400).send({ error: 'courseId is required' });
    const me = currentUser(req);

    const course = await courses.get(courseId);
    if (!course || !course.active) {
      return reply.code(404).send({ error: 'Class not found or no longer offered' });
    }

    const id = enrollmentId(me.sub, courseId);
    const existing = await enrollments.get(id);
    if (existing && existing.status !== 'DROPPED') {
      return reply.code(409).send({ error: 'You are already signed up for this class' });
    }

    const candidateSlots = await scheduleSlots.by('courseId', courseId);
    const clash = await findScheduleClash(me.sub, courseId, candidateSlots);
    if (clash) {
      return reply.code(409).send({
        error: `That time clashes with ${clash.code} — ${clash.name}`,
      });
    }

    const counts = await enrollmentCounts([courseId]);
    const full = (counts.get(courseId) ?? 0) >= course.capacity;
    const status = full ? 'WAITLISTED' : 'ENROLLED';

    const enrollment = await enrollments.upsert(
      id,
      { studentId: me.sub, courseId, status },
      { status },
    );
    await audit(me.sub, 'enrollment.self_select', 'Enrollment', enrollment.id, { courseId, status });
    return reply.code(201).send(enrollment);
  });

  app.delete('/api/student/enrollments/:courseId', async (req, reply) => {
    const { courseId } = req.params as { courseId: string };
    const me = currentUser(req);

    const id = enrollmentId(me.sub, courseId);
    const existing = await enrollments.get(id);
    if (!existing) return reply.code(404).send({ error: 'You are not signed up for that class' });

    // Kept as a DROPPED row rather than deleted, so past attendance still reads.
    await enrollments.update(id, { status: 'DROPPED' });
    await audit(me.sub, 'enrollment.self_drop', 'Enrollment', id, { courseId });
    return reply.code(204).send();
  });

  app.get('/api/student/schedule', async (req, reply) => {
    const q = parseOr400(rangeQuerySchema, req.query, reply);
    if (!q) return;
    const me = currentUser(req);
    const { start, end } = resolveRange(q.from, q.to);

    const mine = new Set(
      (await enrollments.by('studentId', me.sub))
        .filter((e) => e.status !== 'DROPPED')
        .map((e) => e.courseId),
    );
    const inRange = await sessions.run(
      sessions.ref.where('startsAt', '>=', start).where('startsAt', '<', end),
    );
    return sessionDtos(
      sortBy(inRange.filter((s) => mine.has(s.courseId)), (s) => s.startsAt.getTime()),
    );
  });

  app.get('/api/student/attendance', async (req) => {
    const me = currentUser(req);
    const marks = await attendance.by('studentId', me.sub);

    const marked = await sessions.getMany(marks.map((m) => m.sessionId));
    const bySession = indexBy(marked, (s) => s.id);
    const byCourse = indexBy(await courses.getMany(marked.map((s) => s.courseId)), (c) => c.id);

    const rows = marks.flatMap((m) => {
      const session = bySession.get(m.sessionId);
      if (!session) return [];
      const course = byCourse.get(session.courseId);
      return [
        {
          id: m.id,
          status: m.status,
          note: m.note,
          startsAt: session.startsAt.toISOString(),
          courseCode: course?.code ?? '',
          courseName: course?.name ?? '',
          sortKey: session.startsAt.getTime(),
        },
      ];
    });

    return sortBy(rows, (r) => -r.sortKey)
      .slice(0, 200)
      .map(({ sortKey: _drop, ...row }) => row);
  });
}

/**
 * Returns the first already-enrolled class whose weekly slots collide with the
 * candidate's, or null when the timetable is clear.
 */
async function findScheduleClash(
  studentId: string,
  candidateCourseId: string,
  candidateSlots: ScheduleSlotDoc[],
): Promise<CourseDoc | null> {
  if (candidateSlots.length === 0) return null;

  const current = (await enrollments.by('studentId', studentId)).filter(
    (e) => e.status !== 'DROPPED' && e.courseId !== candidateCourseId,
  );
  if (current.length === 0) return null;

  const currentCourses = await courses.getMany(current.map((e) => e.courseId));
  const slots = await slotsByCourse(currentCourses.map((c) => c.id));

  const asMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };

  for (const course of currentCourses) {
    for (const existing of slots.get(course.id) ?? []) {
      for (const candidate of candidateSlots) {
        if (existing.dayOfWeek !== candidate.dayOfWeek) continue;
        const collides = overlaps(
          new Date(0, 0, 1, 0, asMinutes(candidate.startTime)),
          new Date(0, 0, 1, 0, asMinutes(candidate.endTime)),
          new Date(0, 0, 1, 0, asMinutes(existing.startTime)),
          new Date(0, 0, 1, 0, asMinutes(existing.endTime)),
        );
        if (collides) return course;
      }
    }
  }
  return null;
}
