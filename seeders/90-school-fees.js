'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const schoolId = 1;
    const sessionId = 1;

    // 1. Fetch Classes and Enrollments
    const [classes] = await queryInterface.sequelize.query(
      `SELECT id, name, order_number FROM classes WHERE school_id = ${schoolId} AND is_deleted = false`
    );

    const [enrollments] = await queryInterface.sequelize.query(
      `SELECT e.id, e.class_id FROM enrollments e
       JOIN students s ON s.id = e.student_id
       WHERE e.session_id = ${sessionId} AND s.school_id = ${schoolId} AND e.status = 'active'`
    );

    // Fetch an admin user for record tracking
    const [[admin]] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE school_id = ${schoolId} AND role = 'admin' LIMIT 1`
    );
    const adminId = admin ? admin.id : null;

    console.log(`Setting up fee structures for ${classes.length} classes...`);

    const structures = [];
    classes.forEach(cls => {
      // Define a base monthly fee that increases slightly with order_number
      const baseFee = 2000 + (cls.order_number * 200);

      // Monthly Tuition Fee
      structures.push({
        session_id: sessionId,
        class_id: cls.id,
        name: 'Monthly Tuition Fee',
        amount: baseFee,
        frequency: 'monthly',
        due_day: 10,
        is_active: true,
        created_at: now,
        updated_at: now
      });

      // One-time Admission Fee
      structures.push({
        session_id: sessionId,
        class_id: cls.id,
        name: 'Admission Fee',
        amount: 5000,
        frequency: 'one_time',
        due_day: 1,
        is_active: true,
        created_at: now,
        updated_at: now
      });
    });

    await queryInterface.bulkInsert('fee_structures', structures);

    // Fetch the newly created structures
    const [dbStructures] = await queryInterface.sequelize.query(
      `SELECT id, class_id, name, amount, frequency FROM fee_structures WHERE session_id = ${sessionId} AND is_active = true`
    );

    console.log(`Generating invoices and payments for ${enrollments.length} students...`);

    const invoices = [];
    const payments = [];
    
    // We'll generate for April and May 2026
    const months = [
      { num: 4, year: 2026, due: '2026-04-10', paid: '2026-04-05' },
      { num: 5, year: 2026, due: '2026-05-10', paid: '2026-05-08' }
    ];

    let invoiceCounter = 1;

    for (const enr of enrollments) {
      const classStructs = dbStructures.filter(s => s.class_id === enr.class_id);

      // 1. Handle Admission Fee (One-time)
      const admStruct = classStructs.find(s => s.frequency === 'one_time');
      if (admStruct) {
        const invId = invoiceCounter++;
        const payDate = '2026-04-01';
        
        invoices.push({
          id: invId,
          enrollment_id: enr.id,
          fee_structure_id: admStruct.id,
          amount_due: admStruct.amount,
          amount_paid: admStruct.amount,
          due_date: '2026-04-01',
          paid_date: payDate,
          status: 'paid',
          created_at: now,
          updated_at: now
        });

        payments.push({
          invoice_id: invId,
          amount: admStruct.amount,
          payment_date: payDate,
          payment_mode: 'cash',
          received_by: adminId,
          created_at: now
        });
      }

      // 2. Handle Monthly Tuition Fees
      const tuitionStruct = classStructs.find(s => s.name === 'Monthly Tuition Fee');
      if (tuitionStruct) {
        months.forEach(m => {
          const invId = invoiceCounter++;
          
          invoices.push({
            id: invId,
            enrollment_id: enr.id,
            fee_structure_id: tuitionStruct.id,
            amount_due: tuitionStruct.amount,
            amount_paid: tuitionStruct.amount,
            due_date: m.due,
            paid_date: m.paid,
            status: 'paid',
            created_at: now,
            updated_at: now
          });

          payments.push({
            invoice_id: invId,
            amount: tuitionStruct.amount,
            payment_date: m.paid,
            payment_mode: 'upi',
            received_by: adminId,
            created_at: now
          });
        });
      }
    }

    // Chunking to prevent large query failures
    const chunkSize = 2000;
    for (let i = 0; i < invoices.length; i += chunkSize) {
      const chunk = invoices.slice(i, i + chunkSize);
      await queryInterface.bulkInsert('fee_invoices', chunk);
    }
    
    // We need to reset the ID sequence for PostgreSQL after manual ID insertion
    await queryInterface.sequelize.query(`SELECT setval('fee_invoices_id_seq', (SELECT MAX(id) FROM fee_invoices))`);

    for (let i = 0; i < payments.length; i += chunkSize) {
      const chunk = payments.slice(i, i + chunkSize);
      await queryInterface.bulkInsert('fee_payments', chunk);
    }

    console.log(`Successfully generated ${invoices.length} invoices and recorded ${payments.length} payments.`);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('fee_payments', null, {});
    await queryInterface.bulkDelete('fee_invoices', null, {});
    await queryInterface.bulkDelete('fee_structures', null, {});
  }
};
