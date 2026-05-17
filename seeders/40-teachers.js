'use strict';

const bcrypt = require('bcryptjs');

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const passwordHash = await bcrypt.hash('Teacher@1234', 12);
    
    // 7 Teachers for core subjects
    const teacherData = [
      { id: 1, first: 'Arun', last: 'Sharma', dept: 'Mathematics', subject: 'Mathematics' },
      { id: 2, first: 'Priya', last: 'Das', dept: 'Science', subject: 'Science' }, // Also covers Chemistry for 11/12
      { id: 3, first: 'Rajesh', last: 'Kumar', dept: 'English', subject: 'English' },
      { id: 4, first: 'Sunita', last: 'Barua', dept: 'Social Science', subject: 'Social Science' },
      { id: 5, first: 'Vikram', last: 'Singh', dept: 'Physics', subject: 'Physics' },
      { id: 6, first: 'Anita', last: 'Sarma', dept: 'Biology', subject: 'Biology' },
      { id: 7, first: 'Deepak', last: 'Kalita', dept: 'Hindi', subject: 'Hindi' }
    ];

    const teachers = teacherData.map((t) => ({
      id: t.id,
      school_id: 1,
      first_name: t.first,
      last_name: t.last,
      email: `${t.first.toLowerCase()}.${t.last.toLowerCase()}@greenwood.edu.in`,
      password_hash: passwordHash,
      phone: `987654321${t.id}`,
      employee_id: `TCH-2024-${t.id}`,
      department: t.dept,
      designation: 'Senior Teacher',
      is_active: true,
      created_at: now,
      updated_at: now
    }));

    await queryInterface.bulkInsert('teachers', teachers, { ignoreDuplicates: true });

    // --- Teacher Assignments ---
    // 1. Class Teachers (Teachers 1-4 for Classes 9-12)
    const classTeacherAssignments = [1, 2, 3, 4].map(id => ({
      teacher_id: id,
      session_id: 1,
      class_id: id,
      section_id: id,
      is_class_teacher: true,
      is_active: true,
      created_at: now,
      updated_at: now
    }));
    await queryInterface.bulkInsert('teacher_assignments', classTeacherAssignments, { ignoreDuplicates: true });

    // Update section class_teacher_id
    for (let i = 1; i <= 4; i++) {
      await queryInterface.sequelize.query(`UPDATE sections SET class_teacher_id = ${i} WHERE id = ${i}`);
    }

    // 2. Subject Teacher Assignments
    // We need to map which teacher teaches which subject in which class
    const [subjects] = await queryInterface.sequelize.query(`SELECT id, name, class_id FROM subjects`);
    const subjectAssignments = [];

    subjects.forEach(sub => {
      let teacherId = null;
      if (sub.name === 'Mathematics') teacherId = 1;
      else if (sub.name === 'Science' || sub.name === 'Chemistry') teacherId = 2;
      else if (sub.name === 'English') teacherId = 3;
      else if (sub.name === 'Social Science') teacherId = 4;
      else if (sub.name === 'Physics') teacherId = 5;
      else if (sub.name === 'Biology') teacherId = 6;
      else if (sub.name === 'Hindi') teacherId = 7;

      if (teacherId) {
        subjectAssignments.push({
          teacher_id: teacherId,
          session_id: 1,
          class_id: sub.class_id,
          section_id: sub.class_id, // Section A matches class ID in our setup
          subject_id: sub.id,
          is_class_teacher: false,
          is_active: true,
          created_at: now,
          updated_at: now
        });
      }
    });

    await queryInterface.bulkInsert('teacher_assignments', subjectAssignments, { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`UPDATE sections SET class_teacher_id = NULL`);
    await queryInterface.bulkDelete('teacher_assignments', null, {});
    await queryInterface.bulkDelete('teachers', null, {});
  }
};
