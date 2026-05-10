'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('fee_carry_forwards', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      old_session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'sessions', key: 'id' },
        onDelete: 'CASCADE',
      },
      new_session_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'sessions', key: 'id' },
        onDelete: 'CASCADE',
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'id' },
        onDelete: 'CASCADE',
      },
      old_invoice_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'fee_invoices', key: 'id' },
        onDelete: 'CASCADE',
      },
      new_invoice_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'fee_invoices', key: 'id' },
        onDelete: 'SET NULL',
      },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      carried_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      carried_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      notes: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('fee_carry_forwards', ['student_id', 'old_session_id', 'new_session_id'], {
      name: 'idx_fee_carry_forwards_student_sessions',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('fee_carry_forwards');
  },
};
