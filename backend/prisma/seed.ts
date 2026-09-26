/**
 * Seeds a demo school: one admin, four teachers, twelve students, six classes
 * with weekly slots, sessions spanning two weeks back to six weeks forward,
 * enrollments, attendance history and a couple of pending change requests.
 *
 *   npm run db:seed        (additive-safe: wipes and rebuilds demo data)
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { expandSlots, addDays, startOfWeek } from '../src/util.js';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'password123';
const TERM = '2026-Fall';

async function main() {
  console.log('Clearing existing data…');
  await prisma.auditLog.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.changeRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.scheduleSlot.deleteMany();
  await prisma.course.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  console.log('Creating users…');
  const admin = await prisma.user.create({
    data: {
      username: 'admin',
      passwordHash,
      role: 'ADMIN',
      realName: 'Dana Okafor',
      email: 'admin@school.example',
      age: 44,
      phone: '+1-555-0100',
      emergencyContactName: 'Ruth Okafor',
      emergencyContactPhone: '+1-555-0101',
      emergencyContactRelation: 'Spouse',
    },
  });

  const teacherSeeds = [
    ['tanaka', 'Hiroshi Tanaka', 'h.tanaka@school.example', 38],
    ['mwangi', 'Grace Mwangi', 'g.mwangi@school.example', 45],
    ['silva', 'Rafael Silva', 'r.silva@school.example', 33],
    ['petrov', 'Irina Petrov', 'i.petrov@school.example', 51],
  ] as const;

  const teachers = await Promise.all(
    teacherSeeds.map(([username, realName, email, age], i) =>
      prisma.user.create({
        data: {
          username,
          passwordHash,
          role: 'TEACHER',
          realName,
          email,
          age,
          phone: `+1-555-02${String(i).padStart(2, '0')}`,
          emergencyContactName: 'School Front Office',
          emergencyContactPhone: '+1-555-0199',
          emergencyContactRelation: 'Workplace',
        },
      }),
    ),
  );

  const studentSeeds = [
    ['alice', 'Alice Nguyen', 16],
    ['brian', 'Brian Adeyemi', 17],
    ['chen', 'Chen Wei', 16],
    ['diego', 'Diego Ramirez', 15],
    ['emma', 'Emma Larsson', 17],
    ['farah', 'Farah Haddad', 16],
    ['gabriel', 'Gabriel Costa', 18],
    ['hana', 'Hana Kim', 15],
    ['ivan', 'Ivan Novak', 17],
    ['julia', 'Julia Rossi', 16],
    ['kwame', 'Kwame Boateng', 18],
    ['lena', 'Lena Fischer', 15],
  ] as const;

  const students = await Promise.all(
    studentSeeds.map(([username, realName, age], i) =>
      prisma.user.create({
        data: {
          username,
          passwordHash,
          role: 'STUDENT',
          realName,
          email: `${username}@students.school.example`,
          age,
          phone: `+1-555-03${String(i).padStart(2, '0')}`,
          emergencyContactName: `${realName.split(' ')[1]} household`,
          emergencyContactPhone: `+1-555-04${String(i).padStart(2, '0')}`,
          emergencyContactRelation: i % 3 === 0 ? 'Father' : i % 3 === 1 ? 'Mother' : 'Guardian',
        },
      }),
    ),
  );

  console.log('Creating classes…');
  const courseSeeds = [
    {
      code: 'MATH-201',
      name: 'Linear Algebra',
      description: 'Vectors, matrices, eigenvalues and their applications.',
      room: 'B-104',
      capacity: 6,
      teacher: teachers[0],
      slots: [
        { dayOfWeek: 1, startTime: '09:00', endTime: '10:30' },
        { dayOfWeek: 3, startTime: '09:00', endTime: '10:30' },
      ],
    },
    {
      code: 'PHYS-110',
      name: 'Classical Mechanics',
      description: 'Newtonian motion, energy, momentum and rotational dynamics.',
      room: 'Lab 2',
      capacity: 8,
      teacher: teachers[0],
      slots: [{ dayOfWeek: 2, startTime: '11:00', endTime: '12:30' }],
    },
    {
      code: 'BIO-150',
      name: 'Cell Biology',
      description: 'Structure and function of the cell, with weekly lab work.',
      room: 'Lab 1',
      capacity: 10,
      teacher: teachers[1],
      slots: [
        { dayOfWeek: 1, startTime: '13:00', endTime: '14:30' },
        { dayOfWeek: 4, startTime: '13:00', endTime: '15:00' },
      ],
    },
    {
      code: 'HIST-101',
      name: 'Modern World History',
      description: '1789 to the present, with an emphasis on primary sources.',
      room: 'A-210',
      capacity: 12,
      teacher: teachers[2],
      slots: [{ dayOfWeek: 3, startTime: '14:00', endTime: '15:30' }],
    },
    {
      code: 'CS-130',
      name: 'Intro to Programming',
      description: 'Problem solving in Python; no prior experience required.',
      room: 'C-Lab',
      capacity: 10,
      teacher: teachers[3],
      slots: [
        { dayOfWeek: 2, startTime: '09:00', endTime: '10:30' },
        { dayOfWeek: 5, startTime: '09:00', endTime: '10:30' },
      ],
    },
    {
      code: 'ART-090',
      name: 'Studio Drawing',
      description: 'Observational drawing in graphite, charcoal and ink.',
      room: 'Studio',
      capacity: 8,
      teacher: null, // deliberately unassigned, so the admin console has work to do
      slots: [{ dayOfWeek: 5, startTime: '13:00', endTime: '15:00' }],
    },
  ];

  const courses = [];
  for (const seed of courseSeeds) {
    courses.push(
      await prisma.course.create({
        data: {
          code: seed.code,
          name: seed.name,
          description: seed.description,
          room: seed.room,
          term: TERM,
          capacity: seed.capacity,
          teacherId: seed.teacher?.id ?? null,
          slots: { create: seed.slots },
        },
        include: { slots: true },
      }),
    );
  }

  console.log('Generating sessions…');
  const weekStart = startOfWeek(new Date());
  const from = addDays(weekStart, -14);
  const to = addDays(weekStart, 42);

  for (const course of courses) {
    const meetings = expandSlots(course.slots, from, to);
    await prisma.session.createMany({
      data: meetings.map((m) => ({
        courseId: course.id,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        room: course.room,
        status: m.endsAt < new Date() ? 'COMPLETED' : 'SCHEDULED',
      })),
    });
  }

  console.log('Enrolling students…');
  // Deterministic spread: student i takes classes i, i+1 and i+3 (mod 6).
  for (const [i, student] of students.entries()) {
    for (const offset of [0, 1, 3]) {
      const course = courses[(i + offset) % courses.length];
      const count = await prisma.enrollment.count({ where: { courseId: course.id } });
      await prisma.enrollment.upsert({
        where: { studentId_courseId: { studentId: student.id, courseId: course.id } },
        create: {
          studentId: student.id,
          courseId: course.id,
          status: count >= course.capacity ? 'WAITLISTED' : 'ENROLLED',
        },
        update: {},
      });
    }
  }

  console.log('Recording attendance for past sessions…');
  const pastSessions = await prisma.session.findMany({
    where: { endsAt: { lt: new Date() } },
    include: { course: { include: { enrollments: true } } },
  });

  let marks = 0;
  for (const [sIndex, session] of pastSessions.entries()) {
    if (!session.course.teacherId) continue; // unassigned class: nobody to check anyone in

    await prisma.session.update({
      where: { id: session.id },
      data: { teacherCheckedInAt: new Date(session.startsAt.getTime() - 5 * 60_000) },
    });

    const roster = session.course.enrollments.filter((e) => e.status !== 'DROPPED');
    for (const [eIndex, enrollment] of roster.entries()) {
      // ~8% absent, ~6% late, the rest present — stable across re-seeds.
      const bucket = (sIndex * 7 + eIndex * 3) % 17;
      const status = bucket === 0 ? 'ABSENT' : bucket === 5 ? 'LATE' : bucket === 11 ? 'EXCUSED' : 'PRESENT';
      await prisma.attendance.create({
        data: {
          sessionId: session.id,
          studentId: enrollment.studentId,
          status,
          note: status === 'ABSENT' ? 'No contact from guardian' : null,
          recordedById: session.course.teacherId,
        },
      });
      marks++;
    }
  }
  console.log(`  ${marks} attendance rows across ${pastSessions.length} past sessions`);

  console.log('Adding change requests…');
  const upcoming = await prisma.session.findFirst({
    where: { startsAt: { gt: new Date() }, course: { teacherId: teachers[0].id } },
    orderBy: { startsAt: 'asc' },
  });

  await prisma.changeRequest.create({
    data: {
      type: 'ROOM_CHANGE',
      details: 'B-104 has no projector. Requesting a move to A-210 for the rest of term.',
      proposedValue: 'A-210',
      requesterId: teachers[0].id,
      courseId: courses[0].id,
    },
  });

  if (upcoming) {
    await prisma.changeRequest.create({
      data: {
        type: 'CANCEL_SESSION',
        details: 'Away at a district assessment workshop that morning.',
        requesterId: teachers[0].id,
        courseId: upcoming.courseId,
        sessionId: upcoming.id,
      },
    });
  }

  await prisma.changeRequest.create({
    data: {
      type: 'SCHEDULE_CHANGE',
      details: 'Thursday lab regularly overruns. Requesting a 30-minute extension.',
      proposedValue: 'Thu 13:00–15:30',
      status: 'APPROVED',
      requesterId: teachers[1].id,
      courseId: courses[2].id,
      reviewedById: admin.id,
      reviewNote: 'Approved from next week. Room booked.',
      reviewedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: { actorId: admin.id, action: 'db.seed', entity: 'System', detail: JSON.stringify({ TERM }) },
  });

  console.log(`
Done. Sign in at http://localhost:5173 — every demo account uses "${DEMO_PASSWORD}".

  admin      admin           full console, all data, CSV export
  teacher    tanaka          MATH-201, PHYS-110
  teacher    mwangi          BIO-150
  teacher    silva           HIST-101
  teacher    petrov          CS-130
  student    alice … lena    12 students, 3 classes each
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
