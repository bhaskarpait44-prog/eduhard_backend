'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('fee_refunds', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'students', key: 'id' },
        onDelete: 'CASCADE',
      },
      payment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'fee_payments', key: 'id' },
        onDelete: 'CASCADE',
      },
      invoice_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'fee_invoices', key: 'id' },
        onDelete: 'SET NULL',
      },
      amount: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      reason: { type: Sequelize.TEXT, allowNull: false },
      refund_method: {
        type: Sequelize.ENUM('cash', 'online', 'adjustment'),
        allowNull: false,
      },
      reference_number: { type: Sequelize.STRING(150), allowNull: true },
      status: {
        type: Sequelize.ENUM('pending', 'processed', 'cancelled'),
        allowNull: false,
        defaultValue: 'processed',
      },
      processed_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
      },
      processed_at: { type: Sequelize.DATE, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('fee_refunds', ['student_id', 'created_at'], {
      name: 'idx_fee_refunds_student_created_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('fee_refunds');
  },
};
