'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('families', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      school_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'schools', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      family_name: { type: Sequelize.STRING(150), allowNull: false },
      primary_contact: { type: Sequelize.STRING(150), allowNull: false },
      phone: { type: Sequelize.STRING(20), allowNull: false },
      email: { type: Sequelize.STRING(150), allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addColumn('students', 'family_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'families', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addIndex('families', ['school_id']);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('students', 'family_id');
    await queryInterface.dropTable('families');
  },
};
