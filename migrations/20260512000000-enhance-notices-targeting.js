'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Expand the audience enum to include new types
    // Note: PostgreSQL doesn't easily allow changing ENUMs in migrations without drops/raw SQL
    // We will use raw SQL to add values if they don't exist
    await queryInterface.sequelize.query(`
      ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'teachers';
      ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'parents';
      ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'accountants';
      ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'librarians';
      ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'receptionists';
      ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'specific_teacher';
      ALTER TYPE enum_notices_audience ADD VALUE IF NOT EXISTS 'subject_wise';
    `).catch(() => {}); // Ignore if not PG or already exists

    // 2. Add columns for granular targeting
    await queryInterface.addColumn('notices', 'target_teacher_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'teachers', key: 'id' },
      onDelete: 'CASCADE',
    });

    await queryInterface.addColumn('notices', 'target_subject_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'subjects', key: 'id' },
      onDelete: 'CASCADE',
    });

    await queryInterface.addColumn('notices', 'is_school_wide', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    
    // Index for performance
    await queryInterface.addIndex('notices', ['target_teacher_id']);
    await queryInterface.addIndex('notices', ['target_subject_id']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('notices', 'target_teacher_id');
    await queryInterface.removeColumn('notices', 'target_subject_id');
    await queryInterface.removeColumn('notices', 'is_school_wide');
  },
};
