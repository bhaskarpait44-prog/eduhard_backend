'use strict';

const bcrypt = require('bcryptjs');

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const schoolId = 1;
    const sessionId = 1;

    const teacherNames = [
      { first: 'Amit', last: 'Sharma', gender: 'male', dept: 'Mathematics', deg: 'Senior PGT' },
      { first: 'Priya', last: 'Singh', gender: 'female', dept: 'English', deg: 'TGT' },
      { first: 'Rajesh', last: 'Kumar', gender: 'male', dept: 'Science', deg: 'PGT' },
      { first: 'Sunita', last: 'Verma', gender: 'female', dept: 'Social Science', deg: 'TGT' },
      { first: 'Vikram', last: 'Patel', gender: 'male', dept: 'Computer Science', deg: 'Head of IT' },
      { first: 'Anjali', last: 'Desai', gender: 'female', dept: 'Hindi', deg: 'TGT' },
      { first: 'Suresh', last: 'Rao', gender: 'male', dept: 'Physics', deg: 'Senior PGT' },
      { first: 'Kavita', last: 'Joshi', gender: 'female', dept: 'Chemistry', deg: 'PGT' },
      { first: 'Manoj', last: 'Gupta', gender: 'male', dept: 'Biology', deg: 'PGT' },
      { first: 'Deepa', last: 'Nair', gender: 'female', dept: 'Economics', deg: 'PGT' },
      { first: 'Sanjay', last: 'Iyer', gender: 'male', dept: 'Commerce', deg: 'Senior PGT' },
      { first: 'Ritu', last: 'Mehta', gender: 'female', dept: 'History', deg: 'TGT' },
      { first: 'Rahul', last: 'Thakur', gender: 'male', dept: 'Physical Education', deg: 'Coach' },
      { first: 'Sneha', last: 'Kulkarni', gender: 'female', dept: 'Primary Education', deg: 'PRT' },
      { first: 'Alok', last: 'Mishra', gender: 'male', dept: 'Primary Education', deg: 'PRT' },
      { first: 'Neelam', last: 'Pandey', gender: 'female', dept: 'Mathematics', deg: 'TGT' },
      { first: 'Gaurav', last: 'Saini', gender: 'male', dept: 'Science', deg: 'TGT' },
      { first: 'Swati', last: 'Bose', gender: 'female', dept: 'English', deg: 'PGT' },
      { first: 'Harish', last: 'Pal', gender: 'male', dept: 'Geography', deg: 'TGT' },
      { first: 'Meena', last: 'Chatterjee', gender: 'female', dept: 'Sociology', deg: 'PGT' },
      { first: 'Rohan', last: 'Dutta', gender: 'male', dept: 'Computer Science', deg: 'TGT' },
      { first: 'Aruna', last: 'Vyas', gender: 'female', dept: 'Hindi', deg: 'PGT' },
      { first: 'Nitin', last: 'Jain', gender: 'male', dept: 'Commerce', deg: 'PGT' },
      { first: 'Pooja', last: 'Agarwal', gender: 'female', dept: 'Mathematics', deg: 'PRT' },
      { first: 'Sameer', last: 'Lodhi', gender: 'male', dept: 'Science', deg: 'PRT' },
      { first: 'Kiran', last: 'Maurya', gender: 'female', dept: 'Social Science', deg: 'PRT' },
      { first: 'Vivek', last: 'Rajput', gender: 'male', dept: 'English', deg: 'PRT' },
      { first: 'Madhu', last: 'Bisht', gender: 'female', dept: 'Arts', deg: 'Instructor' },
      { first: 'Abhishek', last: 'Rawat', gender: 'male', dept: 'Mathematics', deg: 'TGT' },
      { first: 'Shalini', last: 'Tomar', gender: 'female', dept: 'Science', deg: 'PGT' },
      { first: 'Pankaj', last: 'Negi', gender: 'male', dept: 'English', deg: 'TGT' },
      { first: 'Rashmi', last: 'Tiwari', gender: 'female', dept: 'Primary Education', deg: 'Headmistress' },
      { first: 'Varun', last: 'Shukla', gender: 'male', dept: 'Physics', deg: 'PGT' },
      { first: 'Geeta', last: 'Dubey', gender: 'female', dept: 'Chemistry', deg: 'PGT' },
      { first: 'Tarun', last: 'Panwar', gender: 'male', dept: 'Biology', deg: 'PGT' },
      { first: 'Anita', last: 'Chauhan', gender: 'female', dept: 'Accountancy', deg: 'PGT' },
      { first: 'Inder', last: 'Gehlot', gender: 'male', dept: 'Business Studies', deg: 'PGT' },
      { first: 'Kusum', last: 'Rathore', gender: 'female', dept: 'Political Science', deg: 'PGT' },
      { first: 'Yogesh', last: 'Dwivedi', gender: 'male', dept: 'Mathematics', deg: 'PGT' },
      { first: 'Bhavna', last: 'Baghel', gender: 'female', dept: 'English', deg: 'Senior TGT' }
    ];

    const passwordHash = await bcrypt.hash('Teacher@123', 10);
    const teachersData = teacherNames.map((t, i) => ({
      school_id: schoolId,
      first_name: t.first,
      last_name: t.last,
      email: `${t.first.toLowerCase()}.${t.last.toLowerCase()}@edu-example.com`,
      phone: `98765${String(i).padStart(5, '0')}`,
      password_hash: passwordHash,
      gender: t.gender,
      department: t.dept,
      designation: t.deg,
      employee_id: `EMP-${now.getFullYear()}-${String(i + 1).padStart(3, '0')}`,
      joining_date: '2020-01-01',
      highest_qualification: t.deg.includes('PGT') ? 'M.Sc, B.Ed' : 'B.Sc, B.Ed',
      years_of_experience: (Math.random() * 15 + 2).toFixed(1),
      is_active: true,
      created_at: now,
      updated_at: now
    }));

    await queryInterface.bulkInsert('teachers', teachersData);

    // Fetch teachers, classes, sections, and subjects
    const [teachers] = await queryInterface.sequelize.query(`SELECT id, department FROM teachers WHERE school_id = ${schoolId}`);
    const [classes] = await queryInterface.sequelize.query(`SELECT id, name, stream FROM classes WHERE school_id = ${schoolId}`);
    const [sections] = await queryInterface.sequelize.query(`SELECT id, class_id FROM sections WHERE name = 'A'`);
    const [subjects] = await queryInterface.sequelize.query(`SELECT id, class_id, name FROM subjects`);

    const assignments = [];

    // 1. Assign Class Teachers (One for each of the 18 classes)
    classes.forEach((cls, i) => {
      const section = sections.find(s => s.class_id === cls.id);
      const teacher = teachers[i % teachers.length]; // Cycle through teachers
      if (section) {
        assignments.push({
          session_id: sessionId,
          teacher_id: teacher.id,
          class_id: cls.id,
          section_id: section.id,
          subject_id: null,
          is_class_teacher: true,
          created_at: now,
          updated_at: now
        });
      }
    });

    // 2. Assign Subject Teachers
    // This logic maps departments to subjects roughly
    const deptMap = {
      'Mathematics': ['Mathematics'],
      'English': ['English', 'English Oral', 'English Writing', 'Rhymes'],
      'Science': ['Science', 'Physics', 'Chemistry', 'Biology'],
      'Social Science': ['Social Science', 'History', 'Geography', 'Political Science', 'Sociology'],
      'Computer Science': ['Computer', 'Computer Science'],
      'Hindi': ['Hindi'],
      'Commerce': ['Accountancy', 'Business Studies', 'Economics'],
      'Primary Education': ['English', 'Mathematics', 'Science', 'Drawing'],
      'Physics': ['Physics'],
      'Chemistry': ['Chemistry'],
      'Biology': ['Biology'],
      'Economics': ['Economics'],
      'Accountancy': ['Accountancy'],
      'Business Studies': ['Business Studies'],
      'History': ['History'],
      'Geography': ['Geography'],
      'Political Science': ['Political Science'],
      'Sociology': ['Sociology'],
      'Arts': ['Drawing']
    };

    subjects.forEach(sub => {
      const section = sections.find(s => s.class_id === sub.class_id);
      if (!section) return;

      // Find a teacher in the right department
      const matchingTeachers = teachers.filter(t => {
        const allowedSubjects = deptMap[t.department] || [];
        return allowedSubjects.includes(sub.name);
      });

      const teacher = matchingTeachers.length > 0 
        ? matchingTeachers[Math.floor(Math.random() * matchingTeachers.length)]
        : teachers[Math.floor(Math.random() * teachers.length)]; // Fallback

      assignments.push({
        session_id: sessionId,
        teacher_id: teacher.id,
        class_id: sub.class_id,
        section_id: section.id,
        subject_id: sub.id,
        is_class_teacher: false,
        created_at: now,
        updated_at: now
      });
    });

    await queryInterface.bulkInsert('teacher_assignments', assignments, { ignoreDuplicates: true });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('teacher_assignments', null, {});
    await queryInterface.bulkDelete('teachers', null, {});
  }
};
