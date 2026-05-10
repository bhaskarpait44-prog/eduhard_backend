'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('leave_balances', {
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
      session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'sessions', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'RESTRICT',
      },
      leave_type: {
        type: Sequelize.ENUM('casual', 'sick', 'emergency', 'earned', 'without_pay'),
        allowNull: false,
      },
      total_allowed: {
        type: Sequelize.DECIMAL(6, 2),
        allowNull: false,
      },
      used: {
        type: Sequelize.DECIMAL(6, 2),
        allowNull: false,
        defaultValue: 0,
      },
      remaining: {
        type: Sequelize.DECIMAL(6, 2),
        allowNull: false,
        comment: 'Stored remaining balance for quick reads; kept in sync by app logic',
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

    await queryInterface.addIndex('leave_balances', ['teacher_id', 'session_id', 'leave_type'], {
      name: 'idx_leave_balances_teacher_session_type',
      unique: true,
    });

    await queryInterface.addIndex('leave_balances', ['session_id', 'leave_type'], {
      name: 'idx_leave_balances_session_type',
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE leave_balances
      ADD CONSTRAINT chk_leave_balances_non_negative
      CHECK (total_allowed >= 0 AND used >= 0 AND remaining >= 0);
    `);

    await queryInterface.sequelize.query(`
      ALTER TABLE leave_balances
      ADD CONSTRAINT chk_leave_balances_remaining_formula
      CHECK (remaining = total_allowed - used);
    `);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      ALTER TABLE leave_balances
      DROP CONSTRAINT IF EXISTS chk_leave_balances_non_negative;
    `);
    await queryInterface.sequelize.query(`
      ALTER TABLE leave_balances
      DROP CONSTRAINT IF EXISTS chk_leave_balances_remaining_formula;
    `);
    await queryInterface.dropTable('leave_balances');
  },
};