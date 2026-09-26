/**
 * The joins Prisma's `include` used to do. Every one of these takes a list of
 * documents and fetches the related collections once for the whole list, so a
 * page of 25 classes costs a fixed handful of reads rather than 25 round trips.
 */
import type { CourseSummary, ScheduleSlotDto, SessionDto } from '@cm/shared';
import {
  courses,
  enrollments,
  scheduleSlots,
  users,
  type CourseDoc,
  type ScheduleSlotDoc,
  type SessionDoc,
  type UserDoc,
} from './db.js';
import { groupBy, indexBy, sortBy, toSessionDto } from './util.js';

export type TeacherRef = { id: string; realName: string; username: string } | null;

const teacherRef = (u: UserDoc | undefined): TeacherRef =>
  u ? { id: u.id, realName: u.realName, username: u.username } : null;

export const toSlotDto = (s: ScheduleSlotDoc): ScheduleSlotDto => ({
  id: s.id,
  dayOfWeek: s.dayOfWeek,
  startTime: s.startTime,
  endTime: s.endTime,
});

export const sortSlots = (slots: ScheduleSlotDoc[]) =>
  sortBy(slots, (s) => s.dayOfWeek, (s) => s.startTime);

/** Weekly slots for a set of classes, grouped by class and already in day order. */
export async function slotsByCourse(courseIds: string[]): Promise<Map<string, ScheduleSlotDoc[]>> {
  const slots = await scheduleSlots.in('courseId', courseIds);
  const grouped = groupBy(slots, (s) => s.courseId);
  for (const [id, list] of grouped) grouped.set(id, sortSlots(list));
  return grouped;
}

/**
 * Headcount per class. Counts every enrollment row including DROPPED, which is
 * what `_count: { enrollments: true }` did — capacity checks have always been
 * measured against it, so the number must not quietly change meaning.
 */
export async function enrollmentCounts(courseIds: string[]): Promise<Map<string, number>> {
  const rows = await enrollments.in('courseId', courseIds);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.courseId, (counts.get(row.courseId) ?? 0) + 1);
  return counts;
}

export async function teachersFor(list: { teacherId: string | null }[]): Promise<Map<string, UserDoc>> {
  const ids = list.map((c) => c.teacherId).filter((id): id is string => Boolean(id));
  return indexBy(await users.getMany(ids), (u) => u.id);
}

/** The `CourseSummary` shape the admin and student consoles both render. */
export async function courseSummaries(list: CourseDoc[]): Promise<CourseSummary[]> {
  if (list.length === 0) return [];
  const ids = list.map((c) => c.id);
  const [slots, counts, teachers] = await Promise.all([
    slotsByCourse(ids),
    enrollmentCounts(ids),
    teachersFor(list),
  ]);

  return list.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    description: c.description,
    room: c.room,
    term: c.term,
    capacity: c.capacity,
    active: c.active,
    teacher: teacherRef(c.teacherId ? teachers.get(c.teacherId) : undefined),
    slots: (slots.get(c.id) ?? []).map(toSlotDto),
    enrolledCount: counts.get(c.id) ?? 0,
  }));
}

/** Sessions with their class code, name, room and teacher name stitched on. */
export async function sessionDtos(list: SessionDoc[]): Promise<SessionDto[]> {
  if (list.length === 0) return [];
  const courseList = await courses.getMany(list.map((s) => s.courseId));
  const byCourse = indexBy(courseList, (c) => c.id);
  const teachers = await teachersFor(courseList);

  return list.map((s) => {
    const course = byCourse.get(s.courseId) ?? null;
    const teacher = course?.teacherId ? teachers.get(course.teacherId) : undefined;
    return toSessionDto(s, course, teacher?.realName ?? null);
  });
}

/** One session, joined the same way. */
export async function sessionDto(session: SessionDoc): Promise<SessionDto> {
  const [dto] = await sessionDtos([session]);
  return dto;
}
