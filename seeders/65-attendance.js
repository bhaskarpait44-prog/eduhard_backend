'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const attendance = [];
    
    // Get all active enrollments
    const [enrollments] = await queryInterface.sequelize.query(
      `SELECT id FROM enrollments WHERE status = 'active' AND session_id = 1`
    );

    // Days in May 2026 to mark attendance (excluding Sundays: 3, 10, 17, 24, 31)
    const sundays = [3, 10, 17, 24, 31];
    const daysInMay = 31;

    enrollments.forEach(enr => {
      for (let day = 1; day <= daysInMay; day++) {
        if (sundays.includes(day)) continue; // Skip Sundays

        const date = `2026-05-${day.toString().padStart(2, '0')}`;
        // Randomly assign present/absent/late (90% present, 5% absent, 5% late)
        const rand = Math.random();
        let status = 'present';
        if (rand < 0.05) status = 'absent';
        else if (rand < 0.10) status = 'late';

        attendance.push({
          enrollment_id: enr.id,
          date: date,
          status: status,
          method: 'manual',
          marked_at: now,
          created_at: now,
          updated_at: now
        });
      }
    });

    // Chunking the insert to avoid potential memory issues with large arrays
    const chunkSize = 1000;
    for (let i = 0; i < attendance.length; i += chunkSize) {
      await queryInterface.bulkInsert('attendance', attendance.slice(i, i + chunkSize), { ignoreDuplicates: true });
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('attendance', null, {});
  }
};
