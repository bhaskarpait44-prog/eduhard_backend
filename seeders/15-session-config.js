'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const holidays = [];
    
    // Create Sundays for May 2026 as holidays
    // May 2026: 3, 10, 17, 24, 31 are Sundays
    [3, 10, 17, 24, 31].forEach(day => {
      holidays.push({
        session_id: 1,
        holiday_date: `2026-05-${day.toString().padStart(2, '0')}`,
        name: 'Sunday',
        type: 'school', // added mandatory type
        created_at: now
      });
    });

    await queryInterface.bulkInsert('session_holidays', holidays, { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('session_holidays', null, {});
  }
};
