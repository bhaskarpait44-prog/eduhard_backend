'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // 1. Retrieve default school, session, and admin user
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

    // 2. Fetch other related models for targeting
    const [classes] = await queryInterface.sequelize.query(`SELECT id, name FROM classes;`);
    const [sections] = await queryInterface.sequelize.query(`SELECT id, name FROM sections;`);
    const [students] = await queryInterface.sequelize.query(`SELECT id, first_name, last_name FROM students WHERE status = 'active';`);
    const [teachers] = await queryInterface.sequelize.query(`SELECT id, first_name, last_name FROM teachers;`);
    const [subjects] = await queryInterface.sequelize.query(`SELECT id, name FROM subjects;`);

    // 3. Clear existing notices and pins/interactions
    await queryInterface.sequelize.query(`DELETE FROM notice_pins;`);
    await queryInterface.sequelize.query(`DELETE FROM notices;`);

    // 4. Define audiences
    const audiences = [
      'school_wide',
      'class',
      'section',
      'student',
      'teachers',
      'parents',
      'accountants',
      'librarians',
      'receptionists',
      'specific_teacher',
      'subject_wise'
    ];

    const templates = {
      school_wide: [
        { title: 'Annual Day Celebrations 2026', body: 'The school annual day celebrations will be held on December 15th. All students must participate.' },
        { title: 'Summer Vacation Announcement', body: 'The school will remain closed for summer vacation starting from June 1st to June 30th. School reopens on July 1st.' },
        { title: 'School Fee Policy Update', body: 'Please note the deadline for Q2 tuition fee payment is August 10th. Late fees will apply thereafter.' },
        { title: 'Independence Day Program', body: 'Join us for the flag hoisting ceremony on August 15th at 8:30 AM in the school main ground.' }
      ],
      class: [
        { title: 'Unit Test Syllabus', body: 'The syllabus for the upcoming Unit Test 1 has been uploaded under materials. Please check and prepare.' },
        { title: 'Class Project Submission', body: 'The submission deadline for the class Science/Social Science project is next Friday.' },
        { title: 'Extra Remedial Class Schedule', body: 'An extra remedial class is scheduled this Saturday from 9:00 AM to 11:00 AM for weak students.' }
      ],
      section: [
        { title: 'Section Class Representative Election', body: 'Elections for the class/section representative will take place this Wednesday during home-room period.' },
        { title: 'Special Cleanliness Drive', body: 'Our section will be participating in the campus cleanliness drive this Friday afternoon.' }
      ],
      student: [
        { title: 'Disciplinary Warning Notice', body: 'This is an individual warning regarding continuous late attendance and uniform dress code violation.' },
        { title: 'Outstanding Achievement Congratulation', body: 'Congratulations on winning the Inter-School Debate competition! The school is proud of your success.' }
      ],
      teachers: [
        { title: 'Monthly Faculty Meeting', body: 'The monthly faculty staff meeting is scheduled for next Monday at 2:00 PM in the Conference Hall.' },
        { title: 'Lesson Plan Submission Deadline', body: 'All teachers must submit their weekly lesson plans for next month by this Friday afternoon.' }
      ],
      parents: [
        { title: 'Parent-Teacher Meeting (PTM)', body: 'The PTM for the first term is scheduled this Saturday from 9:30 AM to 1:00 PM. Parents presence is mandatory.' },
        { title: 'Vaccination Drive Consent Form', body: 'A medical vaccination drive is scheduled in campus next week. Please sign and return the consent form.' }
      ],
      accountants: [
        { title: 'Q1 Financial Audit Preparation', body: 'Please keep all fee collection logs, expense vouchers, and bank statements ready for the internal audit.' },
        { title: 'Salary Disbursement Approvals', body: 'The payroll lists for the staff have been prepared. Please reconcile and disburse by the 1st.' }
      ],
      librarians: [
        { title: 'Annual Library Book Stock Audit', body: 'Please initiate the stock verification process for all books and submit the audit report next month.' },
        { title: 'New Reference Books Procurement', body: 'The budget for purchasing Class 10/12 reference books has been approved. Please place the order.' }
      ],
      receptionists: [
        { title: 'Visitor Log Management Guidelines', body: 'Please ensure all visitors enter their details and contact purposes in the digital guest log without fail.' },
        { title: 'Front Office Maintenance', body: 'The reception area must remain neat and clean. Ensure all school brochures are well-arranged.' }
      ],
      specific_teacher: [
        { title: 'Appointed as Examination Invigilator', body: 'You have been assigned as the chief coordinator/invigilator for the upcoming Board Practical Exams.' },
        { title: 'Staff Performance Appraisal Review', body: 'Your annual appraisal meeting is scheduled with the Principal tomorrow at 11:00 AM.' }
      ],
      subject_wise: [
        { title: 'Science Lab Practical Schedule', body: 'The chemistry/physics practical examinations schedule has been uploaded. Check your batch timings.' },
        { title: 'Maths Olympiad Registrations Open', body: 'Registration forms for the National Mathematics Olympiad are available with subject teachers. Apply before the 15th.' }
      ]
    };

    console.log(`Generating 40 target-rich notices from Admin...`);

    const notices = [];

    for (let i = 1; i <= 40; i++) {
      const audience = audiences[(i - 1) % audiences.length];
      const templateList = templates[audience];
      const temp = templateList[(i - 1) % templateList.length];

      // Distribute date from April 1 to July 19
      const noticeDate = new Date('2026-04-01');
      noticeDate.setDate(noticeDate.getDate() + Math.floor((i - 1) * 2.7));
      
      const expiryDate = new Date(noticeDate);
      expiryDate.setDate(expiryDate.getDate() + 30); // expires in 30 days

      let targetClassId = null;
      let targetSectionId = null;
      let targetStudentId = null;
      let targetTeacherId = null;
      let targetSubjectId = null;
      let isSchoolWide = false;

      if (audience === 'school_wide') {
        isSchoolWide = true;
      } else if (audience === 'class') {
        targetClassId = classes[i % classes.length].id;
      } else if (audience === 'section') {
        targetSectionId = sections[i % sections.length].id;
      } else if (audience === 'student') {
        targetStudentId = students[i % students.length].id;
      } else if (audience === 'specific_teacher') {
        targetTeacherId = teachers[i % teachers.length].id;
      } else if (audience === 'subject_wise') {
        targetSubjectId = subjects[i % subjects.length].id;
      }

      notices.push({
        school_id: schoolId,
        title: `${temp.title} (#${i})`,
        body: `${temp.body} [Reference Admin Notice No. ADM-2026-N${100 + i}]`,
        posted_by_user_id: adminId,
        posted_by_role: 'admin',
        audience: audience,
        target_class_id: targetClassId,
        target_section_id: targetSectionId,
        target_student_id: targetStudentId,
        target_teacher_id: targetTeacherId,
        target_subject_id: targetSubjectId,
        is_school_wide: isSchoolWide,
        priority: i % 3 === 0 ? 'urgent' : (i % 3 === 1 ? 'info' : 'normal'),
        expires_at: expiryDate,
        is_deleted: false,
        created_at: noticeDate,
        updated_at: noticeDate
      });
    }

    await queryInterface.bulkInsert('notices', notices);
    console.log(`Seeded 40 administrative notices successfully!`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DELETE FROM notice_pins;`);
    await queryInterface.sequelize.query('DELETE FROM notices;');
  }
};
