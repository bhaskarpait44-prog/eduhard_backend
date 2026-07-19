'use strict';

const bcrypt = require('bcryptjs');

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const hash = await bcrypt.hash('Staff@1234', 12);

    // 1. Retrieve default school and admin
    const [schools] = await queryInterface.sequelize.query(
      `SELECT id FROM schools LIMIT 1;`
    );
    if (schools.length === 0) {
      throw new Error('Please run school-and-admin seeder first!');
    }
    const schoolId = schools[0].id;

    const [admins] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1;`
    );
    if (admins.length === 0) {
      throw new Error('Please run school-and-admin seeder first!');
    }
    const adminId = admins[0].id;

    // 2. Seed auxiliary staff users if they do not exist
    const staffRoles = [
      { name: 'Jyoti Borah', email: 'receptionist@greenwoodacademy.edu.in', role: 'receptionist' },
      { name: 'Mukesh Das', email: 'accountant@greenwoodacademy.edu.in', role: 'accountant' },
      { name: 'Nayan Saikia', email: 'librarian@greenwoodacademy.edu.in', role: 'librarian' },
      { name: 'Priya Gogoi', email: 'staff@greenwoodacademy.edu.in', role: 'staff' }
    ];

    for (const staff of staffRoles) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM users WHERE email = :email LIMIT 1;`,
        { replacements: { email: staff.email } }
      );
      if (existing.length === 0) {
        await queryInterface.bulkInsert('users', [{
          school_id: schoolId,
          name: staff.name,
          email: staff.email,
          password_hash: hash,
          role: staff.role,
          is_active: true,
          created_at: now,
          updated_at: now
        }]);
      }
    }

    // Fetch all user IDs for submitting feedback
    const [users] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE school_id = :schoolId;`,
      { replacements: { schoolId } }
    );
    const userIds = users.map(u => u.id);

    // 3. Clear existing feedback
    await queryInterface.sequelize.query(`DELETE FROM feedback;`);

    // 4. Generate 100 feedbacks
    const feedbackTemplates = [
      { type: 'feedback', subject: 'Smartboard performance', message: 'The interactive smartboard installation in secondary classes has made lessons very engaging.' },
      { type: 'feedback', subject: 'New reference books in library', message: 'Excellent addition of competitive exam preparation books in the library. Highly appreciated.' },
      { type: 'feedback', subject: 'Sports day arrangements', message: 'The annual sports day was perfectly planned and executed. Kids had a wonderful time.' },
      { type: 'feedback', subject: 'Canteen menu variety', message: 'Thanks for adding fresh fruit options to the canteen menu. It is much healthier.' },
      { type: 'feedback', subject: 'Science lab equipment', message: 'The chemistry lab has been upgraded with new beakers and safety equipment. Thank you!' },
      { type: 'complaint', subject: 'Wi-Fi connectivity issues', message: 'Wi-Fi in the staff room is extremely unstable and drops connection frequently.' },
      { type: 'complaint', subject: 'Water dispenser leakage', message: 'The drinking water unit in Block B has a small leak, making the corridor floor slippery.' },
      { type: 'complaint', subject: 'AC cooling issue', message: 'The air conditioning in the main computer lab is blowing warm air. Please check it.' },
      { type: 'complaint', subject: 'Bus Route 4 delays', message: 'School bus number 4 is consistently running 10-15 minutes late in the mornings.' },
      { type: 'complaint', subject: 'Library silent zone', message: 'Some students are using laptops in the reading section with sound on. Request strict silent zone enforcement.' }
    ];

    const statuses = ['open', 'in-progress', 'resolved'];
    const adminReplies = [
      'Thank you for your feedback. We are constantly striving to improve campus services.',
      'We have received this complaint. The facilities management team is inspecting the issue.',
      'This has been successfully resolved. Thank you for bringing it to our attention.',
      'Action has been taken. The vendor has completed the repair work.'
    ];

    const feedbacks = [];
    for (let i = 1; i <= 100; i++) {
      const template = feedbackTemplates[(i - 1) % feedbackTemplates.length];
      const status = statuses[i % statuses.length];
      
      const isResolvedOrInProg = status !== 'open';
      const reply = isResolvedOrInProg ? adminReplies[i % adminReplies.length] : null;
      const repliedBy = isResolvedOrInProg ? adminId : null;
      const repliedAt = isResolvedOrInProg ? now : null;

      feedbacks.push({
        school_id: schoolId,
        user_id: userIds[i % userIds.length],
        type: template.type,
        subject: `${template.subject} #${i}`,
        message: `${template.message} [Ticket reference #${1000 + i}]`,
        status: status,
        admin_reply: reply,
        replied_by: repliedBy,
        replied_at: repliedAt,
        created_at: now,
        updated_at: now
      });
    }

    await queryInterface.bulkInsert('feedback', feedbacks);
    console.log(`Seeded 100 feedback/complaint records successfully!`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DELETE FROM feedback;');
  }
};
