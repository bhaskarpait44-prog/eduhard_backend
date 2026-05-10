'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('homework', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
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
        allowNull: false,
        references: { model: 'subjects', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'sessions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      title: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      due_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      submission_type: {
        type: Sequelize.ENUM('written', 'online', 'both'),
        allowNull: false,
      },
      max_marks: {
        type: Sequelize.DECIMAL(8, 2),
        allowNull: true,
      },
      attachment_path: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('active', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'active',
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

    await queryInterface.addIndex('homework', ['teacher_id', 'status', 'due_date'], {
      name: 'idx_homework_teacher_status_due',
    });

    await queryInterface.addIndex('homework', ['class_id', 'section_id', 'subject_id', 'due_date'], {
      name: 'idx_homework_class_section_subject_due',
    });

    await queryInterface.addIndex('homework', ['session_id', 'status'], {
      name: 'idx_homework_session_status',
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE homework
      ADD CONSTRAINT chk_homework_max_marks_positive
      CHECK (max_marks IS NULL OR max_marks >= 0);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE homework
      DROP CONSTRAINT IF EXISTS chk_homework_max_marks_positive;
    `);
    await queryInterface.dropTable('homework');
  },
};