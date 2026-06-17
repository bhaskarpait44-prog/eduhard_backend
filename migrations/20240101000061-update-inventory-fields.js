'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    // New columns on inventory_items
    await queryInterface.addColumn('inventory_items', 'description',  { type: Sequelize.TEXT,           allowNull: true });
    await queryInterface.addColumn('inventory_items', 'location',     { type: Sequelize.STRING(150),    allowNull: true });
    await queryInterface.addColumn('inventory_items', 'unit_price',   { type: Sequelize.DECIMAL(10, 2), allowNull: true });

    // New columns on inventory_transactions
    await queryInterface.addColumn('inventory_transactions', 'vendor', { type: Sequelize.STRING(200), allowNull: true });

    // Change onDelete from CASCADE to RESTRICT on the FK
    // NOTE: PostgreSQL requires dropping and recreating the FK constraint:
    await queryInterface.removeConstraint('inventory_transactions', 'inventory_transactions_item_id_fkey');
    await queryInterface.addConstraint('inventory_transactions', {
      fields: ['item_id'],
      type: 'foreign key',
      name: 'inventory_transactions_item_id_fkey',
      references: { table: 'inventory_items', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',   // ← prevents data loss on item delete
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('inventory_items', 'description');
    await queryInterface.removeColumn('inventory_items', 'location');
    await queryInterface.removeColumn('inventory_items', 'unit_price');
    await queryInterface.removeColumn('inventory_transactions', 'vendor');
    
    // Revert RESTRICT to CASCADE
    await queryInterface.removeConstraint('inventory_transactions', 'inventory_transactions_item_id_fkey');
    await queryInterface.addConstraint('inventory_transactions', {
      fields: ['item_id'],
      type: 'foreign key',
      name: 'inventory_transactions_item_id_fkey',
      references: { table: 'inventory_items', field: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'CASCADE',
    });
  }
};
