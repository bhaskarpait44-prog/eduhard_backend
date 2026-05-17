'use strict';

const bcrypt = require('bcryptjs');

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const passwordHash = await bcrypt.hash('Student@1234', 12);
    
    const firstNames = ['Amit', 'Rahul', 'Sneha', 'Anjali', 'Deepak', 'Pooja', 'Rohan', 'Simran', 'Karan', 'Ishita', 'Manoj', 'Neeta', 'Suresh', 'Kavita', 'Vijay', 'Maya', 'Arjun', 'Sonia', 'Ravi', 'Preeti'];
    const lastNames = ['Verma', 'Gupta', 'Mehta', 'Joshi', 'Choudhury', 'Borah', 'Saikia', 'Talukdar', 'Kalita', 'Deka'];

    const students = [];
    const profiles = [];
    const enrollments = [];
    let studentId = 1;

    for (let classId = 1; classId <= 4; classId++) {
      const className = classId === 1 ? '9' : classId === 2 ? '10' : classId === 3 ? '11' : '12';
      const stream = (classId === 3 || classId === 4) ? 'science' : 'regular';

      for (let j = 1; j <= 5; j++) {
        const fName = firstNames[(studentId - 1) % firstNames.length];
        const lName = lastNames[(studentId - 1) % lastNames.length];
        const admissionNo = `2024${className}A0${j}`;
        
        students.push({
          id: studentId,
          school_id: 1,
          admission_no: admissionNo,
          first_name: fName,
          last_name: lName,
          password_hash: passwordHash,
          gender: j % 2 === 0 ? 'female' : 'male',
          date_of_birth: '2010-05-15',
          is_active: true,
          created_at: now,
          updated_at: now
        });

        profiles.push({
          student_id: studentId,
          address: 'Guwahati, Assam',
          city: 'Guwahati',
          state: 'Assam',
          pincode: '781001',
          phone: `9954000${studentId}`,
          email: `${fName.toLowerCase()}.${lName.toLowerCase()}@student.edu.in`,
          father_name: `${lName} Senior`,
          mother_name: `Mrs. ${lName}`,
          blood_group: 'O+',
          valid_from: '2024-04-01',
          is_current: true,
          created_at: now
        });

        enrollments.push({
          student_id: studentId,
          session_id: 1,
          class_id: classId,
          section_id: classId, // Section A of each class has same ID as class in my seeder
          roll_number: j,
          stream: stream,
          joining_type: 'fresh',
          status: 'active',
          joined_date: '2024-04-01',
          created_at: now,
          updated_at: now
        });

        studentId++;
      }
    }

    await queryInterface.bulkInsert('students', students, { ignoreDuplicates: true });
    await queryInterface.bulkInsert('student_profiles', profiles, { ignoreDuplicates: true });
    await queryInterface.bulkInsert('enrollments', enrollments, { ignoreDuplicates: true });
  },

  async down(queryInterface) {
    // Disable trigger to allow deletion for seeder reversal
    await queryInterface.sequelize.query(`ALTER TABLE student_profiles DISABLE TRIGGER trg_student_profiles_guard`);
    
    await queryInterface.bulkDelete('enrollments', null, {});
    await queryInterface.bulkDelete('student_profiles', null, {});
    await queryInterface.bulkDelete('students', null, {});

    // Re-enable trigger
    await queryInterface.sequelize.query(`ALTER TABLE student_profiles ENABLE TRIGGER trg_student_profiles_guard`);
  }
};
