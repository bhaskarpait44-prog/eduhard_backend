'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const schoolId = 1;
    const sessionId = 1;

    // Start date: April 1st, 2026
    const startDate = new Date(2026, 3, 1);
    // End date: Yesterday (May 24th, 2026)
    const endDate = new Date(2026, 4, 24);

    // Fetch active enrollments
    const [enrollments] = await queryInterface.sequelize.query(`
      SELECT e.id, e.student_id 
      FROM enrollments e
      JOIN students s ON s.id = e.student_id
      WHERE e.session_id = ${sessionId} AND e.status = 'active' AND s.school_id = ${schoolId}
    `);

    if (enrollments.length === 0) {
      console.log('No active enrollments found. Skipping attendance seeding.');
      return;
    }

    // Fetch a staff user to be the "marker"
    const [[staff]] = await queryInterface.sequelize.query(`
      SELECT id FROM users WHERE school_id = ${schoolId} AND role = 'admin' LIMIT 1
    `);
    const markerId = staff ? staff.id : null;

    const dates = [];
    let curr = new Date(startDate);
    while (curr <= endDate) {
      // 0 is Sunday
      if (curr.getDay() !== 0) {
        dates.push(curr.toISOString().slice(0, 10));
      }
      curr = new Date(curr.setDate(curr.getDate() + 1));
    }

    console.log(`Generating attendance for ${enrollments.length} students across ${dates.length} days...`);

    const statuses = ['present', 'present', 'present', 'present', 'present', 'present', 'present', 'present', 'late', 'absent', 'half_day'];
    const totalBatches = dates.length;
    
    for (let dIdx = 0; dIdx < dates.length; dIdx++) {
      const date = dates[dIdx];
      const records = enrollments.map(e => {
        // Pseudo-random status weighted towards 'present'
        const status = statuses[Math.floor(Math.random() * statuses.length)];
        return {
          enrollment_id: e.id,
          date: date,
          status: status,
          method: 'auto',
          marked_by: markerId,
          marked_at: now,
          created_at: now,
          updated_at: now
        };
      });

      // Insert one day at a time to stay safe with memory and transaction size
      await queryInterface.bulkInsert('attendance', records, { ignoreDuplicates: true });
      
      if ((dIdx + 1) % 5 === 0 || dIdx === dates.length - 1) {
        console.log(`Progress: Day ${dIdx + 1}/${dates.length} completed...`);
      }
    }

    console.log('Attendance seeding completed.');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('attendance', null, {});
  }
};
