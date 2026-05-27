'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    /**
     * Partial unique index for upi_transaction_id:
     * 1. Only enforce uniqueness for 'pending' and 'confirmed' statuses.
     * 2. Ignore 'rejected' status so students can re-submit with the same ID after rejection.
     * 3. Ignore 'PAYMENT_PENDING' placeholder used by mobile app.
     * 4. Ignore NULL values (though technically they should be one of the above).
     */
    await queryInterface.sequelize.query(`
      CREATE UNIQUE INDEX idx_unique_upi_tx_id 
      ON upi_payment_requests (upi_transaction_id) 
      WHERE status IN ('pending', 'confirmed') 
        AND upi_transaction_id IS NOT NULL 
        AND upi_transaction_id != 'PAYMENT_PENDING';
    `);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query('DROP INDEX idx_unique_upi_tx_id;');
  }
};
