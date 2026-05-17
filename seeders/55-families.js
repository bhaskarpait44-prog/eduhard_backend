'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const families = [];
    
    // Create 20 families (one for each student for simplicity)
    for (let i = 1; i <= 20; i++) {
      families.push({
        id: i,
        school_id: 1,
        family_name: `Family ${i}`,
        primary_contact: `Parent of Student ${i}`,
        phone: `9954001${i.toString().padStart(2, '0')}`,
        email: `parent${i}@example.com`,
        created_at: now,
        updated_at: now
      });
    }

    await queryInterface.bulkInsert('families', families, { ignoreDuplicates: true });

    // Link students to families (student 1 -> family 1, etc.)
    for (let i = 1; i <= 20; i++) {
      await queryInterface.sequelize.query(
        `UPDATE students SET family_id = ${i} WHERE id = ${i}`
      );
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`UPDATE students SET family_id = NULL`);
    await queryInterface.bulkDelete('families', null, {});
  }
};
