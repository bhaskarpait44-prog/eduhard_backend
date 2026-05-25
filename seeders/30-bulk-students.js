'use strict';

const bcrypt = require('bcryptjs');

module.exports = {
  async up(queryInterface, Sequelize) {
    const now = new Date();
    const schoolId = 1;
    const sessionId = 1; // From previous seeder

    const firstNamesMale = [
      'Aarav', 'Vihaan', 'Vivaan', 'Ansh', 'Ishaan', 'Arjun', 'Sai', 'Aditya', 'Krishna', 'Aryan',
      'Shaurya', 'Atharv', 'Reyansh', 'Ayush', 'Shivansh', 'Kabir', 'Dhruv', 'Rudra', 'Arav', 'Ritvik',
      'Yash', 'Veer', 'Parth', 'Vedant', 'Advait', 'Agastya', 'Akshat', 'Amol', 'Aniruddh', 'Ankit',
      'Arnav', 'Atiksh', 'Avi', 'Avyan', 'Ayaan', 'Bhuvan', 'Chaitanya', 'Daksh', 'Darsh', 'Dev',
      'Devansh', 'Divyansh', 'Ekansh', 'Gagan', 'Gaurav', 'Gautam', 'Hardik', 'Harsh', 'Hriday', 'Hridhaan'
    ];

    const firstNamesFemale = [
      'Saanvi', 'Aadya', 'Ananya', 'Diya', 'Pihu', 'Pari', 'Navya', 'Angel', 'Avni', 'Myra',
      'Ira', 'Aavya', 'Sana', 'Zara', 'Anvi', 'Aadhya', 'Aanya', 'Akshara', 'Amaira', 'Amrita',
      'Anahita', 'Anika', 'Anvi', 'Aradhya', 'Arya', 'Avni', 'Bhavna', 'Chhavi', 'Drishya', 'Esha',
      'Gargi', 'Gauri', 'Hazel', 'Himani', 'Inaya', 'Isha', 'Ishani', 'Jhanvi', 'Jhiya', 'Jivika',
      'Kavya', 'Keya', 'Khushi', 'Kiara', 'Kyra', 'Lavanya', 'Lekha', 'Lipi', 'Mahika', 'Manya'
    ];

    const lastNames = [
      'Sharma', 'Verma', 'Gupta', 'Singh', 'Kumar', 'Jain', 'Agarwal', 'Patel', 'Das', 'Dutta',
      'Roy', 'Bose', 'Chatterjee', 'Mukherjee', 'Nair', 'Iyer', 'Menon', 'Reddy', 'Rao', 'Kulkarni',
      'Joshi', 'Deshpande', 'Patil', 'More', 'Shinde', 'Yadav', 'Maurya', 'Kushwaha', 'Lodhi', 'Saini',
      'Pal', 'Chauhan', 'Rathore', 'Thakur', 'Rajput', 'Solanki', 'Gehlot', 'Panwar', 'Tomar', 'Parihar',
      'Baghel', 'Rawat', 'Bisht', 'Negi', 'Pandey', 'Mishra', 'Tiwari', 'Dubey', 'Shukla', 'Dwivedi'
    ];

    // Fetch classes and sections
    const [classes] = await queryInterface.sequelize.query(
      `SELECT id, name, stream FROM classes WHERE school_id = ${schoolId} AND is_deleted = false`
    );

    const [sections] = await queryInterface.sequelize.query(
      `SELECT id, class_id, name FROM sections WHERE class_id IN (${classes.map(c => c.id).join(',')}) AND is_deleted = false`
    );

    const passwordHash = await bcrypt.hash('Student@123', 10);
    
    let studentCounter = 1;
    const batchSize = 100;

    for (const cls of classes) {
      const section = sections.find(s => s.class_id === cls.id && s.name === 'A');
      if (!section) continue;

      console.log(`Generating 150 students for ${cls.name} (${cls.stream || 'regular'})...`);

      const studentsToInsert = [];
      const profilesToInsert = [];
      const enrollmentsToInsert = [];

      for (let i = 1; i <= 150; i++) {
        const isMale = Math.random() > 0.5;
        const firstName = isMale 
          ? firstNamesMale[Math.floor(Math.random() * firstNamesMale.length)]
          : firstNamesFemale[Math.floor(Math.random() * firstNamesFemale.length)];
        const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
        
        // Ensure some uniqueness by appending counter if needed, but with large list it's usually fine for demo
        const uniqueSuffix = `${studentCounter}`;
        const finalFirstName = firstName;
        const finalLastName = `${lastName} ${uniqueSuffix}`;
        
        const admissionNo = `ADM-${now.getFullYear()}-${String(studentCounter).padStart(5, '0')}`;
        const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${studentCounter}@edu-example.com`;

        studentsToInsert.push({
          school_id: schoolId,
          admission_no: admissionNo,
          first_name: finalFirstName,
          last_name: finalLastName,
          date_of_birth: new Date(now.getFullYear() - 10, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1).toISOString().slice(0, 10),
          gender: isMale ? 'male' : 'female',
          password_hash: passwordHash,
          is_active: true,
          created_at: now,
          updated_at: now
        });

        studentCounter++;
      }

      // Bulk Insert Students and get IDs
      // Using raw SQL for RETURNING to avoid Sequelize model overhead in seeder
      const [insertedStudents] = await queryInterface.sequelize.query(
        `INSERT INTO students (school_id, admission_no, first_name, last_name, date_of_birth, gender, password_hash, is_active, created_at, updated_at)
         VALUES ${studentsToInsert.map(s => `(${s.school_id}, '${s.admission_no}', '${s.first_name}', '${s.last_name}', '${s.date_of_birth}', '${s.gender}', '${s.password_hash}', ${s.is_active}, NOW(), NOW())`).join(',')}
         RETURNING id, admission_no`
      );

      insertedStudents.forEach((s, index) => {
        const studentData = studentsToInsert[index];
        const firstName = studentData.first_name;
        const lastName = studentData.last_name.split(' ')[0]; // Remove counter suffix for email prefix if desired
        const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${s.id}@edu-example.com`;

        profilesToInsert.push({
          student_id: s.id,
          address: 'Demo Street, Guwahati',
          city: 'Guwahati',
          state: 'Assam',
          pincode: '781001',
          phone: `9864${String(s.id).padStart(6, '0')}`,
          email: email,
          father_name: `Father of ${firstName}`,
          mother_name: `Mother of ${firstName}`,
          valid_from: now.toISOString().slice(0, 10),
          is_current: true,
          created_at: now
        });

        enrollmentsToInsert.push({
          student_id: s.id,
          session_id: sessionId,
          class_id: cls.id,
          section_id: section.id,
          roll_number: String(index + 1),
          stream: cls.stream,
          joined_date: now.toISOString().slice(0, 10),
          joining_type: 'fresh',
          status: 'active',
          created_at: now,
          updated_at: now
        });
      });

      // Bulk insert profiles and enrollments
      await queryInterface.bulkInsert('student_profiles', profilesToInsert);
      await queryInterface.bulkInsert('enrollments', enrollmentsToInsert);
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.bulkDelete('enrollments', null, {});
    await queryInterface.bulkDelete('student_profiles', null, {});
    await queryInterface.bulkDelete('students', null, {});
  }
};
