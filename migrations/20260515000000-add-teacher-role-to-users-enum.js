'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query(`
        DO $$
        BEGIN
          ALTER TYPE "enum_users_role" ADD VALUE IF NOT EXISTS 'teacher';
        EXCEPTION
          WHEN duplicate_object THEN NULL;
          WHEN undefined_object THEN NULL;
        END $$;
      `);
    }
  },

  async down(queryInterface) {
    // Standard practice for enum values in Postgres: don't remove them as it's complex and risky.
  },
};
