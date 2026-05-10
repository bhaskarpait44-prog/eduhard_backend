'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('teacher_assignments', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'sessions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'teachers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      class_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'classes', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      section_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'sections', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      subject_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'subjects', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
        comment: 'NULL for class teacher assignment; required for subject teacher assignment',
      },
      is_class_teacher: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('teacher_assignments', ['teacher_id', 'session_id', 'is_active'], {
      name: 'idx_teacher_assignments_teacher_session_active',
    });

    await queryInterface.addIndex('teacher_assignments', ['class_id', 'section_id', 'is_active'], {
      name: 'idx_teacher_assignments_class_section_active',
    });

    await queryInterface.addIndex('teacher_assignments', ['teacher_id', 'session_id', 'class_id', 'section_id', 'subject_id'], {
      name: 'idx_teacher_assignments_unique_scope',
      unique: true,
    });

    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX idx_teacher_assignments_one_class_teacher
      ON teacher_assignments (session_id, class_id, section_id)
      WHERE is_class_teacher = true AND is_active = true;
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE teacher_assignments
      ADD CONSTRAINT chk_teacher_assignments_subject_rule
      CHECK (
        (is_class_teacher = true AND subject_id IS NULL)
        OR
        (is_class_teacher = false AND subject_id IS NOT NULL)
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('teacher_assignments');
  },
};
