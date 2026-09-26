/**
 * Types and constants shared by the API and the web UI.
 * Runtime values here must stay dependency-free — this file is loaded by both
 * the Node server (via tsx) and the browser bundle (via Vite).
 */

export const ROLES = ['ADMIN', 'TEACHER', 'STUDENT'] as const;
export type Role = (typeof ROLES)[number];

export const ENROLLMENT_STATUSES = ['ENROLLED', 'WAITLISTED', 'DROPPED'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export const ATTENDANCE_STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const SESSION_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const CHANGE_REQUEST_TYPES = [
  'SCHEDULE_CHANGE',
  'ROOM_CHANGE',
  'CANCEL_SESSION',
  'ROSTER_CHANGE',
  'OTHER',
] as const;
export type ChangeRequestType = (typeof CHANGE_REQUEST_TYPES)[number];

export const CHANGE_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Tables the admin console is allowed to browse and export. */
export const BROWSABLE_TABLES = [
  'user',
  'course',
  'scheduleSlot',
  'session',
  'enrollment',
  'attendance',
  'changeRequest',
  'auditLog',
] as const;
export type BrowsableTable = (typeof BROWSABLE_TABLES)[number];

export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  realName: string;
  email: string;
  age: number | null;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}

export interface CourseSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  room: string | null;
  term: string;
  capacity: number;
  active: boolean;
  teacher: { id: string; realName: string; username: string } | null;
  slots: ScheduleSlotDto[];
  enrolledCount: number;
}

export interface ScheduleSlotDto {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface SessionDto {
  id: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  startsAt: string;
  endsAt: string;
  room: string | null;
  status: SessionStatus;
  teacherCheckedInAt: string | null;
  teacherName: string | null;
}

export interface RosterEntry {
  studentId: string;
  username: string;
  realName: string;
  email: string;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  enrollmentStatus: EnrollmentStatus;
  attendance: { status: AttendanceStatus; note: string | null } | null;
}

export interface ChangeRequestDto {
  id: string;
  type: ChangeRequestType;
  status: ChangeRequestStatus;
  details: string;
  proposedValue: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string | null;
  requester: { id: string; realName: string; username: string };
  course: { id: string; code: string; name: string } | null;
  session: { id: string; startsAt: string } | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  error: string;
  details?: unknown;
}

/** `2026-07-23T09:00:00.000Z` -> `Thu Jul 23, 09:00`, in the viewer's locale. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTimeRange(startIso: string, endIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  return `${new Date(startIso).toLocaleTimeString(undefined, opts)} – ${new Date(
    endIso,
  ).toLocaleTimeString(undefined, opts)}`;
}
