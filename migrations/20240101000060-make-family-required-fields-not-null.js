'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    // Set any existing nulls to a placeholder before adding NOT NULL
    await queryInterface.sequelize.query(`
      UPDATE families
      SET family_name     = COALESCE(family_name, 'Unnamed Family'),
          primary_contact = COALESCE(primary_contact, 'Unknown'),
          phone           = COALESCE(phone, '—')
      WHERE family_name IS NULL
         OR primary_contact IS NULL
         OR phone IS NULL;
    `);

    await queryInterface.changeColumn('families', 'family_name', {
      type: Sequelize.STRING(150), allowNull: false,
    });
    await queryInterface.changeColumn('families', 'primary_contact', {
      type: Sequelize.STRING(150), allowNull: false,
    });
    await queryInterface.changeColumn('families', 'phone', {
      type: Sequelize.STRING(20), allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('families', 'family_name',     { type: Sequelize.STRING(150), allowNull: true });
    await queryInterface.changeColumn('families', 'primary_contact', { type: Sequelize.STRING(150), allowNull: true });
    await queryInterface.changeColumn('families', 'phone',           { type: Sequelize.STRING(20),  allowNull: true });
  },
};
