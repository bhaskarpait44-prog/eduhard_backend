'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('cheque_payments', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      payment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'fee_payments', key: 'id' },
        onDelete: 'CASCADE',
      },
      cheque_number: { type: Sequelize.STRING(100), allowNull: false },
      bank_name: { type: Sequelize.STRING(150), allowNull: false },
      branch_name: { type: Sequelize.STRING(150), allowNull: true },
      cheque_date: { type: Sequelize.DATEONLY, allowNull: false },
      received_date: { type: Sequelize.DATEONLY, allowNull: false },
      clearance_date: { type: Sequelize.DATEONLY, allowNull: true },
      status: {
        type: Sequelize.ENUM('pending', 'cleared', 'bounced'),
        allowNull: false,
        defaultValue: 'pending',
      },
      bounce_reason: { type: Sequelize.TEXT, allowNull: true },
      bounce_date: { type: Sequelize.DATEONLY, allowNull: true },
      bounce_charge: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      cleared_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('cheque_payments', ['status', 'received_date'], {
      name: 'idx_cheque_payments_status_received_date',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('cheque_payments');
  },
};
