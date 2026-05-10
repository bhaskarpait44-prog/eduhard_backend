'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$
      BEGIN
        ALTER TYPE enum_exams_status ADD VALUE IF NOT EXISTS 'draft';
        ALTER TYPE enum_exams_status ADD VALUE IF NOT EXISTS 'published';
      EXCEPTION
        WHEN undefined_object THEN NULL;
      END $$;
    `);

    await queryInterface.addColumn('exams', 'published_at', {
      type: Sequelize.DATE,
      allowNull: true,
    }).catch((error) => {
      if (!/already exists/i.test(error.message)) throw error;
    });

    await queryInterface.addColumn('exams', 'published_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    }).catch((error) => {
      if (!/already exists/i.test(error.message)) throw error;
    });

    await queryInterface.addColumn('exams', 'created_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    }).catch((error) => {
      if (!/already exists/i.test(error.message)) throw error;
    });

    await queryInterface.addColumn('exams', 'updated_by', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    }).catch((error) => {
      if (!/already exists/i.test(error.message)) throw error;
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('exams', 'updated_by').catch(() => {});
    await queryInterface.removeColumn('exams', 'created_by').catch(() => {});
    await queryInterface.removeColumn('exams', 'published_by').catch(() => {});
    await queryInterface.removeColumn('exams', 'published_at').catch(() => {});
  },
};
