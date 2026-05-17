'use strict';
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TYPE enum_notices_posted_by_role ADD VALUE IF NOT EXISTS 'receptionist';
      ALTER TYPE enum_notices_posted_by_role ADD VALUE IF NOT EXISTS 'librarian';
    `);
  },
  async down() {}
};
