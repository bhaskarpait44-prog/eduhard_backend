'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Add source column to notice_pins
    await queryInterface.addColumn('notice_pins', 'source', {
      type: Sequelize.STRING(50),
      allowNull: false,
      defaultValue: 'unified',
    });

    // 2. Drop the foreign key constraint
    await queryInterface.sequelize.query(`
      ALTER TABLE notice_pins DROP CONSTRAINT IF EXISTS notice_pins_notice_id_fkey;
    `);

    // 3. Drop unique constraint
    await queryInterface.removeConstraint('notice_pins', 'notice_pins_notice_student_unique').catch(() => {});

    // 4. Add new unique constraint including source
    await queryInterface.addConstraint('notice_pins', {
      fields: ['notice_id', 'student_id', 'source'],
      type: 'unique',
      name: 'notice_pins_notice_student_source_unique'
    });
  },

  async down(queryInterface, Sequelize) {
    // Revert
    await queryInterface.removeConstraint('notice_pins', 'notice_pins_notice_student_source_unique').catch(() => {});
    
    await queryInterface.sequelize.query(`
      ALTER TABLE notice_pins 
      ADD CONSTRAINT notice_pins_notice_id_fkey 
      FOREIGN KEY (notice_id) REFERENCES notices(id) ON DELETE CASCADE;
    `).catch(() => {});

    await queryInterface.addConstraint('notice_pins', {
      fields: ['notice_id', 'student_id'],
      type: 'unique',
      name: 'notice_pins_notice_student_unique'
    }).catch(() => {});

    await queryInterface.removeColumn('notice_pins', 'source');
  }
};
