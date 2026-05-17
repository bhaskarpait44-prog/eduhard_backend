'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const commonSubjects = ['Mathematics', 'Science', 'Social Science', 'English', 'Hindi'];
    const scienceSubjects = ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'English'];

    const subjects = [];
    let idCounter = 1;

    // Class 9 & 10
    [1, 2].forEach(classId => {
      commonSubjects.forEach(name => {
        subjects.push({
          id: idCounter++,
          class_id: classId,
          name: name,
          code: `${name.substring(0, 3).toUpperCase()}-${classId === 1 ? '9' : '10'}`,
          subject_type: 'theory',
          theory_total_marks: 100,
          theory_passing_marks: 33,
          combined_total_marks: 100,
          combined_passing_marks: 33,
          is_active: true,
          created_at: now,
          updated_at: now
        });
      });
    });

    // Class 11 & 12
    [3, 4].forEach(classId => {
      scienceSubjects.forEach(name => {
        subjects.push({
          id: idCounter++,
          class_id: classId,
          name: name,
          code: `${name.substring(0, 3).toUpperCase()}-${classId === 3 ? '11' : '12'}`,
          subject_type: 'theory',
          theory_total_marks: 100,
          theory_passing_marks: 33,
          combined_total_marks: 100,
          combined_passing_marks: 33,
          is_active: true,
          created_at: now,
          updated_at: now
        });
      });
    });

    await queryInterface.bulkInsert('subjects', subjects, { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('subjects', null, {});
  }
};
