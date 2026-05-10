'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('teacher_leaves', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false,
      },
      teacher_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'teachers', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      leave_type: {
        type: Sequelize.ENUM('casual', 'sick', 'emergency', 'earned', 'without_pay'),
        allowNull: false,
      },
      from_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      to_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      days_count: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      document_path: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      reviewed_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      review_note: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      reviewed_at: {
        type: Sequelize.DATE,
        allowNull: true,
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

    await queryInterface.addIndex('teacher_leaves', ['teacher_id', 'status', 'from_date'], {
      name: 'idx_teacher_leaves_teacher_status_from',
    });

    await queryInterface.addIndex('teacher_leaves', ['teacher_id', 'leave_type', 'from_date'], {
      name: 'idx_teacher_leaves_teacher_type_from',
    });

    await queryInterface.addIndex('teacher_leaves', ['status', 'from_date', 'to_date'], {
      name: 'idx_teacher_leaves_status_date_range',
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE teacher_leaves
      ADD CONSTRAINT chk_teacher_leaves_date_range
      CHECK (to_date >= from_date);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE teacher_leaves
      ADD CONSTRAINT chk_teacher_leaves_days_count
      CHECK (days_count > 0);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE teacher_leaves
      ADD CONSTRAINT chk_teacher_leaves_review_consistency
      CHECK (
        (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
        OR
        (status = 'cancelled')
        OR
        (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
      );
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE teacher_leaves
      DROP CONSTRAINT IF EXISTS chk_teacher_leaves_date_range;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE teacher_leaves
      DROP CONSTRAINT IF EXISTS chk_teacher_leaves_days_count;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE teacher_leaves
      DROP CONSTRAINT IF EXISTS chk_teacher_leaves_review_consistency;
    `);
    await queryInterface.dropTable('teacher_leaves');
  },
};