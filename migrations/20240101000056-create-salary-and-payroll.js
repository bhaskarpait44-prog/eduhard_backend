'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('salary_structures', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      school_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'schools', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      user_id: { type: Sequelize.INTEGER, allowNull: false, unique: true, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      basic: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      hra: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      da: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      allowances: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      deductions: { type: Sequelize.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.createTable('payrolls', {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
      school_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'schools', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      user_id: { type: Sequelize.INTEGER, allowNull: false, references: { model: 'users', key: 'id' }, onUpdate: 'CASCADE', onDelete: 'CASCADE' },
      month: { type: Sequelize.INTEGER, allowNull: false },
      year: { type: Sequelize.INTEGER, allowNull: false },
      basic: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      hra: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      da: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      allowances: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      deductions: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      net_salary: { type: Sequelize.DECIMAL(10, 2), allowNull: false },
      status: { type: Sequelize.ENUM('generated', 'paid'), allowNull: false, defaultValue: 'generated' },
      payment_date: { type: Sequelize.DATEONLY, allowNull: true },
      payment_mode: { type: Sequelize.STRING(50), allowNull: true },
      remarks: { type: Sequelize.TEXT, allowNull: true },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    });

    await queryInterface.addIndex('payrolls', ['school_id', 'month', 'year']);
    await queryInterface.addIndex('payrolls', ['user_id', 'month', 'year'], { unique: true, name: 'idx_payrolls_user_month_year' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('payrolls');
    await queryInterface.dropTable('salary_structures');
  },
};
