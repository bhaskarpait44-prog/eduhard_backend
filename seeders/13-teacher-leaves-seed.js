'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // 1. Retrieve default admin user ID
    const [admins] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1;`
    );
    if (admins.length === 0) {
      throw new Error('Please run school-and-admin seeder first!');
    }
    const adminId = admins[0].id;

    // 2. Fetch all teachers
    const [teachers] = await queryInterface.sequelize.query(
      `SELECT id FROM teachers WHERE is_deleted = false;`
    );
    if (teachers.length === 0) {
      throw new Error('Please run teachers seeder first!');
    }

    // 3. Clear existing teacher leaves
    await queryInterface.sequelize.query(`DELETE FROM teacher_leaves;`);

    // 4. Define leave dates for April, May, June, July
    const leaveSchedules = [
      // April
      { from: '2026-04-10', to: '2026-04-10', type: 'casual', reason: 'Personal work at home.' },
      { from: '2026-04-20', to: '2026-04-20', type: 'sick', reason: 'Fever and cold.' },
      // May
      { from: '2026-05-12', to: '2026-05-12', type: 'casual', reason: 'Attending family function.' },
      { from: '2026-05-22', to: '2026-05-22', type: 'sick', reason: 'Dental appointment.' },
      // June
      { from: '2026-06-08', to: '2026-06-08', type: 'casual', reason: 'Bank related documentation.' },
      { from: '2026-06-18', to: '2026-06-18', type: 'emergency', reason: 'Domestic emergency.' },
      // July
      { from: '2026-07-07', to: '2026-07-07', type: 'casual', reason: 'Out of town for urgent work.' },
      { from: '2026-07-15', to: '2026-07-15', type: 'sick', reason: 'Routine medical health checkup.' }
    ];

    console.log(`Generating approved leaves for ${teachers.length} teachers...`);

    const leavesToInsert = [];

    for (const teacher of teachers) {
      for (const sched of leaveSchedules) {
        leavesToInsert.push({
          teacher_id: teacher.id,
          leave_type: sched.type,
          from_date: sched.from,
          to_date: sched.to,
          days_count: 1.0,
          reason: sched.reason,
          document_path: null,
          status: 'approved',
          reviewed_by: adminId,
          review_note: 'Approved based on request and eligibility.',
          reviewed_at: now,
          created_at: now,
          updated_at: now
        });
      }
    }

    if (leavesToInsert.length > 0) {
      // Chunk bulk insert
      const batchSize = 1000;
      for (let i = 0; i < leavesToInsert.length; i += batchSize) {
        const batch = leavesToInsert.slice(i, i + batchSize);
        await queryInterface.bulkInsert('teacher_leaves', batch);
      }
    }

    console.log(`Successfully seeded ${leavesToInsert.length} approved teacher leaves!`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DELETE FROM teacher_leaves;`);
  }
};
