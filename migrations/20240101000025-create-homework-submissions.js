'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('homework_submissions', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      homework_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'homework', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      enrollment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'enrollments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      submitted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      submission_content: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      attachment_path: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      marks_obtained: {
        type: Sequelize.DECIMAL(8, 2),
        allowNull: true,
      },
      teacher_comment: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      is_late: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      status: {
        type: Sequelize.ENUM('submitted', 'pending', 'graded'),
        allowNull: false,
        defaultValue: 'submitted',
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('homework_submissions', ['homework_id', 'enrollment_id'], {
      name: 'idx_homework_submissions_homework_enrollment',
      unique: true,
    });

    await queryInterface.addIndex('homework_submissions', ['homework_id', 'status', 'submitted_at'], {
      name: 'idx_homework_submissions_homework_status',
    });

    await queryInterface.addIndex('homework_submissions', ['enrollment_id', 'status'], {
      name: 'idx_homework_submissions_enrollment_status',
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE homework_submissions
      ADD CONSTRAINT chk_homework_submissions_marks_positive
      CHECK (marks_obtained IS NULL OR marks_obtained >= 0);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE homework_submissions
      ADD CONSTRAINT chk_homework_submissions_status_consistency
      CHECK (
        (status = 'pending' AND submitted_at IS NULL)
        OR
        (status IN ('submitted', 'graded') AND submitted_at IS NOT NULL)
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE homework_submissions
      DROP CONSTRAINT IF EXISTS chk_homework_submissions_marks_positive;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE homework_submissions
      DROP CONSTRAINT IF EXISTS chk_homework_submissions_status_consistency;
    `);
    await queryInterface.dropTable('homework_submissions');
  },
};