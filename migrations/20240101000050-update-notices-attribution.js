'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Make teacher_id nullable
    await queryInterface.changeColumn('teacher_notices', 'teacher_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'teachers', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });

    // 2. Add created_by_user_id
    await queryInterface.addColumn('teacher_notices', 'created_by_user_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    // 3. Add created_by_role
    await queryInterface.addColumn('teacher_notices', 'created_by_role', {
      type: Sequelize.STRING(50),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn('teacher_notices', 'created_by_role');
    await queryInterface.removeColumn('teacher_notices', 'created_by_user_id');
    await queryInterface.changeColumn('teacher_notices', 'teacher_id', {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: { model: 'teachers', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    });
  },
};
