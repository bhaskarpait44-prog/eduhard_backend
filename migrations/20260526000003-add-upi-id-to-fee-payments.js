'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('fee_payments', 'upi_id', {
      type: Sequelize.STRING(100),
      allowNull: true,
      comment: 'UPI ID used for payment (VPA)',
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('fee_payments', 'upi_id');
  },
};
