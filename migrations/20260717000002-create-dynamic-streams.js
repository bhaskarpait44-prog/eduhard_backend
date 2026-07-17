'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;

    // 1. Create streams table
    await queryInterface.createTable('streams', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      name: {
        type: Sequelize.STRING(50),
        allowNull: false
      },
      school_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'schools', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });

    // 2. Add unique index on (school_id, name)
    await queryInterface.addIndex('streams', ['school_id', 'name'], {
      name: 'idx_streams_school_name',
      unique: true
    });

    // 3. Pre-populate with default streams for existing schools
    await sequelize.query(`
      INSERT INTO streams (name, school_id)
      SELECT s.name, sch.id
      FROM (
        VALUES ('regular'), ('arts'), ('commerce'), ('science')
      ) AS s(name)
      CROSS JOIN schools sch
      ON CONFLICT (school_id, name) DO NOTHING;
    `);

    // 4. Drop check constraints on classes and enrollments tables
    await sequelize.query(`
      ALTER TABLE classes DROP CONSTRAINT IF EXISTS chk_classes_stream;
      ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS chk_enrollments_stream;
    `);
  },

  async down(queryInterface, Sequelize) {
    const { sequelize } = queryInterface;

    // 1. Re-add check constraints to classes and enrollments
    await sequelize.query(`
      ALTER TABLE classes ADD CONSTRAINT chk_classes_stream CHECK (stream IS NULL OR stream IN ('regular', 'arts', 'commerce', 'science'));
      ALTER TABLE enrollments ADD CONSTRAINT chk_enrollments_stream CHECK (stream IS NULL OR stream IN ('regular', 'arts', 'commerce', 'science'));
    `);

    // 2. Drop streams table
    await queryInterface.dropTable('streams');
  }
};
