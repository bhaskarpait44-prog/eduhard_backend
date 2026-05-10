'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('classes', {
      id: {
        type          : Sequelize.INTEGER,
        autoIncrement : true,
        primaryKey    : true,
        allowNull     : false,
      },
      school_id: {
        type       : Sequelize.INTEGER,
        allowNull  : false,
        references : { model: 'schools', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'RESTRICT',
      },
      name: {
        type      : Sequelize.STRING(100),
        allowNull : false,
        comment   : 'e.g. Grade 6, Grade 7',
      },
      display_name: {
        type      : Sequelize.STRING(100),
        allowNull : true,
        comment   : 'e.g. Class 6, Standard 6 — shown on reports',
      },
      order_number: {
        type      : Sequelize.INTEGER,
        allowNull : false,
        comment   : 'Promotion sequence order — Grade 1 = 1, Grade 2 = 2',
      },
      stream: {
        type         : Sequelize.STRING(20),
        allowNull    : true,
        defaultValue : 'regular',
        comment      : 'Academic stream: regular, arts, commerce, or science.',
      },
      min_age: {
        type      : Sequelize.INTEGER,
        allowNull : true,
        comment   : 'Minimum recommended age in years',
      },
      max_age: {
        type      : Sequelize.INTEGER,
        allowNull : true,
        comment   : 'Maximum recommended age in years',
      },
      description: {
        type      : Sequelize.TEXT,
        allowNull : true,
      },
      is_active: {
        type         : Sequelize.BOOLEAN,
        allowNull    : false,
        defaultValue : true,
      },
      is_deleted: {
        type         : Sequelize.BOOLEAN,
        allowNull    : false,
        defaultValue : false,
      },
      created_by: {
        type       : Sequelize.INTEGER,
        allowNull  : true,
        references : { model: 'users', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'SET NULL',
      },
      updated_by: {
        type       : Sequelize.INTEGER,
        allowNull  : true,
        references : { model: 'users', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'SET NULL',
      },
      created_at: {
        type         : Sequelize.DATE,
        allowNull    : false,
        defaultValue : Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type         : Sequelize.DATE,
        allowNull    : false,
        defaultValue : Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    // Unique indexes with stream consideration
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX idx_classes_school_name_no_stream
      ON classes (school_id, name)
      WHERE is_deleted = false AND stream IS NULL;

      CREATE UNIQUE INDEX idx_classes_school_name_stream
      ON classes (school_id, name, stream)
      WHERE is_deleted = false AND stream IS NOT NULL;

      CREATE UNIQUE INDEX idx_classes_school_order_no_stream
      ON classes (school_id, order_number)
      WHERE is_deleted = false AND stream IS NULL;

      CREATE UNIQUE INDEX idx_classes_school_order_stream
      ON classes (school_id, order_number, stream)
      WHERE is_deleted = false AND stream IS NOT NULL;
    `);

    // Fast filter queries
    await queryInterface.addIndex('classes', ['school_id', 'is_active', 'is_deleted'], {
      name: 'idx_classes_school_active',
    });

    // Constraints
    await queryInterface.sequelize.query(`
      ALTER TABLE classes
      ADD CONSTRAINT chk_classes_age_range
      CHECK (max_age IS NULL OR min_age IS NULL OR max_age > min_age);

      ALTER TABLE classes
      ADD CONSTRAINT chk_classes_stream
      CHECK (
        stream IS NULL
        OR stream IN ('regular', 'arts', 'commerce', 'science')
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('classes');
  },
};
