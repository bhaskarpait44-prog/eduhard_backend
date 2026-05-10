'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      DO $$ BEGIN
        CREATE TYPE subject_type_enum AS ENUM ('theory', 'practical', 'both');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryInterface.createTable('subjects', {
      id: {
        type          : Sequelize.INTEGER,
        autoIncrement : true,
        primaryKey    : true,
        allowNull     : false,
      },
      class_id: {
        type       : Sequelize.INTEGER,
        allowNull  : false,
        references : { model: 'classes', key: 'id' },
        onUpdate   : 'CASCADE',
        onDelete   : 'RESTRICT',
      },
      name: {
        type      : Sequelize.STRING(150),
        allowNull : false,
        comment   : 'e.g. Mathematics, Science, English',
      },
      code: {
        type      : Sequelize.STRING(30),
        allowNull : false,
        comment   : 'e.g. MATH-6 — must be unique per class',
      },
      subject_type: {
        type         : Sequelize.ENUM('theory', 'practical', 'both'),
        allowNull    : false,
        defaultValue : 'theory',
      },
      is_core: {
        type         : Sequelize.BOOLEAN,
        allowNull    : false,
        defaultValue : true,
        comment      : 'true = failing this subject triggers compartment/fail',
      },
      theory_total_marks: {
        type      : Sequelize.DECIMAL(6, 2),
        allowNull : true,
      },
      theory_passing_marks: {
        type      : Sequelize.DECIMAL(6, 2),
        allowNull : true,
      },
      practical_total_marks: {
        type      : Sequelize.DECIMAL(6, 2),
        allowNull : true,
      },
      practical_passing_marks: {
        type      : Sequelize.DECIMAL(6, 2),
        allowNull : true,
      },
      combined_total_marks: {
        type      : Sequelize.DECIMAL(6, 2),
        allowNull : false,
        defaultValue : 100,
      },
      combined_passing_marks: {
        type      : Sequelize.DECIMAL(6, 2),
        allowNull : false,
        defaultValue : 35,
      },
      order_number: {
        type         : Sequelize.INTEGER,
        allowNull    : false,
        defaultValue : 1,
        comment      : 'Display order on mark sheets and report cards',
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

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX idx_subjects_class_code
      ON subjects (class_id, code)
      WHERE is_deleted = false AND code IS NOT NULL;

      CREATE UNIQUE INDEX idx_subjects_class_name
      ON subjects (class_id, name)
      WHERE is_deleted = false;
    `);

    await queryInterface.addIndex('subjects', ['class_id', 'order_number'], {
      name: 'idx_subjects_class_order',
    });

    await queryInterface.addIndex('subjects', ['class_id', 'is_deleted'], {
      name: 'idx_subjects_class',
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE subjects
      ADD CONSTRAINT chk_subjects_theory_marks
      CHECK (
        (subject_type = 'practical') OR
        (theory_total_marks IS NOT NULL AND theory_passing_marks IS NOT NULL
         AND theory_passing_marks <= theory_total_marks)
      );

      ALTER TABLE subjects
      ADD CONSTRAINT chk_subjects_practical_marks
      CHECK (
        (subject_type = 'theory') OR
        (practical_total_marks IS NOT NULL AND practical_passing_marks IS NOT NULL
         AND practical_passing_marks <= practical_total_marks)
      );

      ALTER TABLE subjects
      ADD CONSTRAINT chk_subjects_combined_positive
      CHECK (
        combined_total_marks > 0 AND
        combined_passing_marks > 0 AND
        combined_passing_marks <= combined_total_marks
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('subjects');
    await queryInterface.sequelize.query(`DROP TYPE IF EXISTS subject_type_enum;`);
  },
};
