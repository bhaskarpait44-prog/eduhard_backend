'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    
    // 1. Fee Structures
    const feeStructures = [1, 2, 3, 4].map(classId => ({
      id: classId,
      session_id: 1,
      class_id: classId,
      name: 'Monthly Tuition Fee',
      amount: (classId === 3 || classId === 4) ? 3500 : 2500,
      frequency: 'monthly',
      due_day: 10,
      is_active: true,
      created_at: now,
      updated_at: now
    }));
    await queryInterface.bulkInsert('fee_structures', feeStructures, { ignoreDuplicates: true });

    // 2. Fee Invoices (for initial month April 2024)
    const [enrollments] = await queryInterface.sequelize.query(
      `SELECT id, class_id FROM enrollments WHERE session_id = 1`
    );

    const invoices = enrollments.map(enr => ({
      enrollment_id: enr.id,
      fee_structure_id: enr.class_id, // My fee structure IDs match class IDs
      amount_due: enr.class_id > 2 ? 3500 : 2500,
      amount_paid: 0,
      due_date: '2024-04-10',
      status: 'pending',
      created_at: now,
      updated_at: now
    }));

    await queryInterface.bulkInsert('fee_invoices', invoices, { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('fee_invoices', null, {});
    await queryInterface.bulkDelete('fee_structures', null, {});
  }
};
