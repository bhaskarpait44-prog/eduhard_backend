'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const permAddressColumns = {
      perm_address: { type: Sequelize.TEXT, allowNull: true },
      perm_village: { type: Sequelize.STRING(150), allowNull: true },
      perm_police_station: { type: Sequelize.STRING(150), allowNull: true },
      perm_post_office: { type: Sequelize.STRING(150), allowNull: true },
      perm_district: { type: Sequelize.STRING(100), allowNull: true },
      perm_state: { type: Sequelize.STRING(100), allowNull: true },
      perm_pincode: { type: Sequelize.STRING(10), allowNull: true },
      is_permanent_same: { type: Sequelize.BOOLEAN, allowNull: true, defaultValue: false }
    };

    for (const [col, spec] of Object.entries(permAddressColumns)) {
      await queryInterface.addColumn('student_profiles', col, spec);
    }
  },

  down: async (queryInterface, Sequelize) => {
    const cols = [
      'perm_address', 'perm_village', 'perm_police_station', 'perm_post_office',
      'perm_district', 'perm_state', 'perm_pincode', 'is_permanent_same'
    ];

    for (const col of cols) {
      await queryInterface.removeColumn('student_profiles', col);
    }
  }
};
