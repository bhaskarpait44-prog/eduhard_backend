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

    // 2. Fetch some teachers
    const [teachers] = await queryInterface.sequelize.query(
      `SELECT id, first_name, last_name, phone, email, address, highest_qualification, years_of_experience FROM teachers WHERE is_deleted = false ORDER BY id ASC LIMIT 10;`
    );
    if (teachers.length === 0) {
      throw new Error('Please run teachers seeder first!');
    }

    // 3. Clear existing profile correction requests
    await queryInterface.sequelize.query(`DELETE FROM profile_correction_requests;`);

    // 4. Create mock correction requests
    const requests = [];

    // Teacher 0: Phone number correction (Pending)
    if (teachers[0]) {
      requests.push({
        user_id: null,
        teacher_id: teachers[0].id,
        field_name: 'phone',
        current_value: teachers[0].phone,
        requested_value: '9864' + Math.floor(600000 + Math.random() * 300000),
        reason: 'My older phone number is deactivated, need to update to my new personal mobile number.',
        status: 'pending',
        reviewed_by: null,
        review_note: null,
        reviewed_at: null,
        created_at: now,
        updated_at: now
      });
    }

    // Teacher 1: Address change (Approved)
    if (teachers[1]) {
      requests.push({
        user_id: null,
        teacher_id: teachers[1].id,
        field_name: 'address',
        current_value: teachers[1].address,
        requested_value: 'House No. 104, Zoo Road Tiniali, Zoo Road, Guwahati, Assam - 781024',
        reason: 'Moved to a new permanent residence closer to the school.',
        status: 'approved',
        reviewed_by: adminId,
        review_note: 'Address details updated successfully in profile.',
        reviewed_at: now,
        created_at: now,
        updated_at: now
      });
    }

    // Teacher 2: Qualification correction (Approved)
    if (teachers[2]) {
      requests.push({
        user_id: null,
        teacher_id: teachers[2].id,
        field_name: 'highest_qualification',
        current_value: teachers[2].highest_qualification,
        requested_value: 'Ph.D. in Education Studies',
        reason: 'Completed and was awarded my doctorate degree this summer.',
        status: 'approved',
        reviewed_by: adminId,
        review_note: 'Verified doctoral degree certificate copy. Approved.',
        reviewed_at: now,
        created_at: now,
        updated_at: now
      });
    }

    // Teacher 3: Experience change (Pending)
    if (teachers[3]) {
      requests.push({
        user_id: null,
        teacher_id: teachers[3].id,
        field_name: 'years_of_experience',
        current_value: teachers[3].years_of_experience ? teachers[3].years_of_experience.toString() : '5.5',
        requested_value: '8.5',
        reason: 'Adding 3 years of previous teaching experience from Little Flower School, Dibrugarh.',
        status: 'pending',
        reviewed_by: null,
        review_note: null,
        reviewed_at: null,
        created_at: now,
        updated_at: now
      });
    }

    // Teacher 4: Personal email usage (Rejected)
    if (teachers[4]) {
      requests.push({
        user_id: null,
        teacher_id: teachers[4].id,
        field_name: 'email',
        current_value: teachers[4].email,
        requested_value: `${teachers[4].first_name.toLowerCase()}.personal@gmail.com`,
        reason: 'I want to receive all school-related updates on my personal Gmail address instead of the official school domain.',
        status: 'rejected',
        reviewed_by: adminId,
        review_note: 'School policy mandates official communication to only occur on the greenwoodacademy.edu.in domain. Personal emails cannot be used as primary email.',
        reviewed_at: now,
        created_at: now,
        updated_at: now
      });
    }

    // Teacher 5: Last name change after marriage (Pending)
    if (teachers[5]) {
      requests.push({
        user_id: null,
        teacher_id: teachers[5].id,
        field_name: 'last_name',
        current_value: teachers[5].last_name,
        requested_value: 'Sharma-Barua',
        reason: 'Change in last name due to legal surname modification post-marriage.',
        status: 'pending',
        reviewed_by: null,
        review_note: null,
        reviewed_at: null,
        created_at: now,
        updated_at: now
      });
    }

    await queryInterface.bulkInsert('profile_correction_requests', requests);
    console.log(`Seeded ${requests.length} teacher profile correction requests successfully!`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DELETE FROM profile_correction_requests;');
  }
};
