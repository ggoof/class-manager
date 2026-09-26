/**
 * Seeds a demo enrichment school into Firestore: one admin, five teachers,
 * fifteen students, thirteen classes (science, AoPS math, aerospace, data
 * projects, AL prep) with weekly slots, sessions spanning two weeks back to six
 * weeks forward, enrollments, attendance history and a few change requests.
 *
 *   npm run db:seed        (wipes the collections it owns, then rebuilds)
 *
 * Point it at a throwaway project, or the emulator, before you run it anywhere
 * that matters — the first thing it does is delete.
 *
 * Slot times are wall-clock times expanded in the machine's local zone, so run
 * this on a machine set to the school's zone (the Cloud Function pins
 * America/Los_Angeles).
 */
import bcrypt from 'bcryptjs';
import {
  attendance,
  attendanceId,
  auditLogs,
  changeRequests,
  collections,
  courses,
  createCourse,
  createUser,
  enrollmentId,
  enrollments,
  scheduleSlots,
  sessionId,
  sessions,
  users,
  type CourseDoc,
  type UserDoc,
} from '../src/db.js';
import { Batcher, deleteQuery, firestore } from '../src/firestore.js';
import { addDays, expandSlots, startOfWeek } from '../src/util.js';
import { env } from '../src/env.js';

const DEMO_PASSWORD = 'password123';
const TERM = '2026-Fall';

async function clear() {
  console.log(`Clearing existing data in project "${env.firebaseProjectId}"…`);
  for (const repo of Object.values(collections)) await deleteQuery(repo.ref);
  await deleteQuery(firestore.collection('uniqueKeys'));
}

async function main() {
  await clear();

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const person = (over: Partial<UserDoc> & { username: string; realName: string; email: string }) =>
    createUser({
      passwordHash,
      role: 'STUDENT',
      age: null,
      phone: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      emergencyContactRelation: null,
      active: true,
      ...over,
    });

  console.log('Creating users…');
  const admin = await person({
    username: 'admin',
    role: 'ADMIN',
    realName: 'Dana Okafor',
    email: 'admin@school.example',
    age: 44,
    phone: '+1-555-0100',
    emergencyContactName: 'Ruth Okafor',
    emergencyContactPhone: '+1-555-0101',
    emergencyContactRelation: 'Spouse',
  });

  const teacherSeeds = [
    ['li', 'Wei Li', 'w.li@school.example', 41], // Science
    ['zhang', 'Min Zhang', 'm.zhang@school.example', 36], // AoPS Math
    ['chen', 'Jun Chen', 'j.chen@school.example', 44], // Tech: Aerospace
    ['huang', 'Lei Huang', 'l.huang@school.example', 39], // Data & Projects
    ['guo', 'Yan Guo', 'y.guo@school.example', 33], // AL Prep
  ] as const;

  const teachers: UserDoc[] = [];
  for (const [i, [username, realName, email, age]] of teacherSeeds.entries()) {
    teachers.push(
      await person({
        username,
        role: 'TEACHER',
        realName,
        email,
        age,
        phone: `+1-555-02${String(i).padStart(2, '0')}`,
        emergencyContactName: 'School Front Office',
        emergencyContactPhone: '+1-555-0199',
        emergencyContactRelation: 'Workplace',
      }),
    );
  }

  // [username, name, age, class codes]. Each Science Scholar student belongs to
  // exactly one cohort (named for the term they joined), and nobody is booked
  // into two classes at once.
  const studentSeeds = [
    ['ethan', 'Ethan Wang', 12, ['SS-PHY4-25F', 'TECH-AERO', 'DATA-PROJ']],
    ['jason', 'Jason Zhou', 12, ['SS-PHY4-25F', 'DATA-PROJ']],
    ['olivia', 'Olivia Liu', 14, ['ES-HSCHEM1-26F', 'DATA-PROJ']],
    ['grace', 'Grace Wu', 12, ['SS-CHEM1-25S', 'TECH-AERO']],
    ['lucas', 'Lucas Zhao', 11, ['SS-PHY5-25U-A']],
    ['sophia', 'Sophia Lin', 11, ['SS-PHY5-25U-B', 'DATA-PROJ']],
    ['kevin', 'Kevin Tang', 11, ['SS-PHY5-25U-B', 'TECH-AERO']],
    ['ryan', 'Ryan Xu', 10, ['SS-PHY1-26F-A', 'AOPS-BA4']],
    ['chloe', 'Chloe Sun', 10, ['SS-PHY1-26F-B', 'AOPS-BA4']],
    ['mia', 'Mia He', 10, ['SS-PHY1-26F-A', 'AOPS-PREALG']],
    ['aiden', 'Aiden Ma', 9, ['LS-PHY-26F', 'AOPS-BA4']],
    ['emily', 'Emily Hu', 9, ['LS-PHY-26F', 'AOPS-PREALG']],
    ['nathan', 'Nathan Gao', 7, ['AL-PREP-G2']],
    ['lily', 'Lily Deng', 8, ['AL-PREP-G2']],
    ['daniel', 'Daniel Luo', 7, ['AL-PREP-G2']],
  ] as const;

  const students: UserDoc[] = [];
  for (const [i, [username, realName, age]] of studentSeeds.entries()) {
    students.push(
      await person({
        username,
        role: 'STUDENT',
        realName,
        email: `${username}@students.school.example`,
        age,
        phone: `+1-555-03${String(i).padStart(2, '0')}`,
        emergencyContactName: `${realName.split(' ')[1]} household`,
        emergencyContactPhone: `+1-555-04${String(i).padStart(2, '0')}`,
        emergencyContactRelation: i % 3 === 0 ? 'Father' : i % 3 === 1 ? 'Mother' : 'Guardian',
      }),
    );
  }

  console.log('Creating classes…');
  const NO_TRANSFERS =
    'Because the science curriculum builds week to week, this class cannot take ' +
    'mid-term transfer students. Interested students are welcome to register for ' +
    'the new winter classes at the end of the year.';
  const AOPS_ON_DEMAND = 'Beast Academy 2–5 and Algebra classes open on demand — contact us to ask.';

  const [li, zhang, chen, huang, guo] = teachers;
  const [SUN, WED, THU, FRI, SAT] = [0, 3, 4, 5, 6];
  const slot = (dayOfWeek: number, startTime: string, endTime: string) => ({
    dayOfWeek,
    startTime,
    endTime,
  });
  const science = (code: string, name: string, slots: ReturnType<typeof slot>[]) => ({
    code,
    name,
    description: NO_TRANSFERS,
    room: 'Science Lab',
    capacity: 8,
    teacher: li,
    slots,
  });

  const courseSeeds = [
    // <Science> — Teacher Li
    science('SS-PHY4-25F', 'Science Scholar: Physics IV (Fall 2025 Cohort)', [
      slot(WED, '12:50', '14:20'),
    ]),
    science('SS-CHEM1-25S', 'Science Scholar: Chemistry I (Spring 2025 Cohort)', [
      slot(WED, '14:30', '16:00'),
    ]),
    science('SS-PHY5-25U-A', 'Science Scholar: Physics V (Summer 2025 Cohort A)', [
      slot(WED, '16:30', '18:00'),
    ]),
    science('SS-PHY1-26F-A', 'Science Scholar: Physics I (Fall 2026 Cohort A)', [
      slot(FRI, '16:30', '18:00'),
    ]),
    science('ES-HSCHEM1-26F', 'Elite Science: High School Chemistry I (Fall 2026 Cohort)', [
      slot(SAT, '11:00', '12:30'),
    ]),
    science('LS-PHY-26F', 'Lite Science: Physics (Fall 2026 Cohort)', [
      slot(SAT, '14:30', '16:00'),
    ]),
    science('SS-PHY5-25U-B', 'Science Scholar: Physics V (Summer 2025 Cohort B)', [
      slot(SAT, '16:30', '18:00'),
    ]),
    science('SS-PHY1-26F-B', 'Science Scholar: Physics I (Fall 2026 Cohort B)', [
      slot(SAT, '18:30', '20:00'),
    ]),
    // <AoPS Math> — Teacher Zhang
    {
      code: 'AOPS-BA4',
      name: 'AoPS Math: Beast Academy 4',
      description: `Art of Problem Solving's Beast Academy, level 4. ${AOPS_ON_DEMAND}`,
      room: 'Room 101',
      capacity: 8,
      teacher: zhang,
      slots: [slot(WED, '17:00', '19:00')],
    },
    {
      code: 'AOPS-PREALG',
      name: 'AoPS Math: Pre-Algebra (Now Enrolling)',
      description: `Now enrolling. Meets Tuesdays; time to be confirmed. ${AOPS_ON_DEMAND}`,
      room: 'Room 101',
      capacity: 8,
      teacher: zhang,
      slots: [], // no time set yet, so no sessions until one is
    },
    // <Tech: Aerospace> — Teacher Chen
    {
      code: 'TECH-AERO',
      name: 'Tech: Aerospace',
      description: 'Flight, rocketry and spacecraft design through hands-on builds.',
      room: 'Maker Lab',
      capacity: 10,
      teacher: chen,
      slots: [slot(THU, '15:00', '16:30')],
    },
    // <Data-Driven Decisions & Project Practice> — Teacher Huang
    {
      code: 'DATA-PROJ',
      name: 'Data-Driven Decisions & Project Practice',
      description: 'Collect, analyze and present data to answer real questions, project by project.',
      room: 'Room 102',
      capacity: 10,
      teacher: huang,
      slots: [slot(SUN, '14:30', '16:30')],
    },
    // <AL Prep> — Teacher Guo
    {
      code: 'AL-PREP-G2',
      name: 'AL Prep (Grade 2)',
      description: 'Preparation for Advanced Learning program testing, for 2nd graders.',
      room: 'Room 103',
      capacity: 6,
      teacher: guo,
      slots: [slot(SUN, '15:00', '16:30')],
    },
  ];

  const created: { course: CourseDoc; slots: (typeof courseSeeds)[number]['slots'] }[] = [];
  for (const seed of courseSeeds) {
    const course = await createCourse({
      code: seed.code,
      name: seed.name,
      description: seed.description,
      room: seed.room,
      term: TERM,
      capacity: seed.capacity,
      active: true,
      teacherId: seed.teacher.id,
    });
    const batch = new Batcher();
    for (const s of seed.slots) {
      batch.set(scheduleSlots.doc(scheduleSlots.newId()), { ...s, courseId: course.id });
    }
    await batch.commit();
    created.push({ course, slots: seed.slots });
  }
  const byCode = new Map(created.map(({ course }) => [course.code, course]));

  console.log('Generating sessions…');
  const weekStart = startOfWeek(new Date());
  const from = addDays(weekStart, -14);
  const to = addDays(weekStart, 42);
  const now = new Date();

  for (const { course, slots } of created) {
    const batch = new Batcher();
    for (const meeting of expandSlots(slots, from, to)) {
      batch.set(sessions.doc(sessionId(course.id, meeting.startsAt)), {
        courseId: course.id,
        startsAt: meeting.startsAt,
        endsAt: meeting.endsAt,
        room: course.room,
        status: meeting.endsAt < now ? 'COMPLETED' : 'SCHEDULED',
        // A past meeting reads as one the teacher turned up to, five minutes early.
        teacherCheckedInAt:
          meeting.endsAt < now && course.teacherId
            ? new Date(meeting.startsAt.getTime() - 5 * 60_000)
            : null,
        teacherNote: null,
      });
    }
    await batch.commit();
  }

  console.log('Enrolling students…');
  const perCourse = new Map<string, number>();
  const enrollBatch = new Batcher();
  const rosters = new Map<string, string[]>();
  for (const [i, student] of students.entries()) {
    for (const code of studentSeeds[i][3]) {
      const course = byCode.get(code);
      if (!course) throw new Error(`Seed enrolls ${student.username} in unknown class ${code}`);
      const count = perCourse.get(course.id) ?? 0;
      perCourse.set(course.id, count + 1);
      enrollBatch.set(enrollments.doc(enrollmentId(student.id, course.id)), {
        studentId: student.id,
        courseId: course.id,
        status: count >= course.capacity ? 'WAITLISTED' : 'ENROLLED',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      rosters.set(course.id, [...(rosters.get(course.id) ?? []), student.id]);
    }
  }
  await enrollBatch.commit();

  console.log('Recording attendance for past sessions…');
  const past = (await sessions.all()).filter((s) => s.endsAt < now);
  const byId = new Map(created.map(({ course }) => [course.id, course]));

  const markBatch = new Batcher();
  let marks = 0;
  for (const [sIndex, session] of past.entries()) {
    const course = byId.get(session.courseId);
    if (!course?.teacherId) continue; // unassigned class: nobody to check anyone in

    for (const [eIndex, studentId] of (rosters.get(course.id) ?? []).entries()) {
      // ~8% absent, ~6% late, the rest present — stable across re-seeds.
      const bucket = (sIndex * 7 + eIndex * 3) % 17;
      const status =
        bucket === 0 ? 'ABSENT' : bucket === 5 ? 'LATE' : bucket === 11 ? 'EXCUSED' : 'PRESENT';
      markBatch.set(attendance.doc(attendanceId(session.id, studentId)), {
        sessionId: session.id,
        studentId,
        status,
        note: status === 'ABSENT' ? 'No contact from guardian' : null,
        recordedById: course.teacherId,
        recordedAt: new Date(session.startsAt.getTime() + 10 * 60_000),
      });
      marks++;
    }
  }
  await markBatch.commit();
  console.log(`  ${marks} attendance rows across ${past.length} past sessions`);

  console.log('Adding change requests…');
  const upcoming = (await sessions.by('courseId', byCode.get('SS-PHY1-26F-A')!.id))
    .filter((s) => s.startsAt > now)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0];

  const request = (data: Record<string, unknown>) =>
    changeRequests.create({
      status: 'PENDING',
      proposedValue: null,
      courseId: null,
      sessionId: null,
      reviewedById: null,
      reviewNote: null,
      reviewedAt: null,
      ...data,
    });

  await request({
    type: 'ROOM_CHANGE',
    details:
      'Physics IV is starting the optics unit and needs blackout blinds. Requesting Room 102 on Wednesdays.',
    proposedValue: 'Room 102',
    requesterId: li.id,
    courseId: byCode.get('SS-PHY4-25F')!.id,
  });

  if (upcoming) {
    await request({
      type: 'CANCEL_SESSION',
      details: 'Attending a Science Olympiad coaching workshop that day. Will send make-up materials.',
      requesterId: li.id,
      courseId: upcoming.courseId,
      sessionId: upcoming.id,
    });
  }

  await request({
    type: 'SCHEDULE_CHANGE',
    details: 'Pre-Algebra has reached its minimum enrollment. Proposing Tuesdays 5:00–7:00 pm.',
    proposedValue: 'Tue 17:00–19:00',
    requesterId: zhang.id,
    courseId: byCode.get('AOPS-PREALG')!.id,
  });

  await request({
    type: 'SCHEDULE_CHANGE',
    details: 'Rocket launch labs keep running over. Requesting a 30-minute extension on Thursdays.',
    proposedValue: 'Thu 15:00–17:00',
    status: 'APPROVED',
    requesterId: chen.id,
    courseId: byCode.get('TECH-AERO')!.id,
    reviewedById: admin.id,
    reviewNote: 'Approved from next week. The Maker Lab is free until 5.',
    reviewedAt: new Date(),
  });

  await auditLogs.create({
    actorId: admin.id,
    action: 'db.seed',
    entity: 'System',
    entityId: null,
    detail: JSON.stringify({ TERM }),
  });

  const [userCount, courseCount, sessionCount] = await Promise.all([
    users.count(),
    courses.count(),
    sessions.count(),
  ]);

  console.log(`
Done — ${userCount} users, ${courseCount} classes, ${sessionCount} sessions.
Every demo account uses "${DEMO_PASSWORD}".

  admin      admin           full console, all data, CSV export
  teacher    li              8 science classes (Science Scholar / Elite / Lite)
  teacher    zhang           AoPS Beast Academy 4, Pre-Algebra
  teacher    chen            Tech: Aerospace
  teacher    huang           Data-Driven Decisions & Project Practice
  teacher    guo             AL Prep (Grade 2)
  student    ethan … daniel  15 students, 1–3 classes each
`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
