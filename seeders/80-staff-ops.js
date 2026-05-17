'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    
    // 1. Staff Attendance (for Admin User 1 for May 2026)
    const adminAttendance = [];
    const sundays = [3, 10, 17, 24, 31];
    const daysInMay = 31;

    for (let day = 1; day <= daysInMay; day++) {
      if (sundays.includes(day)) continue;
      
      const date = `2026-05-${day.toString().padStart(2, '0')}`;
      adminAttendance.push({
        school_id: 1,
        user_id: 1,
        date: date,
        status: 'present',
        remarks: 'Daily attendance',
        created_at: now,
        updated_at: now
      });
    }
    
    await queryInterface.bulkInsert('staff_attendance', adminAttendance, { ignoreDuplicates: true });

    // 2. Feedback
    await queryInterface.bulkInsert('feedback', [
      {
        school_id: 1,
        user_id: 1,
        type: 'feedback',
        subject: 'Library Books',
        message: 'We need more copies of competitive exam books in the library.',
        status: 'open',
        created_at: now,
        updated_at: now
      },
      {
        school_id: 1,
        user_id: 1,
        type: 'complaint',
        subject: 'Canteen Hygiene',
        message: 'Requesting a regular inspection of the school canteen.',
        status: 'in-progress',
        created_at: now,
        updated_at: now
      }
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('feedback', null, {});
    await queryInterface.bulkDelete('staff_attendance', null, {});
  }
};
