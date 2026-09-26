import { z } from 'zod';
import {
  ROLES,
  ENROLLMENT_STATUSES,
  ATTENDANCE_STATUSES,
  SESSION_STATUSES,
  CHANGE_REQUEST_TYPES,
} from '@cm/shared';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * Public self-registration. The role is intentionally NOT accepted from the
 * client — the route always creates a STUDENT. Teachers and admins are
 * provisioned by an admin.
 */
export const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Letters, digits, dot, underscore and dash only'),
  password: z.string().min(8, 'At least 8 characters'),
  realName: z.string().min(1).max(120),
  email: z.string().email(),
  age: z.number().int().min(3).max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  emergencyContactName: z.string().max(120).nullable().optional(),
  emergencyContactPhone: z.string().max(40).nullable().optional(),
  emergencyContactRelation: z.string().max(60).nullable().optional(),
});

/** Contact fields every user has, regardless of role. */
const profileFields = {
  realName: z.string().min(1).max(120),
  email: z.string().email(),
  age: z.number().int().min(3).max(120).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  emergencyContactName: z.string().max(120).nullable().optional(),
  emergencyContactPhone: z.string().max(40).nullable().optional(),
  emergencyContactRelation: z.string().max(60).nullable().optional(),
};

export const createUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Letters, digits, dot, underscore and dash only'),
  password: z.string().min(8, 'At least 8 characters'),
  role: z.enum(ROLES),
  active: z.boolean().optional(),
  ...profileFields,
});

export const updateUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  ...profileFields,
  realName: profileFields.realName.optional(),
  email: profileFields.email.optional(),
});

/** What a user may change about themselves — never role or active. */
export const updateMeSchema = z.object({
  email: profileFields.email.optional(),
  phone: profileFields.phone,
  age: profileFields.age,
  emergencyContactName: profileFields.emergencyContactName,
  emergencyContactPhone: profileFields.emergencyContactPhone,
  emergencyContactRelation: profileFields.emergencyContactRelation,
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).optional(),
});

export const slotSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(TIME, 'Use HH:MM'),
  endTime: z.string().regex(TIME, 'Use HH:MM'),
});

export const createCourseSchema = z.object({
  code: z.string().min(2).max(30),
  name: z.string().min(1).max(140),
  description: z.string().max(2000).nullable().optional(),
  room: z.string().max(60).nullable().optional(),
  term: z.string().min(1).max(40),
  capacity: z.number().int().min(1).max(1000).default(30),
  active: z.boolean().default(true),
  teacherId: z.string().nullable().optional(),
  slots: z.array(slotSchema).default([]),
});

export const updateCourseSchema = createCourseSchema.partial();

export const generateSessionsSchema = z
  .object({
    from: z.string().datetime({ offset: true }).or(z.string().date()),
    to: z.string().datetime({ offset: true }).or(z.string().date()),
    replaceExisting: z.boolean().default(false),
  })
  .refine((v) => new Date(v.from) <= new Date(v.to), {
    message: '`from` must be on or before `to`',
  });

export const enrollSchema = z.object({
  studentId: z.string().min(1),
  status: z.enum(ENROLLMENT_STATUSES).default('ENROLLED'),
});

export const attendanceMarkSchema = z.object({
  studentId: z.string().min(1),
  status: z.enum(ATTENDANCE_STATUSES),
  note: z.string().max(500).nullable().optional(),
});

export const bulkAttendanceSchema = z.object({
  marks: z.array(attendanceMarkSchema).min(1),
});

export const teacherCheckInSchema = z.object({
  note: z.string().max(500).nullable().optional(),
});

export const sessionStatusSchema = z.object({
  status: z.enum(SESSION_STATUSES),
});

export const createChangeRequestSchema = z.object({
  type: z.enum(CHANGE_REQUEST_TYPES),
  details: z.string().min(1).max(2000),
  proposedValue: z.string().max(500).nullable().optional(),
  courseId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
});

export const reviewChangeRequestSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().max(1000).nullable().optional(),
});

export const listQuerySchema = z.object({
  q: z.string().optional(),
  role: z.enum(ROLES).optional(),
  status: z.string().optional(),
  term: z.string().optional(),
  teacherId: z.string().optional(),
  dayOfWeek: z.coerce.number().int().min(0).max(6).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const rangeQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});
