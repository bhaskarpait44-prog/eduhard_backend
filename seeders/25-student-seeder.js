'use strict';

const bcrypt = require('bcryptjs');

/**
 * Student Seeder
 * Creates 30 students per class for School ID 1.
 * Links students to sections, sessions, and creates their profiles.
 */

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const schoolId = 1;
    const sessionId = 1;
    const passwordHash = await bcrypt.hash('student123', 10);

    // 1. Fetch all classes for the school
    const [classes] = await queryInterface.sequelize.query(
      `SELECT id, name, stream FROM classes WHERE school_id = ${schoolId} AND is_deleted = false`
    );

    if (classes.length === 0) {
      console.log('No classes found. Please run class seeder first.');
      return;
    }

    // 2. Fetch all sections for these classes
    const [sections] = await queryInterface.sequelize.query(
      `SELECT id, class_id, name FROM sections WHERE is_deleted = false`
    );

    const firstNames = [
      'Aarav', 'Aryan', 'Advait', 'Ishaan', 'Vihaan', 'Arjun', 'Kabir', 'Rohan', 'Aditya', 'Vivaan',
      'Ananya', 'Diya', 'Ishani', 'Myra', 'Navya', 'Saanvi', 'Siya', 'Zara', 'Kiara', 'Aavya',
      'Amit', 'Rahul', 'Sanjay', 'Vikram', 'Priya', 'Neha', 'Sneha', 'Anjali', 'Karan', 'Simran',
      'Arnav', 'Dev', 'Kabir', 'Moksh', 'Om', 'Pranav', 'Rishi', 'Shiv', 'Tanmay', 'Utkarsh'
    ];
    const lastNames = [
      'Sharma', 'Verma', 'Gupta', 'Singh', 'Kumar', 'Jain', 'Mehta', 'Shah', 'Patel', 'Reddy',
      'Nair', 'Iyer', 'Das', 'Banerjee', 'Chatterjee', 'Mishra', 'Pandey', 'Yadav', 'Choudhury', 'Goswami',
      'Bhatt', 'Thakur', 'Joshi', 'Kulkarni', 'Deshmukh', 'Patil', 'Bose', 'Dutta', 'Sarma', 'Barua'
    ];

    const studentsToInsert = [];
    
    // We'll generate students for all classes
    for (const cls of classes) {
      const classSections = sections.filter(s => s.class_id === cls.id);
      if (classSections.length === 0) continue;

      for (let i = 1; i <= 30; i++) {
        const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
        const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
        // Admission number format: ADM/YEAR/CLASS/INDEX
        const admissionNo = `ADM/2026/${cls.name.replace(/\s+/g, '').toUpperCase()}/${String(i).padStart(3, '0')}`;
        const gender = Math.random() > 0.5 ? 'male' : 'female';
        
        // Birth year based on class (assuming Class 1 is ~6 years old)
        // LKG(1), UKG(2), Class 1(3), ..., Class 12(14)
        // Let's use order_number if available, otherwise estimate
        const classLevel = parseInt(cls.name.match(/\d+/) || [0])[0];
        let birthYear = 2026 - (6 + (classLevel || 0));
        if (cls.name === 'LKG') birthYear = 2022;
        if (cls.name === 'UKG') birthYear = 2021;
        
        const dob = new Date(birthYear, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1);

        studentsToInsert.push({
          school_id: schoolId,
          admission_no: admissionNo,
          first_name: firstName,
          last_name: lastName,
          date_of_birth: dob.toISOString().slice(0, 10),
          gender: gender,
          password_hash: passwordHash,
          is_active: true,
          is_deleted: false,
          created_at: now,
          updated_at: now
        });
      }
    }

    console.log(`Inserting ${studentsToInsert.length} students...`);
    
    // Using a transaction to ensure everything is linked correctly
    await queryInterface.sequelize.transaction(async (t) => {
      // Insert students
      await queryInterface.bulkInsert('students', studentsToInsert, { transaction: t, ignoreDuplicates: true });

      // Fetch the inserted students to get their IDs
      const [insertedStudents] = await queryInterface.sequelize.query(
        `SELECT id, admission_no FROM students WHERE school_id = ${schoolId} AND is_deleted = false`,
        { transaction: t }
      );

      const studentMap = new Map();
      insertedStudents.forEach(s => studentMap.set(s.admission_no, s.id));

      const enrollmentsToInsert = [];
      const profilesToInsert = [];

      for (const cls of classes) {
        const classSections = sections.filter(s => s.class_id === cls.id);
        if (classSections.length === 0) continue;

        for (let i = 1; i <= 30; i++) {
          const section = classSections[(i - 1) % classSections.length];
          const admissionNo = `ADM/2026/${cls.name.replace(/\s+/g, '').toUpperCase()}/${String(i).padStart(3, '0')}`;
          const studentId = studentMap.get(admissionNo);

          if (!studentId) continue;

          enrollmentsToInsert.push({
            student_id: studentId,
            session_id: sessionId,
            class_id: cls.id,
            section_id: section.id,
            stream: cls.stream === 'regular' ? null : cls.stream,
            roll_number: String(i).padStart(2, '0'),
            joined_date: '2026-04-01',
            joining_type: 'fresh',
            status: 'active',
            created_at: now,
            updated_at: now
          });

          profilesToInsert.push({
            student_id: studentId,
            address: `${Math.floor(Math.random() * 100) + 1}, Greenland Colony`,
            city: 'Guwahati',
            state: 'Assam',
            pincode: '781001',
            phone: '9864' + Math.floor(100000 + Math.random() * 900000),
            father_name: `Mr. ${lastNames[Math.floor(Math.random() * lastNames.length)]}`,
            mother_name: `Mrs. ${lastNames[Math.floor(Math.random() * lastNames.length)]}`,
            nationality: 'Indian',
            religion: 'Hindu',
            caste: ['Gen', 'OBC', 'SC', 'ST'][Math.floor(Math.random() * 4)],
            blood_group: ['A+', 'B+', 'O+', 'AB+'][Math.floor(Math.random() * 4)],
            valid_from: '2026-04-01',
            is_current: true,
            created_at: now
          });
        }
      }

      console.log(`Linking ${enrollmentsToInsert.length} enrollments and creating profiles...`);
      await queryInterface.bulkInsert('enrollments', enrollmentsToInsert, { transaction: t, ignoreDuplicates: true });
      await queryInterface.bulkInsert('student_profiles', profilesToInsert, { transaction: t, ignoreDuplicates: true });
    });

    console.log('Student seeding completed successfully.');
  },

  async down(queryInterface, Sequelize) {
    // Delete in reverse order of dependencies
    await queryInterface.bulkDelete('student_profiles', null, {});
    await queryInterface.bulkDelete('enrollments', null, {});
    await queryInterface.bulkDelete('students', null, {});
  }
};
