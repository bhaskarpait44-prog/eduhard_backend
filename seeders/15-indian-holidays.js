'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const sessionId = 1; // Assuming session ID 1 is '2024-2025'
    const addedBy = 1;   // Assuming admin user ID 1

    const holidays = [
      { date: '2024-04-11', name: 'Eid-ul-Fitr', type: 'national' },
      { date: '2024-04-14', name: 'Ambedkar Jayanti', type: 'national' },
      { date: '2024-04-17', name: 'Ram Navami', type: 'national' },
      { date: '2024-04-21', name: 'Mahavir Jayanti', type: 'national' },
      { date: '2024-05-23', name: 'Buddha Purnima', type: 'national' },
      { date: '2024-06-17', name: 'Eid-ul-Adha', type: 'national' },
      { date: '2024-07-17', name: 'Muharram', type: 'national' },
      { date: '2024-08-15', name: 'Independence Day', type: 'national' },
      { date: '2024-08-26', name: 'Janmashtami', type: 'national' },
      { date: '2024-09-16', name: 'Milad-un-Nabi', type: 'national' },
      { date: '2024-10-02', name: 'Gandhi Jayanti', type: 'national' },
      { date: '2024-10-12', name: 'Dussehra', type: 'national' },
      { date: '2024-10-31', name: 'Diwali', type: 'national' },
      { date: '2024-11-15', name: 'Guru Nanak Jayanti', type: 'national' },
      { date: '2024-12-25', name: 'Christmas', type: 'national' },
      { date: '2025-01-26', name: 'Republic Day', type: 'national' },
      { date: '2025-02-26', name: 'Maha Shivaratri', type: 'national' },
      { date: '2025-03-14', name: 'Holi', type: 'national' },
    ];

    const holidayData = holidays.map(h => ({
      session_id: sessionId,
      holiday_date: h.date,
      name: h.name,
      type: h.type,
      added_by: addedBy,
      created_at: now
    }));

    // Use bulkInsert with ignoreDuplicates if supported, or check manually
    // For simplicity, we'll try to insert and ignore errors or filter out existing
    for (const data of holidayData) {
        const [existing] = await queryInterface.sequelize.query(
            `SELECT id FROM session_holidays WHERE session_id = :sessionId AND holiday_date = :date LIMIT 1;`,
            { replacements: { sessionId: data.session_id, date: data.holiday_date } }
        );
        if (existing.length === 0) {
            await queryInterface.bulkInsert('session_holidays', [data]);
        }
    }
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('session_holidays', null, {});
  }
};
