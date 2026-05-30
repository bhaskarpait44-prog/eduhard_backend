'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Check if index already exists (Postgres specific check, adjusting for Sequelize)
    // Sequelize's addIndex will throw if it exists, so we wrap in try-catch
    // or just let it run since migrations are usually fresh.
    // However, to be safe:
    try {
      await queryInterface.addIndex('session_holidays', ['session_id', 'holiday_date'], {
        name: 'idx_holidays_session_date_unique',
        unique: true,
      });
    } catch (err) {
      console.log('Index idx_holidays_session_date_unique might already exist, skipping...');
    }
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('session_holidays', 'idx_holidays_session_date_unique');
  },
};
