'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const schoolId = 1;

    // Fetch an admin user
    const [[admin]] = await queryInterface.sequelize.query(`
      SELECT id FROM users WHERE school_id = ${schoolId} AND role = 'admin' LIMIT 1
    `);
    const adminId = admin ? admin.id : null;

    // Fetch some classes and sections for targeting
    const [classes] = await queryInterface.sequelize.query(`SELECT id FROM classes WHERE school_id = ${schoolId} LIMIT 5`);
    const [sections] = await queryInterface.sequelize.query(`SELECT id FROM sections LIMIT 5`);

    const notices = [];
    const categories = ['school_wide', 'class', 'section', 'teachers', 'parents'];
    const priorities = ['normal', 'urgent', 'info'];

    const titles = [
      'Annual Sports Day', 'Parent Teacher Meeting', 'Holiday Notice', 'Exam Schedule Released',
      'New Library Rules', 'Fee Payment Deadline', 'Science Fair 2026', 'Inter-School Debate',
      'Uniform Change Update', 'Canteen Menu Update', 'Winter Vacation', 'Summer Camp Registration',
      'Workshop for Teachers', 'National Holiday', 'Internal Assessment', 'Admissions Open'
    ];

    const bodies = [
      'Please take note of the upcoming event scheduled for next week.',
      'All students are required to attend the assembly in full uniform.',
      'The results for the last assessment have been uploaded to the portal.',
      'Important update regarding the school timings starting from Monday.',
      'We are pleased to announce the winners of the recently held competition.',
      'A gentle reminder to clear any outstanding dues by the end of this month.',
      'The school will remain closed tomorrow due to unforeseen circumstances.',
      'Guidelines for the final projects have been shared with the class teachers.',
      'Congratulations to our students for their exceptional performance in sports.',
      'New safety protocols have been implemented across the school campus.'
    ];

    for (let i = 1; i <= 100; i++) {
      const audience = categories[Math.floor(Math.random() * categories.length)];
      const priority = priorities[Math.floor(Math.random() * priorities.length)];
      const title = `${titles[i % titles.length]} - ${i}`;
      const body = `${bodies[i % bodies.length]} This is notice number ${i} of 100 created for testing purposes.`;

      notices.push({
        school_id: schoolId,
        title: title,
        body: body,
        posted_by_user_id: adminId,
        posted_by_role: 'admin',
        audience: audience,
        priority: priority,
        target_class_id: audience === 'class' ? classes[Math.floor(Math.random() * classes.length)].id : null,
        target_section_id: audience === 'section' ? sections[Math.floor(Math.random() * sections.length)].id : null,
        is_school_wide: audience === 'school_wide',
        is_deleted: false,
        created_at: new Date(now.getTime() - (i * 3600000)), // Spread them out over the last few days
        updated_at: new Date(now.getTime() - (i * 3600000)),
      });
    }

    await queryInterface.bulkInsert('notices', notices);
    console.log('Generated 100 admin notices.');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('notices', { posted_by_role: 'admin' }, {});
  }
};
