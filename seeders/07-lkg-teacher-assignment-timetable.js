'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // ── 1. Fetch Session ──────────────────────────────────────────────────
    const [sessions] = await queryInterface.sequelize.query(
      `SELECT id FROM sessions WHERE name = '2026-2027' LIMIT 1;`
    );
    if (sessions.length === 0) {
      console.log('Session "2026-2027" not found. Skipping seeding teacher assignments and timetable.');
      return;
    }
    const sessionId = sessions[0].id;

    // ── 2. Fetch Class (LKG) ──────────────────────────────────────────────
    const [classes] = await queryInterface.sequelize.query(
      `SELECT id FROM classes WHERE name = 'LKG' LIMIT 1;`
    );
    if (classes.length === 0) {
      console.log('Class "LKG" not found. Skipping seeding teacher assignments and timetable.');
      return;
    }
    const classId = classes[0].id;

    // ── 3. Fetch Section (A) ──────────────────────────────────────────────
    const [sections] = await queryInterface.sequelize.query(
      `SELECT id FROM sections WHERE class_id = :classId AND name = 'A' LIMIT 1;`,
      {
        replacements: { classId },
        type: queryInterface.sequelize.QueryTypes.SELECT,
      }
    );
    if (!sections || sections.length === 0) {
      console.log('Section "A" for LKG not found. Skipping seeding teacher assignments and timetable.');
      return;
    }
    // queryInterface.sequelize.QueryTypes.SELECT returns an array of objects
    // depending on the execution format, we extract sectionId safely
    const sectionId = typeof sections[0] === 'object' ? sections[0].id : sections.id || sections[0];

    // ── 4. Fetch Subjects ─────────────────────────────────────────────────
    const dbSubjects = await queryInterface.sequelize.query(
      `SELECT id, code FROM subjects WHERE class_id = :classId;`,
      {
        replacements: { classId },
        type: queryInterface.sequelize.QueryTypes.SELECT,
      }
    );
    const subjectMap = {};
    dbSubjects.forEach((sub) => {
      subjectMap[sub.code] = sub.id;
    });

    // We need English Oral (ENG-ORAL), English Writing (ENG-WRIT), Mathematics (MATH-PRE), Rhymes (RHYMES), Drawing (DRAW)
    const englishOralId = subjectMap['ENG-ORAL'];
    const englishWritingId = subjectMap['ENG-WRIT'];
    const mathsId = subjectMap['MATH-PRE'];
    const rhymesId = subjectMap['RHYMES'];
    const drawingId = subjectMap['DRAW'];

    if (!englishOralId || !englishWritingId || !mathsId || !rhymesId || !drawingId) {
      console.log('Missing one or more required LKG subjects in database. Required codes: ENG-ORAL, ENG-WRIT, MATH-PRE, RHYMES, DRAW.');
      return;
    }

    // ── 5. Fetch Teachers ─────────────────────────────────────────────────
    const teacherEmails = [
      'priya.singh@edu-example.com',
      'rajesh.kumar@edu-example.com',
      'sunita.verma@edu-example.com',
      'vikram.patel@edu-example.com',
    ];
    const dbTeachers = await queryInterface.sequelize.query(
      `SELECT id, email FROM teachers WHERE email IN (:emails);`,
      {
        replacements: { emails: teacherEmails },
        type: queryInterface.sequelize.QueryTypes.SELECT,
      }
    );
    const teacherMap = {};
    dbTeachers.forEach((t) => {
      teacherMap[t.email] = t.id;
    });

    const priyaId = teacherMap['priya.singh@edu-example.com'];
    const rajeshId = teacherMap['rajesh.kumar@edu-example.com'];
    const sunitaId = teacherMap['sunita.verma@edu-example.com'];
    const vikramId = teacherMap['vikram.patel@edu-example.com'];

    if (!priyaId || !rajeshId || !sunitaId || !vikramId) {
      console.log('Missing one or more required teachers. Skipping seeding.');
      return;
    }

    // ── 6. Seed Class Teacher Assignment ──────────────────────────
    const [existingClassTeacher] = await queryInterface.sequelize.query(
      `SELECT id FROM teacher_assignments 
       WHERE session_id = :sessionId AND class_id = :classId AND section_id = :sectionId 
         AND is_class_teacher = true AND is_active = true LIMIT 1;`,
      {
        replacements: { sessionId, classId, sectionId },
        type: queryInterface.sequelize.QueryTypes.SELECT,
      }
    );

    if (!existingClassTeacher) {
      await queryInterface.bulkInsert('teacher_assignments', [{
        session_id: sessionId,
        teacher_id: priyaId,
        class_id: classId,
        section_id: sectionId,
        subject_id: null,
        is_class_teacher: true,
        is_active: true,
        created_at: now,
        updated_at: now,
      }]);

      await queryInterface.sequelize.query(
        `UPDATE sections SET class_teacher_id = :priyaId, updated_at = :now WHERE id = :sectionId;`,
        {
          replacements: { priyaId, now, sectionId },
        }
      );
      console.log('Seeded Priya Singh as Class Teacher for LKG A.');
    }

    // ── 7. Seed Subject Teacher Assignments ────────────────────────
    const assignmentsToSeed = [
      { teacherId: rajeshId, subjectId: englishOralId },
      { teacherId: rajeshId, subjectId: englishWritingId },
      { teacherId: priyaId, subjectId: mathsId },
      { teacherId: sunitaId, subjectId: rhymesId },
      { teacherId: vikramId, subjectId: drawingId },
    ];

    for (const assign of assignmentsToSeed) {
      const [existingAssign] = await queryInterface.sequelize.query(
        `SELECT id FROM teacher_assignments 
         WHERE session_id = :sessionId AND teacher_id = :teacherId AND class_id = :classId 
           AND section_id = :sectionId AND subject_id = :subjectId AND is_active = true LIMIT 1;`,
        {
          replacements: { sessionId, teacherId: assign.teacherId, classId, sectionId, subjectId: assign.subjectId },
          type: queryInterface.sequelize.QueryTypes.SELECT,
        }
      );

      if (!existingAssign) {
        await queryInterface.bulkInsert('teacher_assignments', [{
          session_id: sessionId,
          teacher_id: assign.teacherId,
          class_id: classId,
          section_id: sectionId,
          subject_id: assign.subjectId,
          is_class_teacher: false,
          is_active: true,
          created_at: now,
          updated_at: now,
        }]);
        console.log(`Seeded teacher assignment for teacher ID ${assign.teacherId} and subject ID ${assign.subjectId}.`);
      }
    }

    // ── 8. Seed Timetable Slots ───────────────────────────────────
    const timetableTemplate = [
      // Monday
      { day: 'monday', period: 1, startTime: '09:00:00', endTime: '09:45:00', subjectId: englishOralId, teacherId: rajeshId },
      { day: 'monday', period: 2, startTime: '09:45:00', endTime: '10:30:00', subjectId: mathsId, teacherId: priyaId },
      { day: 'monday', period: 3, startTime: '11:00:00', endTime: '11:45:00', subjectId: rhymesId, teacherId: sunitaId },
      { day: 'monday', period: 4, startTime: '11:45:00', endTime: '12:30:00', subjectId: drawingId, teacherId: vikramId },
      // Tuesday
      { day: 'tuesday', period: 1, startTime: '09:00:00', endTime: '09:45:00', subjectId: englishWritingId, teacherId: rajeshId },
      { day: 'tuesday', period: 2, startTime: '09:45:00', endTime: '10:30:00', subjectId: mathsId, teacherId: priyaId },
      { day: 'tuesday', period: 3, startTime: '11:00:00', endTime: '11:45:00', subjectId: englishOralId, teacherId: rajeshId },
      { day: 'tuesday', period: 4, startTime: '11:45:00', endTime: '12:30:00', subjectId: rhymesId, teacherId: sunitaId },
      // Wednesday
      { day: 'wednesday', period: 1, startTime: '09:00:00', endTime: '09:45:00', subjectId: englishOralId, teacherId: rajeshId },
      { day: 'wednesday', period: 2, startTime: '09:45:00', endTime: '10:30:00', subjectId: mathsId, teacherId: priyaId },
      { day: 'wednesday', period: 3, startTime: '11:00:00', endTime: '11:45:00', subjectId: rhymesId, teacherId: sunitaId },
      { day: 'wednesday', period: 4, startTime: '11:45:00', endTime: '12:30:00', subjectId: drawingId, teacherId: vikramId },
      // Thursday
      { day: 'thursday', period: 1, startTime: '09:00:00', endTime: '09:45:00', subjectId: englishWritingId, teacherId: rajeshId },
      { day: 'thursday', period: 2, startTime: '09:45:00', endTime: '10:30:00', subjectId: mathsId, teacherId: priyaId },
      { day: 'thursday', period: 3, startTime: '11:00:00', endTime: '11:45:00', subjectId: englishOralId, teacherId: rajeshId },
      { day: 'thursday', period: 4, startTime: '11:45:00', endTime: '12:30:00', subjectId: drawingId, teacherId: vikramId },
      // Friday
      { day: 'friday', period: 1, startTime: '09:00:00', endTime: '09:45:00', subjectId: englishWritingId, teacherId: rajeshId },
      { day: 'friday', period: 2, startTime: '09:45:00', endTime: '10:30:00', subjectId: mathsId, teacherId: priyaId },
      { day: 'friday', period: 3, startTime: '11:00:00', endTime: '11:45:00', subjectId: rhymesId, teacherId: sunitaId },
      { day: 'friday', period: 4, startTime: '11:45:00', endTime: '12:30:00', subjectId: drawingId, teacherId: vikramId },
    ];

    let seededCount = 0;
    for (const slot of timetableTemplate) {
      const [existingSlot] = await queryInterface.sequelize.query(
        `SELECT id FROM timetable_slots 
         WHERE session_id = :sessionId AND class_id = :classId AND section_id = :sectionId 
           AND day_of_week = :day AND period_number = :period AND is_active = true LIMIT 1;`,
        {
          replacements: { sessionId, classId, sectionId, day: slot.day, period: slot.period },
          type: queryInterface.sequelize.QueryTypes.SELECT,
        }
      );

      if (!existingSlot) {
        await queryInterface.bulkInsert('timetable_slots', [{
          session_id: sessionId,
          class_id: classId,
          section_id: sectionId,
          teacher_id: slot.teacherId,
          subject_id: slot.subjectId,
          day_of_week: slot.day,
          period_number: slot.period,
          start_time: slot.startTime,
          end_time: slot.endTime,
          room_number: 'LKG Room A',
          is_active: true,
          created_at: now,
          updated_at: now,
        }]);
        seededCount++;
      }
    }
    if (seededCount > 0) {
      console.log(`Seeded ${seededCount} timetable slots for LKG A.`);
    }
  },

  async down(queryInterface) {
    // ── 1. Fetch Class (LKG) ──────────────────────────────────────────────
    const [classes] = await queryInterface.sequelize.query(
      `SELECT id FROM classes WHERE name = 'LKG' LIMIT 1;`
    );
    if (classes.length === 0) return;
    const classId = classes[0].id;

    // ── 2. Clean Timetable Slots ──────────────────────────────────────────
    await queryInterface.bulkDelete('timetable_slots', { class_id: classId });
    console.log('Removed all timetable slots for LKG.');

    // ── 3. Reset Class Teacher in Sections ─────────────────────────────────
    const [sections] = await queryInterface.sequelize.query(
      `SELECT id FROM sections WHERE class_id = :classId;`,
      {
        replacements: { classId },
        type: queryInterface.sequelize.QueryTypes.SELECT,
      }
    );

    if (sections && sections.length > 0) {
      const sectionIds = sections.map((s) => typeof s === 'object' ? s.id : s);
      await queryInterface.sequelize.query(
        `UPDATE sections SET class_teacher_id = NULL WHERE id IN (:sectionIds);`,
        {
          replacements: { sectionIds },
        }
      );
    }

    // ── 4. Clean Teacher Assignments ──────────────────────────────────────
    await queryInterface.bulkDelete('teacher_assignments', { class_id: classId });
    console.log('Removed all teacher assignments for LKG.');
  },
};
