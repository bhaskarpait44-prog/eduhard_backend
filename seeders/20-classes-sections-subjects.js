'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const schoolId = 1;

    // 1. Define Classes
    const classesData = [
      { name: 'LKG', order_number: 1, stream: 'regular' },
      { name: 'UKG', order_number: 2, stream: 'regular' },
      { name: 'Class 1', order_number: 3, stream: 'regular' },
      { name: 'Class 2', order_number: 4, stream: 'regular' },
      { name: 'Class 3', order_number: 5, stream: 'regular' },
      { name: 'Class 4', order_number: 6, stream: 'regular' },
      { name: 'Class 5', order_number: 7, stream: 'regular' },
      { name: 'Class 6', order_number: 8, stream: 'regular' },
      { name: 'Class 7', order_number: 9, stream: 'regular' },
      { name: 'Class 8', order_number: 10, stream: 'regular' },
      { name: 'Class 9', order_number: 11, stream: 'regular' },
      { name: 'Class 10', order_number: 12, stream: 'regular' },
      // Class 11
      { name: 'Class 11', order_number: 13, stream: 'science' },
      { name: 'Class 11', order_number: 13, stream: 'commerce' },
      { name: 'Class 11', order_number: 13, stream: 'arts' },
      // Class 12
      { name: 'Class 12', order_number: 14, stream: 'science' },
      { name: 'Class 12', order_number: 14, stream: 'commerce' },
      { name: 'Class 12', order_number: 14, stream: 'arts' },
    ].map(c => ({
      ...c,
      school_id: schoolId,
      display_name: c.stream === 'regular' ? c.name : `${c.name} (${c.stream.charAt(0).toUpperCase() + c.stream.slice(1)})`,
      is_active: true,
      created_at: now,
      updated_at: now,
    }));

    await queryInterface.bulkInsert('classes', classesData, { ignoreDuplicates: true });

    // Fetch inserted classes to get IDs
    const [classes] = await queryInterface.sequelize.query(
      `SELECT id, name, stream FROM classes WHERE school_id = ${schoolId} AND is_deleted = false`
    );

    // 2. Define Sections (Only 'A' for all)
    const sectionsData = classes.map(c => ({
      class_id: c.id,
      name: 'A',
      capacity: 40,
      is_active: true,
      created_at: now,
      updated_at: now,
    }));

    await queryInterface.bulkInsert('sections', sectionsData, { ignoreDuplicates: true });

    // 3. Define Subjects
    const subjectsData = [];

    classes.forEach(c => {
      let subjects = [];
      if (c.name === 'LKG' || c.name === 'UKG') {
        subjects = [
          { name: 'English Oral', code: 'ENG-ORAL', type: 'theory' },
          { name: 'English Writing', code: 'ENG-WRIT', type: 'theory' },
          { name: 'Mathematics', code: 'MATH-PRE', type: 'theory' },
          { name: 'Rhymes', code: 'RHYMES', type: 'theory' },
          { name: 'Drawing', code: 'DRAW', type: 'theory' },
        ];
      } else if (parseInt(c.name.replace('Class ', '')) <= 10) {
        const level = c.name.replace('Class ', '');
        subjects = [
          { name: 'English', code: `ENG-${level}`, type: 'theory' },
          { name: 'Mathematics', code: `MATH-${level}`, type: 'theory' },
          { name: 'Science', code: `SCI-${level}`, type: level >= 6 ? 'both' : 'theory' },
          { name: 'Social Science', code: `SOC-${level}`, type: 'theory' },
          { name: 'Hindi', code: `HIN-${level}`, type: 'theory' },
          { name: 'Computer', code: `COMP-${level}`, type: 'both' },
        ];
      } else if (c.stream === 'science') {
        const level = c.name.replace('Class ', '');
        subjects = [
          { name: 'Physics', code: `PHY-${level}`, type: 'both', theory: 70, practical: 30 },
          { name: 'Chemistry', code: `CHEM-${level}`, type: 'both', theory: 70, practical: 30 },
          { name: 'Biology', code: `BIO-${level}`, type: 'both', theory: 70, practical: 30 },
          { name: 'Mathematics', code: `MATH-SCI-${level}`, type: 'theory' },
          { name: 'English', code: `ENG-SCI-${level}`, type: 'theory' },
          { name: 'Computer Science', code: `CS-${level}`, type: 'both', theory: 70, practical: 30 },
        ];
      } else if (c.stream === 'commerce') {
        const level = c.name.replace('Class ', '');
        subjects = [
          { name: 'Accountancy', code: `ACC-${level}`, type: 'both', theory: 80, practical: 20 },
          { name: 'Business Studies', code: `BST-${level}`, type: 'both', theory: 80, practical: 20 },
          { name: 'Economics', code: `ECO-${level}`, type: 'both', theory: 80, practical: 20 },
          { name: 'English', code: `ENG-COM-${level}`, type: 'theory' },
          { name: 'Mathematics', code: `MATH-COM-${level}`, type: 'theory' },
        ];
      } else if (c.stream === 'arts') {
        const level = c.name.replace('Class ', '');
        subjects = [
          { name: 'History', code: `HIST-${level}`, type: 'theory' },
          { name: 'Geography', code: `GEOG-${level}`, type: 'both', theory: 70, practical: 30 },
          { name: 'Political Science', code: `POLS-${level}`, type: 'theory' },
          { name: 'English', code: `ENG-ART-${level}`, type: 'theory' },
          { name: 'Sociology', code: `SOC-${level}`, type: 'theory' },
        ];
      }

      subjects.forEach((s, idx) => {
        subjectsData.push({
          class_id: c.id,
          name: s.name,
          code: s.code,
          subject_type: s.type,
          is_core: true,
          theory_total_marks: s.theory || (s.type === 'both' ? 80 : 100),
          theory_passing_marks: (s.theory || (s.type === 'both' ? 80 : 100)) * 0.33,
          practical_total_marks: s.practical || (s.type === 'both' ? 20 : null),
          practical_passing_marks: s.practical ? s.practical * 0.33 : (s.type === 'both' ? 6 : null),
          combined_total_marks: 100,
          combined_passing_marks: 33,
          order_number: idx + 1,
          is_active: true,
          created_at: now,
          updated_at: now,
        });
      });
    });

    await queryInterface.bulkInsert('subjects', subjectsData, { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    // Note: Deleting in reverse order to respect foreign keys
    await queryInterface.bulkDelete('subjects', null, {});
    await queryInterface.bulkDelete('sections', null, {});
    await queryInterface.bulkDelete('classes', null, {});
  }
};
