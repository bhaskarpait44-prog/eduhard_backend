'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    
    // 1. Timetable Slots (Fixed Teacher-Subject Mapping)
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    const slots = [];
    
    const [subjects] = await queryInterface.sequelize.query(`SELECT id, name, class_id FROM subjects`);
    
    // Helper to get teacher for a subject
    const getTeacherId = (subName) => {
      if (subName === 'Mathematics') return 1;
      if (subName === 'Science' || subName === 'Chemistry') return 2;
      if (subName === 'English') return 3;
      if (subName === 'Social Science') return 4;
      if (subName === 'Physics') return 5;
      if (subName === 'Biology') return 6;
      if (subName === 'Hindi') return 7;
      return 1;
    };

    for (let classId = 1; classId <= 4; classId++) {
      const classSubjects = subjects.filter(s => s.class_id === classId);
      
      for (const day of days) {
        // Assign first 4 subjects of the class to 4 periods
        for (let p = 1; p <= 4; p++) {
          const sub = classSubjects[(p - 1) % classSubjects.length];
          slots.push({
            session_id: 1,
            class_id: classId,
            section_id: classId,
            teacher_id: getTeacherId(sub.name),
            subject_id: sub.id,
            day_of_week: day,
            period_number: p,
            start_time: `${8 + p}:00:00`,
            end_time: `${9 + p}:00:00`,
            room_number: `Room ${classId === 1 ? '9' : classId === 2 ? '10' : classId === 3 ? '11' : '12'}A`,
            is_active: true,
            created_at: now,
            updated_at: now
          });
        }
      }
    }
    await queryInterface.bulkInsert('timetable_slots', slots, { ignoreDuplicates: true });

    // 2. Exams
    const exams = [];
    const examSubjects = [];
    let examIdCounter = 1;

    for (let classId = 1; classId <= 4; classId++) {
      const className = classId === 1 ? '9' : classId === 2 ? '10' : classId === 3 ? '11' : '12';
      exams.push({
        id: examIdCounter,
        session_id: 1,
        class_id: classId,
        name: `First Terminal Examination 2024 - Class ${className}`,
        exam_type: 'term',
        start_date: '2024-09-15',
        end_date: '2024-09-30',
        status: 'upcoming',
        total_marks: 500.00,
        passing_marks: 165.00,
        weightage: 50,
        created_at: now,
        updated_at: now
      });

      const classSubjects = subjects.filter(s => s.class_id === classId);

      classSubjects.forEach((sub, k) => {
        examSubjects.push({
          exam_id: examIdCounter,
          subject_id: sub.id,
          subject_type: 'theory',
          theory_total_marks: 100,
          theory_passing_marks: 33,
          combined_total_marks: 100,
          combined_passing_marks: 33,
          review_status: 'approved',
          created_at: now,
          updated_at: now
        });
      });
      examIdCounter++;
    }
    await queryInterface.bulkInsert('exams', exams, { ignoreDuplicates: true });
    await queryInterface.bulkInsert('exam_subjects', examSubjects, { ignoreDuplicates: true });

    // 3. Notices
    await queryInterface.bulkInsert('notices', [
      {
        school_id: 1,
        title: 'Welcome to Academic Year 2024-25',
        body: 'We are excited to welcome all students and teachers to the new academic session.',
        posted_by_role: 'admin',
        audience: 'school_wide',
        is_school_wide: true,
        priority: 'normal',
        created_at: now,
        updated_at: now
      },
      {
        school_id: 1,
        title: 'Science Fair 2024',
        body: 'A school-wide science fair will be held in November. Start preparing your projects!',
        posted_by_role: 'admin',
        audience: 'school_wide',
        is_school_wide: true,
        priority: 'info',
        created_at: now,
        updated_at: now
      }
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('notices', null, {});
    await queryInterface.bulkDelete('exam_subjects', null, {});
    await queryInterface.bulkDelete('exams', null, {});
    await queryInterface.bulkDelete('timetable_slots', null, {});
  }
};
