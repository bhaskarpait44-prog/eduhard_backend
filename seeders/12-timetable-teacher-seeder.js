'use strict';

const bcrypt = require('bcryptjs');

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const hash = await bcrypt.hash('Teacher@1234', 12);

    // 1. Retrieve default school and session
    const [schools] = await queryInterface.sequelize.query(
      `SELECT id FROM schools LIMIT 1;`
    );
    if (schools.length === 0) {
      throw new Error('Please run school-and-admin seeder first!');
    }
    const schoolId = schools[0].id;

    const [sessions] = await queryInterface.sequelize.query(
      `SELECT id FROM sessions ORDER BY id DESC LIMIT 1;`
    );
    if (sessions.length === 0) {
      throw new Error('Please run academic sessions seeder first!');
    }
    const sessionId = sessions[0].id;

    // 2. Clean slate for teachers, assignments and timetables
    await queryInterface.sequelize.query('DELETE FROM timetable_slots;');
    await queryInterface.sequelize.query('DELETE FROM teacher_assignments;');
    await queryInterface.sequelize.query('DELETE FROM salary_structures;');
    await queryInterface.sequelize.query('DELETE FROM payrolls;');
    await queryInterface.sequelize.query('UPDATE sections SET class_teacher_id = NULL;');
    await queryInterface.sequelize.query('DELETE FROM teachers;');

    // 3. Fetch all classes and their sections and subjects
    const [classes] = await queryInterface.sequelize.query(
      `SELECT id, name, stream FROM classes WHERE school_id = :schoolId AND is_deleted = false ORDER BY order_number ASC;`,
      { replacements: { schoolId } }
    );

    const firstNames = [
      'Vikram', 'Rajesh', 'Sanjay', 'Amit', 'Anil', 'Sunil', 'Vijay', 'Deepak', 'Suresh', 'Ramesh',
      'Neelam', 'Sunita', 'Anita', 'Kiran', 'Preeti', 'Swati', 'Asha', 'Lata', 'Usha', 'Gita',
      'Arpita', 'Madhuri', 'Priyanka', 'Neha', 'Shweta', 'Rashmi', 'Kavita', 'Anjali', 'Meenakshi', 'Ritu',
      'Manish', 'Saurabh', 'Alok', 'Raman', 'Abhay', 'Tarun', 'Naveen', 'Sameer', 'Pankaj', 'Jitendra'
    ];

    const lastNames = [
      'Sharma', 'Verma', 'Gupta', 'Das', 'Roy', 'Sen', 'Banerjee', 'Borah', 'Saikia', 'Gogoi',
      'Choudhury', 'Talukdar', 'Kalita', 'Pathak', 'Goswami', 'Bhuyan', 'Deka', 'Nath', 'Sarma', 'Barman'
    ];

    const departments = ['Primary Education', 'Mathematics', 'Science', 'Social Sciences', 'Languages', 'Commerce', 'Arts', 'Computer Science'];
    const designations = ['Assistant Teacher', 'Senior Teacher', 'PGT Teacher', 'TGT Teacher', 'Head Teacher'];

    let teacherCounter = 1;

    console.log(`Starting to seed teachers, assignments, and timetables...`);

    for (const cls of classes) {
      const [sections] = await queryInterface.sequelize.query(
        `SELECT id, name FROM sections WHERE class_id = :classId AND is_deleted = false ORDER BY name ASC;`,
        { replacements: { classId: cls.id } }
      );

      const [subjects] = await queryInterface.sequelize.query(
        `SELECT id, name FROM subjects WHERE class_id = :classId AND is_deleted = false ORDER BY order_number ASC;`,
        { replacements: { classId: cls.id } }
      );

      if (sections.length === 0 || subjects.length === 0) continue;

      for (const sec of sections) {
        // Create a dedicated teacher for this section
        const fName = firstNames[(teacherCounter - 1) % firstNames.length];
        const lName = lastNames[(teacherCounter - 1) % lastNames.length];
        const email = `${fName.toLowerCase()}.${lName.toLowerCase()}.${teacherCounter}@greenwoodacademy.edu.in`;
        const employeeId = `TCH${1000 + teacherCounter}`;

        await queryInterface.bulkInsert('teachers', [{
          school_id: schoolId,
          first_name: fName,
          last_name: lName,
          email: email,
          password_hash: hash,
          phone: '9864' + Math.floor(100000 + Math.random() * 900000),
          employee_id: employeeId,
          department: cls.name.includes('Class 11') || cls.name.includes('Class 12') ? cls.stream.toUpperCase() : randomItem(departments),
          designation: randomItem(designations),
          joining_date: '2023-06-01',
          highest_qualification: 'Master of Education (M.Ed.)',
          specialization: cls.stream !== 'regular' ? cls.stream : 'General Education',
          university_name: 'Gauhati University',
          graduation_year: 2018,
          years_of_experience: 5.5,
          is_active: true,
          force_password_change: false,
          created_at: now,
          updated_at: now
        }]);

        const [tRow] = await queryInterface.sequelize.query(
          `SELECT id FROM teachers WHERE school_id = :schoolId AND email = :email LIMIT 1;`,
          { replacements: { schoolId, email } }
        );
        const teacherId = tRow[0].id;
        teacherCounter++;

        // Set this teacher as the Class Teacher for this section
        await queryInterface.sequelize.query(
          `UPDATE sections SET class_teacher_id = :teacherId WHERE id = :sectionId;`,
          { replacements: { teacherId, sectionId: sec.id } }
        );

        // ── 3a. Seed Teacher Assignments ─────────────────────────────────────
        // 1. Class Teacher Assignment
        await queryInterface.bulkInsert('teacher_assignments', [{
          session_id: sessionId,
          teacher_id: teacherId,
          class_id: cls.id,
          section_id: sec.id,
          subject_id: null,
          is_class_teacher: true,
          is_active: true,
          created_at: now,
          updated_at: now
        }]);

        // 2. Subject Teacher Assignments
        for (const sub of subjects) {
          await queryInterface.bulkInsert('teacher_assignments', [{
            session_id: sessionId,
            teacher_id: teacherId,
            class_id: cls.id,
            section_id: sec.id,
            subject_id: sub.id,
            is_class_teacher: false,
            is_active: true,
            created_at: now,
            updated_at: now
          }]);
        }

        // ── 3b. Seed Timetable Slots (8:30 AM to 1:30 PM) ────────────────────
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const periods = [
          { number: 1, start: '08:30:00', end: '09:30:00' },
          { number: 2, start: '09:30:00', end: '10:30:00' },
          { number: 3, start: '10:30:00', end: '11:30:00' },
          { number: 4, start: '11:30:00', end: '12:30:00' },
          { number: 5, start: '12:30:00', end: '13:30:00' }
        ];

        // Fill timetable slots: rotation of subjects for Monday-Saturday
        let subjectIndex = 0;
        for (const day of days) {
          for (const period of periods) {
            const currentSubject = subjects[subjectIndex % subjects.length];
            await queryInterface.bulkInsert('timetable_slots', [{
              session_id: sessionId,
              class_id: cls.id,
              section_id: sec.id,
              teacher_id: teacherId,
              subject_id: currentSubject.id,
              day_of_week: day,
              period_number: period.number,
              start_time: period.start,
              end_time: period.end,
              room_number: `${cls.name.replace(/\s+/g, '')}-${sec.name}`,
              is_active: true,
              created_at: now,
              updated_at: now
            }]);
            subjectIndex++;
          }
        }
      }
    }

    console.log('Seeded teachers, assignments, and timetables successfully!');

    function randomItem(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DELETE FROM timetable_slots;');
    await queryInterface.sequelize.query('DELETE FROM teacher_assignments;');
    await queryInterface.sequelize.query('UPDATE sections SET class_teacher_id = NULL;');
    await queryInterface.sequelize.query('DELETE FROM teachers;');
  }
};
