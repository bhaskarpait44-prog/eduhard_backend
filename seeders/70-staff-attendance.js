'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const schoolId = parseInt(process.env.SEED_SCHOOL_ID || '1', 10);

    // Start date: April 1st, 2026
    const startDate = new Date(2026, 3, 1);
    // End date: Yesterday (May 24th, 2026)
    const endDate = new Date(2026, 4, 24);

    // Fetch active users and teachers
    const [users] = await queryInterface.sequelize.query(`
      SELECT id FROM users WHERE school_id = :schoolId AND role IN ('admin', 'staff', 'librarian', 'receptionist', 'accountant') AND is_active = true AND is_deleted = false
    `, { replacements: { schoolId } });
    const [teachers] = await queryInterface.sequelize.query(`
      SELECT id FROM teachers WHERE school_id = :schoolId AND is_active = true AND is_deleted = false
    `, { replacements: { schoolId } });

    const [[admin]] = await queryInterface.sequelize.query(`
      SELECT id FROM users WHERE school_id = :schoolId AND role = 'admin' LIMIT 1
    `, { replacements: { schoolId } });
    const markerId = admin ? admin.id : null;

    const dates = [];
    let curr = new Date(startDate);
    while (curr <= endDate) {
      if (curr.getDay() !== 0) { // Skip Sundays
        dates.push(curr.toISOString().slice(0, 10));
      }
      curr = new Date(curr.setDate(curr.getDate() + 1));
    }

    console.log(`Generating staff attendance for ${users.length} users and ${teachers.length} teachers across ${dates.length} days...`);

    const statuses = ['present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'late', 'absent', 'half_day'];

    for (let dIdx = 0; dIdx < dates.length; dIdx++) {
      const date = dates[dIdx];
      const records = [];

      // Add user records
      users.forEach(u => {
        records.push({
          school_id: schoolId,
          user_id: u.id,
          teacher_id: null,
          date: date,
          status: statuses[Math.floor(Math.random() * statuses.length)],
          remarks: null,
          created_by: markerId,
          created_at: now,
          updated_at: now
        });
      });

      // Add teacher records
      teachers.forEach(t => {
        records.push({
          school_id: schoolId,
          user_id: null,
          teacher_id: t.id,
          date: date,
          status: statuses[Math.floor(Math.random() * statuses.length)],
          remarks: null,
          created_by: markerId,
          created_at: now,
          updated_at: now
        });
      });

      await queryInterface.bulkInsert('staff_attendance', records, { ignoreDuplicates: true });
      
      if ((dIdx + 1) % 10 === 0 || dIdx === dates.length - 1) {
        console.log(`Progress: Day ${dIdx + 1}/${dates.length} completed...`);
      }
    }

    console.log('Staff attendance seeding completed.');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('staff_attendance', null, {});
  }
};
