'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // 1. Fetch all active enrollments
    const [enrollments] = await queryInterface.sequelize.query(
      `SELECT id FROM enrollments WHERE status = 'active';`
    );

    if (enrollments.length === 0) {
      throw new Error('Please run the student seeder first to populate enrollments.');
    }

    console.log(`Clearing existing attendance records...`);
    await queryInterface.sequelize.query(`DELETE FROM attendance;`);

    // 2. Generate dates from April 1, 2026 to today
    const startDate = new Date('2026-04-01');
    const endDate = new Date(); // Today
    const dates = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay();
      if (dayOfWeek !== 0) { // Skip Sundays
        dates.push(d.toISOString().split('T')[0]);
      }
    }

    console.log(`Generating attendance for ${enrollments.length} students across ${dates.length} days...`);

    // 90% Present, 5% Absent, 3% Late, 2% Half Day distribution
    const statuses = [
      'present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'present',
      'present', 'present', 'present', 'present', 'present', 'present', 'present', 'present',
      'absent', 'late', 'half_day'
    ];
    
    let batch = [];
    let count = 0;
    const batchSize = 10000;

    for (const enroll of enrollments) {
      for (const date of dates) {
        const randStatus = statuses[Math.floor(Math.random() * statuses.length)];
        batch.push({
          enrollment_id: enroll.id,
          date: date,
          status: randStatus,
          method: 'manual',
          marked_by: null,
          marked_at: now,
          created_at: now,
          updated_at: now
        });

        if (batch.length >= batchSize) {
          await queryInterface.bulkInsert('attendance', batch);
          count += batch.length;
          console.log(`Seeded ${count} attendance records...`);
          batch = [];
        }
      }
    }

    if (batch.length > 0) {
      await queryInterface.bulkInsert('attendance', batch);
      count += batch.length;
      console.log(`Seeded final batch. Total seeded: ${count} attendance records.`);
    }

    console.log('Successfully completed seeding student attendance!');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DELETE FROM attendance;`);
  }
};
