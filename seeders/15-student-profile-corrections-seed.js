'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // 1. Retrieve default admin user ID
    const [admins] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1;`
    );
    if (admins.length === 0) {
      throw new Error('Please run school-and-admin seeder first!');
    }
    const adminId = admins[0].id;

    // 2. Fetch some students
    const [students] = await queryInterface.sequelize.query(
      `SELECT id, first_name, last_name, aadhar_no FROM students WHERE is_deleted = false ORDER BY id ASC LIMIT 10;`
    );
    if (students.length === 0) {
      throw new Error('Please run students seeder first!');
    }

    // 3. Fetch father name of students from student profiles
    const [profiles] = await queryInterface.sequelize.query(
      `SELECT student_id, father_name, blood_group FROM student_profiles WHERE student_id IN (${students.map(s => s.id).join(',')});`
    );

    const profileMap = {};
    for (const p of profiles) {
      profileMap[p.student_id] = p;
    }

    // 4. Clear existing student correction requests
    await queryInterface.sequelize.query(`DELETE FROM student_correction_requests;`);

    // 5. Create mock correction requests
    const requests = [];

    // Student 0: Name correction (Pending)
    if (students[0]) {
      requests.push({
        student_id: students[0].id,
        field_name: 'first_name',
        current_value: students[0].first_name,
        requested_value: `${students[0].first_name} Kumar`,
        reason: 'Typo in original admission register, middle name Kumar was omitted.',
        supporting_document_path: `/uploads/documents/birth_cert_student_${students[0].id}.pdf`,
        status: 'pending',
        reviewed_by: null,
        admin_response: null,
        reviewed_at: null,
        created_at: now,
        updated_at: now
      });
    }

    // Student 1: Date of birth (Approved)
    if (students[1]) {
      requests.push({
        student_id: students[1].id,
        field_name: 'date_of_birth',
        current_value: '2015-05-12',
        requested_value: '2015-05-15',
        reason: 'Incorrect date of birth registered. My official birth certificate states May 15th.',
        supporting_document_path: `/uploads/documents/birth_cert_student_${students[1].id}.pdf`,
        status: 'approved',
        reviewed_by: adminId,
        admin_response: 'Birth certificate copy verified. Correct date of birth updated in records.',
        reviewed_at: now,
        created_at: now,
        updated_at: now
      });
    }

    // Student 2: Aadhaar Number correction (Approved)
    if (students[2]) {
      requests.push({
        student_id: students[2].id,
        field_name: 'aadhar_no',
        current_value: students[2].aadhar_no,
        requested_value: '5544 3322 ' + Math.floor(1000 + Math.random() * 9000),
        reason: 'Typo in last 4 digits of Aadhaar number during entry.',
        supporting_document_path: `/uploads/documents/aadhar_student_${students[2].id}.pdf`,
        status: 'approved',
        reviewed_by: adminId,
        admin_response: 'Aadhaar card scan verified. Corrected digits successfully.',
        reviewed_at: now,
        created_at: now,
        updated_at: now
      });
    }

    // Student 3: Father name prefix (Pending)
    if (students[3] && profileMap[students[3].id]) {
      requests.push({
        student_id: students[3].id,
        field_name: 'father_name',
        current_value: profileMap[students[3].id].father_name,
        requested_value: `Dr. ${profileMap[students[3].id].father_name}`,
        reason: 'Please add the title "Dr." to my father\'s name as he has completed his doctoral studies.',
        supporting_document_path: `/uploads/documents/degree_student_${students[3].id}.pdf`,
        status: 'pending',
        reviewed_by: null,
        admin_response: null,
        reviewed_at: null,
        created_at: now,
        updated_at: now
      });
    }

    // Student 4: Blood Group change (Rejected)
    if (students[4] && profileMap[students[4].id]) {
      requests.push({
        student_id: students[4].id,
        field_name: 'blood_group',
        current_value: profileMap[students[4].id].blood_group || 'O+',
        requested_value: 'AB-',
        reason: 'Initial medical check card was incorrect. Fresh lab tests show my blood group is AB-negative.',
        supporting_document_path: `/uploads/documents/lab_report_student_${students[4].id}.pdf`,
        status: 'rejected',
        reviewed_by: adminId,
        admin_response: 'The uploaded laboratory test report is missing a signature or stamp from a certified medical officer. Please submit a verified report.',
        reviewed_at: now,
        created_at: now,
        updated_at: now
      });
    }

    await queryInterface.bulkInsert('student_correction_requests', requests);
    console.log(`Seeded ${requests.length} student correction requests successfully!`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DELETE FROM student_correction_requests;');
  }
};
