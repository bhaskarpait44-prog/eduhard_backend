'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // 1. Get the session(s) for '2026-2027'
    const [sessions] = await queryInterface.sequelize.query(
      `SELECT id, school_id FROM sessions WHERE name = '2026-2027';`
    );

    if (sessions.length === 0) {
      console.log('No sessions with name "2026-2027" found. Skipping seeding holidays.');
      return;
    }

    const holidaysTemplate = [
      { holiday_date: '2026-04-03', name: 'Good Friday', type: 'national' },
      { holiday_date: '2026-04-14', name: 'Ambedkar Jayanti', type: 'national' },
      { holiday_date: '2026-05-01', name: 'Buddha Purnima / May Day', type: 'regional' },
      { holiday_date: '2026-05-27', name: 'Id-ul-Zuha (Bakrid)', type: 'national' },
      { holiday_date: '2026-06-26', name: 'Muharram', type: 'national' },
      { holiday_date: '2026-08-15', name: 'Independence Day', type: 'national' },
      { holiday_date: '2026-08-26', name: 'Milad-un-Nabi (Id-e-Milad)', type: 'national' },
      { holiday_date: '2026-08-28', name: 'Raksha Bandhan', type: 'regional' },
      { holiday_date: '2026-09-04', name: 'Krishna Janmashtami', type: 'regional' },
      { holiday_date: '2026-09-14', name: 'Ganesh Chaturthi', type: 'regional' },
      { holiday_date: '2026-10-02', name: 'Mahatma Gandhi\'s Birthday', type: 'national' },
      { holiday_date: '2026-10-20', name: 'Dussehra (Vijayadashami)', type: 'national' },
      { holiday_date: '2026-11-08', name: 'Diwali (Deepavali)', type: 'national' },
      { holiday_date: '2026-11-24', name: 'Guru Nanak\'s Birthday', type: 'national' },
      { holiday_date: '2026-12-25', name: 'Christmas Day', type: 'national' },
      { holiday_date: '2027-01-26', name: 'Republic Day', type: 'national' },
      { holiday_date: '2027-03-06', name: 'Maha Shivaratri', type: 'regional' },
      { holiday_date: '2027-03-10', name: 'Eid-ul-Fitr', type: 'national' },
      { holiday_date: '2027-03-23', name: 'Holi', type: 'national' },
    ];

    for (const session of sessions) {
      const sessionId = session.id;

      // Fetch existing holidays for this session to prevent duplicates
      const existingHolidays = await queryInterface.sequelize.query(
        `SELECT holiday_date FROM session_holidays WHERE session_id = :sessionId;`,
        {
          replacements: { sessionId },
          type: queryInterface.sequelize.QueryTypes.SELECT,
        }
      );

      const existingDates = new Set(
        existingHolidays.map((h) => {
          // If returned as an object or string
          const date = typeof h === 'object' ? h.holiday_date : h;
          // Format as YYYY-MM-DD
          return new Date(date).toISOString().split('T')[0];
        })
      );

      const toInsert = holidaysTemplate
        .filter((h) => !existingDates.has(h.holiday_date))
        .map((h) => ({
          session_id: sessionId,
          holiday_date: h.holiday_date,
          name: h.name,
          type: h.type,
          added_by: null,
          created_at: now,
        }));

      if (toInsert.length > 0) {
        await queryInterface.bulkInsert('session_holidays', toInsert);
        console.log(`Seeded ${toInsert.length} holidays for session ID ${sessionId}`);
      } else {
        console.log(`All holidays already seeded for session ID ${sessionId}`);
      }
    }
  },

  async down(queryInterface) {
    const [sessions] = await queryInterface.sequelize.query(
      `SELECT id FROM sessions WHERE name = '2026-2027';`
    );

    if (sessions.length > 0) {
      const sessionIds = sessions.map((s) => s.id);
      await queryInterface.bulkDelete('session_holidays', {
        session_id: sessionIds,
      });
      console.log(`Deleted holidays for session IDs: ${sessionIds.join(', ')}`);
    }
  },
};
