'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('upi_payment_requests', {
      id: {
        type: Sequelize.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      enrollment_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'enrollments', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      invoice_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: 'fee_invoices', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
      },
      upi_transaction_id: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      student_note: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('pending', 'confirmed', 'rejected'),
        allowNull: false,
        defaultValue: 'pending',
      },
      rejected_reason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      confirmed_by: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      confirmed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    await queryInterface.addIndex('upi_payment_requests', ['invoice_id', 'status']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('upi_payment_requests');
    // Note: enum type might need to be dropped manually in some dialects, 
    // but Sequelize usually handles it or it's dropped with the table in PG if it's implicitly created.
  }
};
