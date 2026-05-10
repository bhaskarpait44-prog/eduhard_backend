'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Explicitly drop the NOT NULL constraint on teacher_id using raw SQL
    await queryInterface.sequelize.query(`
      ALTER TABLE teacher_notices ALTER COLUMN teacher_id DROP NOT NULL;
    `);
  },

  async down(queryInterface, Sequelize) {
    // Restore the NOT NULL constraint (caution: will fail if nulls exist)
    await queryInterface.sequelize.query(`
      ALTER TABLE teacher_notices ALTER COLUMN teacher_id SET NOT NULL;
    `);
  },
};
