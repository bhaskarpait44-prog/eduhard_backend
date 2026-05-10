'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('transport_routes', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      school_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'schools', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      name: { type: Sequelize.STRING(150), allowNull: false },
      vehicle_number: { type: Sequelize.STRING(50), allowNull: true },
      driver_name: { type: Sequelize.STRING(150), allowNull: true },
      driver_phone: { type: Sequelize.STRING(20), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('transport_stops', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      route_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'transport_routes', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      name: { type: Sequelize.STRING(150), allowNull: false },
      pickup_time: { type: Sequelize.TIME, allowNull: true },
      drop_time: { type: Sequelize.TIME, allowNull: true },
      fare: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addColumn('students', 'transport_stop_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'transport_stops', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addIndex('transport_routes', ['school_id']);
    await queryInterface.addIndex('transport_stops', ['route_id']);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('students', 'transport_stop_id');
    await queryInterface.dropTable('transport_stops');
    await queryInterface.dropTable('transport_routes');
  },
};
