'use strict';
const bcrypt = require('bcryptjs');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const schoolId = 1;
    const sessionId = 1;
    const now = new Date();
    const hash = await bcrypt.hash('Student@123', 12);

    const [classes] = await queryInterface.sequelize.query(
      `SELECT id, name, stream FROM classes WHERE school_id = ${schoolId} AND is_active = true AND is_deleted = false;`
    );

    let totalCreated = 0;

    for (const cls of classes) {
      const [sections] = await queryInterface.sequelize.query(
        `SELECT id, name FROM sections WHERE class_id = ${cls.id} AND is_active = true AND is_deleted = false;`
      );

      for (const sec of sections) {
        const [[{ count }]] = await queryInterface.sequelize.query(
          `SELECT COUNT(*)::int FROM enrollments WHERE class_id = ${cls.id} AND section_id = ${sec.id} AND session_id = ${sessionId};`
        );

        const studentsToCreate = 5 - count;
        if (studentsToCreate <= 0) continue;

        console.log(`Seeding ${studentsToCreate} students for ${cls.name} ${cls.stream || ''} Section ${sec.name}`);

        for (let i = 1; i <= studentsToCreate; i++) {
          const studentNum = count + i;
          const timestamp = Date.now().toString().slice(-4);
          const admNo = `ADM-${cls.id}-${sec.id}-${studentNum}-${timestamp}`;
          const lastName = `${cls.name.replace(' ', '')}${sec.name}${studentNum}`;
          
          // 1. Insert Student
          const [studentResult] = await queryInterface.sequelize.query(
            `INSERT INTO students (
              school_id, admission_no, first_name, last_name, 
              date_of_birth, gender, password_hash, is_active, 
              status, is_deleted, created_at, updated_at
            )
            VALUES (
              ${schoolId}, '${admNo}', 'Student', '${lastName}', 
              '2015-01-01', '${i % 2 === 0 ? 'female' : 'male'}', '${hash}', true, 
              'active', false, NOW(), NOW()
            )
            RETURNING id;`
          );
          const studentId = studentResult[0].id;

          // 2. Insert Profile
          await queryInterface.sequelize.query(
            `INSERT INTO student_profiles (
              student_id, email, is_current, valid_from, created_at
            )
            VALUES (
              ${studentId}, 'std.${admNo.toLowerCase()}@example.com', true, NOW(), NOW()
            );`
          );

          // 3. Insert Enrollment
          await queryInterface.sequelize.query(
            `INSERT INTO enrollments (
              student_id, session_id, class_id, section_id, 
              roll_number, stream, joined_date, joining_type, 
              status, created_at, updated_at
            )
            VALUES (
              ${studentId}, ${sessionId}, ${cls.id}, ${sec.id}, 
              '${studentNum}', '${cls.stream || 'regular'}', CURRENT_DATE, 'fresh', 
              'active', NOW(), NOW()
            );`
          );
          
          totalCreated++;
        }
      }
    }
    console.log(`Successfully seeded ${totalCreated} students.`);
  },

  async down(queryInterface) {
    // This is a one-way seed for this task
  }
};
