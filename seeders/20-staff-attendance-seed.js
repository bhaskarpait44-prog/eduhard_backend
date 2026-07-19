'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // 1. Retrieve default school, session, and admin user
    const [schools] = await queryInterface.sequelize.query(
      `SELECT id FROM schools LIMIT 1;`
    );
    if (schools.length === 0) {
      throw new Error('Please run school-and-admin seeder first!');
    }
    const schoolId = schools[0].id;

    const [sessions] = await queryInterface.sequelize.query(
      `SELECT id FROM sessions ORDER BY id DESC LIMIT 1;`
    );
    if (sessions.length === 0) {
      throw new Error('Please run academic sessions seeder first!');
    }
    const sessionId = sessions[0].id;

    const [admins] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1;`
    );
    const adminId = admins.length > 0 ? admins[0].id : null;

    // 2. Fetch all teachers and users
    const [teachers] = await queryInterface.sequelize.query(
      `SELECT id FROM teachers WHERE is_deleted = false AND is_active = true;`
    );
    const [users] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE school_id = :schoolId AND is_active = true;`,
      { replacements: { schoolId } }
    );

    // 3. Fetch all teacher approved leave dates
    const [leaves] = await queryInterface.sequelize.query(
      `SELECT teacher_id, from_date, to_date FROM teacher_leaves WHERE status = 'approved';`
    );

    // Create a map of teacher leaves: { [teacher_id]: Set of date strings }
    const teacherLeaveMap = {};
    for (const t of teachers) {
      teacherLeaveMap[t.id] = new Set();
    }
    for (const leave of leaves) {
      if (!teacherLeaveMap[leave.teacher_id]) continue;
      const start = new Date(leave.from_date);
      const end = new Date(leave.to_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        teacherLeaveMap[leave.teacher_id].add(dateStr);
      }
    }

    // 4. Fetch holidays to exclude
    const [holidaysRows] = await queryInterface.sequelize.query(
      `SELECT holiday_date FROM session_holidays WHERE session_id = :sessionId;`,
      { replacements: { sessionId } }
    );
    const holidaySet = new Set(holidaysRows.map(h => h.holiday_date));

    // 5. Clear existing staff attendance
    await queryInterface.sequelize.query(`DELETE FROM staff_attendance;`);

    // 6. Generate date sequence from April 1, 2026, to July 19, 2026
    const startDate = new Date('2026-04-01');
    const endDate = new Date('2026-07-19'); // today's date (from local time metadata)
    const dates = [];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay(); // 0 = Sunday
      const dateStr = d.toISOString().split('T')[0];
      
      if (dayOfWeek === 0) continue; // Skip Sunday
      if (holidaySet.has(dateStr)) continue; // Skip school holidays

      dates.push(dateStr);
    }

    console.log(`Generating staff attendance for ${dates.length} days across ${teachers.length} teachers and ${users.length} staff users...`);

    const attendanceRecords = [];

    for (const dateStr of dates) {
      // Teachers
      for (const teacher of teachers) {
        let status = 'present';
        let remarks = 'On Time';

        const hasLeave = teacherLeaveMap[teacher.id].has(dateStr);
        if (hasLeave) {
          status = 'leave';
          remarks = 'Approved Leave';
        } else {
          const rand = Math.random();
          if (rand < 0.95) {
            status = 'present';
            remarks = 'On Time';
          } else if (rand < 0.98) {
            status = 'late';
            remarks = 'Late by ' + Math.floor(5 + Math.random() * 25) + ' mins';
          } else if (rand < 0.99) {
            status = 'half_day';
            remarks = 'Personal emergency (half day)';
          } else {
            status = 'absent';
            remarks = 'Absent without prior notice';
          }
        }

        attendanceRecords.push({
          school_id: schoolId,
          teacher_id: teacher.id,
          user_id: null,
          date: dateStr,
          status: status,
          remarks: remarks,
          created_by: adminId,
          created_at: now,
          updated_at: now
        });
      }

      // Non-teacher staff users
      for (const u of users) {
        let status = 'present';
        let remarks = 'On Time';

        const rand = Math.random();
        if (rand < 0.96) {
          status = 'present';
          remarks = 'On Time';
        } else if (rand < 0.98) {
          status = 'late';
          remarks = 'Late by ' + Math.floor(5 + Math.random() * 20) + ' mins';
        } else if (rand < 0.99) {
          status = 'half_day';
          remarks = 'Half Day';
        } else {
          status = 'absent';
          remarks = 'Absent';
        }

        attendanceRecords.push({
          school_id: schoolId,
          teacher_id: null,
          user_id: u.id,
          date: dateStr,
          status: status,
          remarks: remarks,
          created_by: adminId,
          created_at: now,
          updated_at: now
        });
      }
    }

    if (attendanceRecords.length > 0) {
      const batchSize = 1000;
      for (let i = 0; i < attendanceRecords.length; i += batchSize) {
        const batch = attendanceRecords.slice(i, i + batchSize);
        await queryInterface.bulkInsert('staff_attendance', batch);
      }
    }

    console.log(`Successfully seeded ${attendanceRecords.length} staff attendance records!`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DELETE FROM staff_attendance;');
  }
};
