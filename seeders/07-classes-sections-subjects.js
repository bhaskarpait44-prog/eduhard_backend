'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // Retrieve default school
    const [schools] = await queryInterface.sequelize.query(
      `SELECT id FROM schools LIMIT 1;`
    );
    if (schools.length === 0) {
      throw new Error('Please run school-and-admin seeder first!');
    }
    const schoolId = schools[0].id;

    // Define all classes to be created
    const classDefs = [
      { name: 'LKG', stream: 'regular', min_age: 3, max_age: 5, order: 1, type: 'kg' },
      { name: 'UKG', stream: 'regular', min_age: 4, max_age: 6, order: 2, type: 'kg' },
      { name: 'Class 1', stream: 'regular', min_age: 5, max_age: 7, order: 3, type: 'primary' },
      { name: 'Class 2', stream: 'regular', min_age: 6, max_age: 8, order: 4, type: 'primary' },
      { name: 'Class 3', stream: 'regular', min_age: 7, max_age: 9, order: 5, type: 'primary' },
      { name: 'Class 4', stream: 'regular', min_age: 8, max_age: 10, order: 6, type: 'primary' },
      { name: 'Class 5', stream: 'regular', min_age: 9, max_age: 11, order: 7, type: 'primary' },
      { name: 'Class 6', stream: 'regular', min_age: 10, max_age: 12, order: 8, type: 'middle' },
      { name: 'Class 7', stream: 'regular', min_age: 11, max_age: 13, order: 9, type: 'middle' },
      { name: 'Class 8', stream: 'regular', min_age: 12, max_age: 14, order: 10, type: 'middle' },
      { name: 'Class 9', stream: 'regular', min_age: 13, max_age: 15, order: 11, type: 'high' },
      { name: 'Class 10', stream: 'regular', min_age: 14, max_age: 16, order: 12, type: 'high' },
      
      // Class 11
      { name: 'Class 11', stream: 'arts', min_age: 15, max_age: 17, order: 13, type: 'arts' },
      { name: 'Class 11', stream: 'science', min_age: 15, max_age: 17, order: 14, type: 'science' },
      { name: 'Class 11', stream: 'commerce', min_age: 15, max_age: 17, order: 15, type: 'commerce' },

      // Class 12
      { name: 'Class 12', stream: 'arts', min_age: 16, max_age: 18, order: 16, type: 'arts' },
      { name: 'Class 12', stream: 'science', min_age: 16, max_age: 18, order: 17, type: 'science' },
      { name: 'Class 12', stream: 'commerce', min_age: 16, max_age: 18, order: 18, type: 'commerce' },
    ];

    // Subjects list based on type
    const subjectsByType = {
      kg: [
        { name: 'English', code: 'ENG-KG', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'Mathematics', code: 'MATH-KG', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'Rhymes', code: 'RHY-KG', type: 'theory', core: true, total: 50, pass: 20, theory: 50, theory_pass: 20 },
        { name: 'Drawing', code: 'DRAW-KG', type: 'theory', core: true, total: 50, pass: 20, theory: 50, theory_pass: 20 },
      ],
      primary: [
        { name: 'English', code: 'ENG-PRI', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'Mathematics', code: 'MATH-PRI', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'Science', code: 'SCI-PRI', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'Social Studies', code: 'SST-PRI', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'Hindi', code: 'HIN-PRI', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
      ],
      middle: [
        { name: 'English', code: 'ENG-MID', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'Mathematics', code: 'MATH-MID', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'General Science', code: 'SCI-MID', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'Social Science', code: 'SST-MID', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'Hindi', code: 'HIN-MID', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'Computer Science', code: 'COMP-MID', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
      ],
      high: [
        { name: 'English', code: 'ENG-SEC', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'General Mathematics', code: 'MATH-SEC', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'General Science', code: 'SCI-SEC', type: 'both', core: true, total: 100, pass: 40, theory: 70, theory_pass: 28, practical: 30, practical_pass: 12 },
        { name: 'Social Science', code: 'SST-SEC', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'Advanced Mathematics', code: 'AMATH-SEC', type: 'theory', core: false, total: 100, pass: 40, theory: 100, theory_pass: 40 },
        { name: 'Assamese', code: 'ASM-SEC', type: 'theory', core: true, total: 100, pass: 40, theory: 100, theory_pass: 40 },
      ],
      science: [
        { name: 'English', code: 'ENG-HS', type: 'theory', core: true, total: 100, pass: 30, theory: 100, theory_pass: 30 },
        { name: 'Physics', code: 'PHYS-HS', type: 'both', core: true, total: 100, pass: 30, theory: 70, theory_pass: 21, practical: 30, practical_pass: 9 },
        { name: 'Chemistry', code: 'CHEM-HS', type: 'both', core: true, total: 100, pass: 30, theory: 70, theory_pass: 21, practical: 30, practical_pass: 9 },
        { name: 'Mathematics', code: 'MATH-HS', type: 'theory', core: true, total: 100, pass: 30, theory: 100, theory_pass: 30 },
        { name: 'Biology', code: 'BIOL-HS', type: 'both', core: false, total: 100, pass: 30, theory: 70, theory_pass: 21, practical: 30, practical_pass: 9 },
        { name: 'Computer Science', code: 'COSC-HS', type: 'both', core: false, total: 100, pass: 30, theory: 70, theory_pass: 21, practical: 30, practical_pass: 9 },
      ],
      commerce: [
        { name: 'English', code: 'ENG-HS', type: 'theory', core: true, total: 100, pass: 30, theory: 100, theory_pass: 30 },
        { name: 'Accountancy', code: 'ACCT-HS', type: 'theory', core: true, total: 100, pass: 30, theory: 100, theory_pass: 30 },
        { name: 'Business Studies', code: 'BSTD-HS', type: 'theory', core: true, total: 100, pass: 30, theory: 100, theory_pass: 30 },
        { name: 'Economics', code: 'ECON-HS', type: 'theory', core: true, total: 100, pass: 30, theory: 100, theory_pass: 30 },
        { name: 'Entrepreneurship', code: 'ENTR-HS', type: 'theory', core: false, total: 100, pass: 30, theory: 100, theory_pass: 30 },
      ],
      arts: [
        { name: 'English', code: 'ENG-HS', type: 'theory', core: true, total: 100, pass: 30, theory: 100, theory_pass: 30 },
        { name: 'Political Science', code: 'POLS-HS', type: 'theory', core: true, total: 100, pass: 30, theory: 100, theory_pass: 30 },
        { name: 'History', code: 'HIST-HS', type: 'theory', core: true, total: 100, pass: 30, theory: 100, theory_pass: 30 },
        { name: 'Sociology', code: 'SOC-HS', type: 'theory', core: true, total: 100, pass: 30, theory: 100, theory_pass: 30 },
        { name: 'Geography', code: 'GEOG-HS', type: 'both', core: false, total: 100, pass: 30, theory: 70, theory_pass: 21, practical: 30, practical_pass: 9 },
        { name: 'Education', code: 'EDUC-HS', type: 'theory', core: false, total: 100, pass: 30, theory: 100, theory_pass: 30 },
      ],
    };

    for (const def of classDefs) {
      // Build display_name
      const suffix = def.stream !== 'regular'
        ? ` (${def.stream.charAt(0).toUpperCase() + def.stream.slice(1)})`
        : '';
      const displayName = `${def.name}${suffix}`;

      // Check if class already exists
      const [existingClass] = await queryInterface.sequelize.query(
        `SELECT id FROM classes WHERE name = :name AND stream = :stream AND school_id = :schoolId LIMIT 1;`,
        { replacements: { name: def.name, stream: def.stream, schoolId } }
      );

      let classId;
      if (existingClass.length > 0) {
        classId = existingClass[0].id;
        // Update it if needed
        await queryInterface.sequelize.query(
          `UPDATE classes SET display_name = :displayName, order_number = :order, min_age = :minAge, max_age = :maxAge, is_deleted = false, updated_at = :now WHERE id = :classId;`,
          { replacements: { displayName, order: def.order, minAge: def.min_age, maxAge: def.max_age, now, classId } }
        );
      } else {
        // Insert new class
        await queryInterface.bulkInsert('classes', [{
          school_id: schoolId,
          name: def.name,
          display_name: displayName,
          order_number: def.order,
          stream: def.stream,
          min_age: def.min_age,
          max_age: def.max_age,
          is_active: true,
          created_at: now,
          updated_at: now,
        }]);

        const [newClass] = await queryInterface.sequelize.query(
          `SELECT id FROM classes WHERE name = :name AND stream = :stream AND school_id = :schoolId ORDER BY id DESC LIMIT 1;`,
          { replacements: { name: def.name, stream: def.stream, schoolId } }
        );
        classId = newClass[0].id;
      }

      // Check/Insert sections A and B
      const sectionNames = ['A', 'B'];
      for (const sName of sectionNames) {
        const [existingSec] = await queryInterface.sequelize.query(
          `SELECT id FROM sections WHERE class_id = :classId AND name = :name LIMIT 1;`,
          { replacements: { classId, name: sName } }
        );
        if (existingSec.length > 0) {
          // Reactivate section if deleted
          await queryInterface.sequelize.query(
            `UPDATE sections SET is_deleted = false, is_active = true, updated_at = :now WHERE id = :secId;`,
            { replacements: { now, secId: existingSec[0].id } }
          );
        } else {
          await queryInterface.bulkInsert('sections', [{
            class_id: classId,
            name: sName,
            capacity: 40,
            is_active: true,
            created_at: now,
            updated_at: now,
          }]);
        }
      }

      // Check/Insert subjects
      const subjects = subjectsByType[def.type] || [];
      let order = 1;
      for (const sub of subjects) {
        const generatedCode = `${sub.code}-${def.name.replace(/\s+/g, '').toUpperCase()}${def.stream !== 'regular' ? `-${def.stream.toUpperCase()}` : ''}`;
        
        const [existingSub] = await queryInterface.sequelize.query(
          `SELECT id FROM subjects WHERE class_id = :classId AND (code = :code OR name = :name) LIMIT 1;`,
          { replacements: { classId, code: generatedCode, name: sub.name } }
        );

        if (existingSub.length > 0) {
          await queryInterface.sequelize.query(
            `UPDATE subjects SET 
              name = :name,
              code = :code,
              subject_type = :type,
              is_core = :core,
              theory_total_marks = :theory,
              theory_passing_marks = :theory_pass,
              practical_total_marks = :practical,
              practical_passing_marks = :practical_pass,
              combined_total_marks = :total,
              combined_passing_marks = :pass,
              order_number = :order,
              is_deleted = false,
              updated_at = :now
             WHERE id = :subId;`,
            {
              replacements: {
                name: sub.name,
                code: generatedCode,
                type: sub.type,
                core: sub.core,
                theory: sub.theory || null,
                theory_pass: sub.theory_pass || null,
                practical: sub.practical || null,
                practical_pass: sub.practical_pass || null,
                total: sub.total,
                pass: sub.pass,
                order: order++,
                now,
                subId: existingSub[0].id
              }
            }
          );
        } else {
          await queryInterface.bulkInsert('subjects', [{
            class_id: classId,
            name: sub.name,
            code: generatedCode,
            subject_type: sub.type,
            is_core: sub.core,
            theory_total_marks: sub.theory || null,
            theory_passing_marks: sub.theory_pass || null,
            practical_total_marks: sub.practical || null,
            practical_passing_marks: sub.practical_pass || null,
            combined_total_marks: sub.total,
            combined_passing_marks: sub.pass,
            order_number: order++,
            is_active: true,
            created_at: now,
            updated_at: now,
          }]);
        }
      }
    }

    console.log('Seeded/Updated all classes, sections, and subjects successfully!');
  },

  async down(queryInterface) {
    // Non-destructive rollback.
  }
};
