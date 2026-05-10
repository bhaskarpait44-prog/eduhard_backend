'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // 0. Ensure school exists and get its ID
    const [schools] = await queryInterface.sequelize.query(`SELECT id FROM schools LIMIT 1`);
    if (schools.length === 0) throw new Error('No school found. Please run school seeder first.');
    const schoolId = schools[0].id;

    // 1. Unset existing "current" sessions for this school to avoid unique index conflict
    // (idx_sessions_one_current_per_school)
    await queryInterface.sequelize.query(
      `UPDATE sessions SET is_current = false WHERE school_id = :schoolId AND is_current = true`,
      { replacements: { schoolId } }
    );

    // Create Session 2026-2027
    const [session] = await queryInterface.bulkInsert('sessions', [{
      school_id: schoolId,
      name: '2026-2027',
      start_date: '2026-04-01',
      end_date: '2027-03-31',
      status: 'active',
      is_current: true,
      created_at: new Date(),
      updated_at: new Date()
    }], { returning: true });

    const sessionId = session.id;

    // 2. Create Classes 11 and 12 for Arts, Commerce, Science
    const classesData = [];
    const streams = ['arts', 'commerce', 'science'];
    const classNames = ['11', '12'];

    let order = 1;
    classNames.forEach(name => {
      streams.forEach(stream => {
        classesData.push({
          school_id: schoolId,
          name: name,
          display_name: `Class ${name} (${stream.toUpperCase()})`,
          order_number: order++,
          stream: stream,
          is_active: true,
          is_deleted: false,
          created_at: new Date(),
          updated_at: new Date()
        });
      });
    });

    await queryInterface.bulkInsert('classes', classesData);
    const [allClasses] = await queryInterface.sequelize.query(`SELECT id, name, stream FROM classes WHERE school_id = :schoolId`, { replacements: { schoolId } });

    // 3. Create Sections (A for each stream and class)
    const sectionsData = allClasses.map(cls => ({
      class_id: cls.id,
      name: 'A',
      capacity: 50,
      is_active: true,
      is_deleted: false,
      created_at: new Date(),
      updated_at: new Date()
    }));
    await queryInterface.bulkInsert('sections', sectionsData);

    // 4. Create Subjects according to AHSEC (Assam)
    // Core: English, MIL (Assamese/Hindi/Alt. English)
    // Science: Physics, Chemistry, Biology, Maths
    // Commerce: Accountancy, Business Studies, Economics, CMST
    // Arts: Political Science, Sociology, History, Logic & Philosophy

    const subjectsData = [];
    const coreSubjects = [
      { name: 'English', code: 'ENG', type: 'theory', is_core: true, t_total: 100, t_pass: 30, c_total: 100, c_pass: 30 },
      { name: 'Assamese (MIL)', code: 'MIL-ASM', type: 'theory', is_core: true, t_total: 100, t_pass: 30, c_total: 100, c_pass: 30 },
      { name: 'Alternative English', code: 'ALT-ENG', type: 'theory', is_core: true, t_total: 100, t_pass: 30, c_total: 100, c_pass: 30 },
    ];

    const scienceElectives = [
      { name: 'Physics', code: 'PHY', type: 'both', is_core: false, t_total: 70, t_pass: 21, p_total: 30, p_pass: 9, c_total: 100, c_pass: 30 },
      { name: 'Chemistry', code: 'CHM', type: 'both', is_core: false, t_total: 70, t_pass: 21, p_total: 30, p_pass: 9, c_total: 100, c_pass: 30 },
      { name: 'Biology', code: 'BIO', type: 'both', is_core: false, t_total: 70, t_pass: 21, p_total: 30, p_pass: 9, c_total: 100, c_pass: 30 },
      { name: 'Mathematics', code: 'MTH', type: 'theory', is_core: false, t_total: 100, t_pass: 30, c_total: 100, c_pass: 30 },
    ];

    const commerceElectives = [
      { name: 'Accountancy', code: 'ACC', type: 'theory', is_core: false, t_total: 100, t_pass: 30, c_total: 100, c_pass: 30 },
      { name: 'Business Studies', code: 'BST', type: 'theory', is_core: false, t_total: 100, t_pass: 30, c_total: 100, c_pass: 30 },
      { name: 'Economics', code: 'ECO', type: 'theory', is_core: false, t_total: 100, t_pass: 30, c_total: 100, c_pass: 30 },
      { name: 'Commercial Mathematics & Statistics', code: 'CMST', type: 'theory', is_core: false, t_total: 100, t_pass: 30, c_total: 100, c_pass: 30 },
    ];

    const artsElectives = [
      { name: 'Political Science', code: 'PSC', type: 'theory', is_core: false, t_total: 100, t_pass: 30, c_total: 100, c_pass: 30 },
      { name: 'Sociology', code: 'SOC', type: 'theory', is_core: false, t_total: 100, t_pass: 30, c_total: 100, c_pass: 30 },
      { name: 'History', code: 'HIS', type: 'theory', is_core: false, t_total: 100, t_pass: 30, c_total: 100, c_pass: 30 },
      { name: 'Logic & Philosophy', code: 'LPH', type: 'theory', is_core: false, t_total: 100, t_pass: 30, c_total: 100, c_pass: 30 },
    ];

    allClasses.forEach(cls => {
      // Add Core
      coreSubjects.forEach(s => {
        subjectsData.push({
          class_id: cls.id,
          name: s.name,
          code: `${s.code}-${cls.name}`,
          subject_type: s.type,
          is_core: s.is_core,
          theory_total_marks: s.t_total,
          theory_passing_marks: s.t_pass,
          combined_total_marks: s.c_total,
          combined_passing_marks: s.c_pass,
          created_at: new Date(),
          updated_at: new Date()
        });
      });

      // Add Stream Electives
      let electives = [];
      if (cls.stream === 'science') electives = scienceElectives;
      else if (cls.stream === 'commerce') electives = commerceElectives;
      else if (cls.stream === 'arts') electives = artsElectives;

      electives.forEach(s => {
        subjectsData.push({
          class_id: cls.id,
          name: s.name,
          code: `${s.code}-${cls.name}`,
          subject_type: s.type,
          is_core: s.is_core,
          theory_total_marks: s.t_total,
          theory_passing_marks: s.t_pass,
          practical_total_marks: s.p_total || null,
          practical_passing_marks: s.p_pass || null,
          combined_total_marks: s.c_total,
          combined_passing_marks: s.c_pass,
          created_at: new Date(),
          updated_at: new Date()
        });
      });
    });

    await queryInterface.bulkInsert('subjects', subjectsData);

    // 5. Create Teachers
    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash('password123', 10);

    const teachersData = [
      { school_id: 1, first_name: 'Amit', last_name: 'Sarma', email: 'amit.science@educore.com', password_hash: passwordHash, department: 'Science', designation: 'PGT Physics', created_at: new Date(), updated_at: new Date() },
      { school_id: 1, first_name: 'Priya', last_name: 'Barua', email: 'priya.arts@educore.com', password_hash: passwordHash, department: 'Arts', designation: 'PGT Political Science', created_at: new Date(), updated_at: new Date() },
      { school_id: 1, first_name: 'Rajesh', last_name: 'Deka', email: 'rajesh.comm@educore.com', password_hash: passwordHash, department: 'Commerce', designation: 'PGT Accountancy', created_at: new Date(), updated_at: new Date() },
      { school_id: 1, first_name: 'Nitumoni', last_name: 'Borah', email: 'nitumoni.eng@educore.com', password_hash: passwordHash, department: 'English', designation: 'PGT English', created_at: new Date(), updated_at: new Date() }
    ];

    await queryInterface.bulkInsert('teachers', teachersData);

    // 6. Add Working Days (Mon-Sat)
    await queryInterface.bulkInsert('session_working_days', [{
      session_id: sessionId,
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: true,
      sunday: false
    }]);

    // 7. Add National Holidays
    const holidays = [
      { session_id: sessionId, holiday_date: '2026-04-14', name: 'Ambedkar Jayanti', type: 'national', created_at: new Date() },
      { session_id: sessionId, holiday_date: '2026-05-01', name: 'May Day', type: 'national', created_at: new Date() },
      { session_id: sessionId, holiday_date: '2026-08-15', name: 'Independence Day', type: 'national', created_at: new Date() },
      { session_id: sessionId, holiday_date: '2026-10-02', name: 'Gandhi Jayanti', type: 'national', created_at: new Date() },
      { session_id: sessionId, holiday_date: '2026-12-25', name: 'Christmas Day', type: 'national', created_at: new Date() },
      { session_id: sessionId, holiday_date: '2027-01-26', name: 'Republic Day', type: 'national', created_at: new Date() }
    ];
    await queryInterface.bulkInsert('session_holidays', holidays);
  },

  down: async (queryInterface, Sequelize) => {
    // Clean up logic
    await queryInterface.bulkDelete('session_holidays', null, {});
    await queryInterface.bulkDelete('session_working_days', null, {});
    await queryInterface.bulkDelete('subjects', null, {});
    await queryInterface.bulkDelete('sections', null, {});
    await queryInterface.bulkDelete('classes', null, {});
    await queryInterface.bulkDelete('sessions', null, {});
    await queryInterface.bulkDelete('teachers', { email: { [Sequelize.Op.like]: '%@educore.com' } }, {});
  }
};
