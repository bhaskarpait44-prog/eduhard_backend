'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('inventory_items', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      school_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'schools', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      name: { type: Sequelize.STRING(150), allowNull: false },
      category: { type: Sequelize.STRING(100), allowNull: false },
      unit: { type: Sequelize.STRING(50), allowNull: false },
      quantity: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      reorder_level: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      description: { type: Sequelize.TEXT, allowNull: true },
      location: { type: Sequelize.STRING(150), allowNull: true },
      unit_price: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('inventory_transactions', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      item_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'inventory_items', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'RESTRICT' },
      type: { type: Sequelize.ENUM('in', 'out'), allowNull: false },
      quantity: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      vendor: { type: Sequelize.STRING(200), allowNull: true },
      remarks: { type: Sequelize.TEXT, allowNull: true },
      performed_by: { type: Sequelize.INTEGER, allowNull: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'SET NULL' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('inventory_items', ['school_id']);
    await queryInterface.addIndex('inventory_transactions', ['item_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('inventory_transactions');
    await queryInterface.dropTable('inventory_items');
  },
};
