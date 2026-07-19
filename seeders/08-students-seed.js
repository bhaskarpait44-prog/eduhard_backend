'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // 1. Retrieve foundation data
    const [schools] = await queryInterface.sequelize.query(
      `SELECT id FROM schools LIMIT 1;`
    );
    if (schools.length === 0) {
      throw new Error('Please run school-and-admin seeder first!');
    }
    const schoolId = schools[0].id;

    const [sessions] = await queryInterface.sequelize.query(
      `SELECT id FROM sessions ORDER BY id DESC LIMIT 1;`
    );
    if (sessions.length === 0) {
      throw new Error('Please run academic sessions seeder first!');
    }
    const sessionId = sessions[0].id;

    // 2. Fetch all classes and sections
    const [classes] = await queryInterface.sequelize.query(
      `SELECT id, name, stream FROM classes WHERE school_id = :schoolId AND is_deleted = false ORDER BY order_number ASC;`,
      { replacements: { schoolId } }
    );
    if (classes.length === 0) {
      throw new Error('Please run classes-sections-subjects seeder first!');
    }

    // 3. Clear existing student data to avoid duplicates/conflicts
    await queryInterface.sequelize.query(`ALTER TABLE student_profiles DISABLE TRIGGER ALL;`);
    await queryInterface.sequelize.query(`DELETE FROM enrollments;`);
    await queryInterface.sequelize.query(`DELETE FROM student_profiles;`);
    await queryInterface.sequelize.query(`DELETE FROM students;`);
    await queryInterface.sequelize.query(`DELETE FROM families;`);
    await queryInterface.sequelize.query(`ALTER TABLE student_profiles ENABLE TRIGGER ALL;`);

    // 4. Data Arrays for Generation
    const firstNamesMale = [
      'Aarav', 'Vihaan', 'Vivaan', 'Aditya', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Shaurya',
      'Atharv', 'Kabir', 'Aaryan', 'Rudra', 'Rahul', 'Rohit', 'Amit', 'Vikram', 'Rohan', 'Karan',
      'Sanjay', 'Rajesh', 'Anil', 'Sunil', 'Vijay', 'Deepak', 'Suresh', 'Ramesh', 'Kartik', 'Yash',
      'Ayush', 'Gaurav', 'Nikhil', 'Abhishek', 'Pranav', 'Mayank', 'Harsh', 'Utkarsh', 'Rishabh', 'Akash'
    ];

    const firstNamesFemale = [
      'Aadhya', 'Saanvi', 'Ananya', 'Diya', 'Pihu', 'Prisha', 'Ira', 'Avani', 'Riya', 'Kavya',
      'Shruti', 'Priya', 'Sneha', 'Neha', 'Pooja', 'Meera', 'Rani', 'Sonia', 'Jyoti', 'Sunita',
      'Anita', 'Kiran', 'Preeti', 'Swati', 'Asha', 'Lata', 'Usha', 'Gita', 'Seema', 'Rekha',
      'Tanvi', 'Riddhi', 'Siddhi', 'Kriti', 'Nisha', 'Shreya', 'Divya', 'Anjali', 'Komal', 'Payal'
    ];

    const lastNames = [
      'Sharma', 'Verma', 'Gupta', 'Patel', 'Reddy', 'Nair', 'Pillai', 'Rao', 'Joshi', 'Kulkarni',
      'Deshmukh', 'Choudhury', 'Das', 'Roy', 'Sen', 'Banerjee', 'Chatterjee', 'Mukherjee', 'Dutta', 'Borah',
      'Saikia', 'Gogoi', 'Barua', 'Talukdar', 'Kalita', 'Pegu', 'Devi', 'Prasad', 'Singh', 'Kumar',
      'Kakati', 'Hazarika', 'Phukan', 'Barman', 'Sarma', 'Nath', 'Medhi', 'Deka', 'Bhuyan', 'Chaliha'
    ];

    const occupations = ['Engineer', 'Doctor', 'Teacher', 'Businessman', 'Government Servant', 'Manager', 'Accountant', 'Farmer', 'Consultant', 'Architect'];
    const qualifications = ['Secondary', 'Higher Secondary', 'Graduate', 'Post Graduate', 'Doctorate', 'Diploma'];
    const castes = ['Gen', 'OBC', 'SC', 'ST'];
    const religions = ['Hinduism', 'Islam', 'Christianity', 'Sikhism', 'Buddhism'];
    const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    const media = ['English', 'Assamese'];
    const relations = ['Uncle', 'Aunt', 'Grandfather', 'Grandmother', 'Local Guardian'];

    const locations = [
      { village: 'Kahilipara', ps: 'Dispur P.S.', po: 'Kahilipara P.O.', pin: '781019' },
      { village: 'Dispur', ps: 'Dispur P.S.', po: 'Dispur P.O.', pin: '781006' },
      { village: 'Uzanbazar', ps: 'Latasil P.S.', po: 'Uzanbazar P.O.', pin: '781001' },
      { village: 'Paltanbazar', ps: 'Paltanbazar P.S.', po: 'Paltanbazar P.O.', pin: '781008' },
      { village: 'Chandmari', ps: 'Chandmari P.S.', po: 'Chandmari P.O.', pin: '781003' },
      { village: 'Ganeshguri', ps: 'Dispur P.S.', po: 'Dispur P.O.', pin: '781006' },
      { village: 'Beltola', ps: 'Hatigaon P.S.', po: 'Beltola P.O.', pin: '781028' },
      { village: 'Hatigaon', ps: 'Hatigaon P.S.', po: 'Hatigaon P.O.', pin: '781038' },
      { village: 'Maligaon', ps: 'Jalukbari P.S.', po: 'Maligaon P.O.', pin: '781011' },
      { village: 'Jalukbari', ps: 'Jalukbari P.S.', po: 'Jalukbari P.O.', pin: '781014' },
      { village: 'Khanapara', ps: 'Dispur P.S.', po: 'Khanapara P.O.', pin: '781022' }
    ];

    // Helper functions for random items
    const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const randomPhone = () => '9864' + Math.floor(100000 + Math.random() * 900000);
    const randomAadhar = () => Math.floor(1000 + Math.random() * 9000) + ' ' + Math.floor(1000 + Math.random() * 9000) + ' ' + Math.floor(1000 + Math.random() * 9000);
    const randomApaar = () => '99' + Math.floor(1000000000 + Math.random() * 9000000000);
    const randomPen = () => 'PEN' + Math.floor(10000000 + Math.random() * 90000000);

    let admissionCounter = 1001;

    console.log(`Starting to seed students for ${classes.length} classes...`);

    for (const cls of classes) {
      // Get sections for this class
      const [sections] = await queryInterface.sequelize.query(
        `SELECT id, name FROM sections WHERE class_id = :classId AND is_deleted = false ORDER BY name ASC;`,
        { replacements: { classId: cls.id } }
      );

      if (sections.length === 0) continue;

      for (const sec of sections) {
        // Seed exactly 20 students per section (40 per class)
        for (let i = 1; i <= 20; i++) {
          const gender = Math.random() > 0.5 ? 'male' : 'female';
          const firstName = gender === 'male' ? randomItem(firstNamesMale) : randomItem(firstNamesFemale);
          const lastName = randomItem(lastNames);
          const studentName = `${firstName} ${lastName}`;

          // Family names
          const fatherFirstName = randomItem(firstNamesMale);
          const motherFirstName = randomItem(firstNamesFemale);
          const fatherName = `${fatherFirstName} ${lastName}`;
          const motherName = `${motherFirstName} ${lastName}`;
          const familyName = `${lastName} Family`;

          // Local Guwahati address configuration
          const loc = randomItem(locations);
          const addressText = `House No. ${Math.floor(1 + Math.random() * 150)}, Bylane ${Math.floor(1 + Math.random() * 10)}, ${loc.village}, Guwahati`;

          const familyPhone = randomPhone();
          const familyEmail = `${lastName.toLowerCase()}.${Math.floor(Math.random() * 1000)}@gmail.com`;

          // Generate date of birth based on class stream/minimum age
          const baseBirthYear = new Date().getFullYear() - (cls.min_age || 5);
          const dob = `${baseBirthYear}-05-${Math.floor(10 + Math.random() * 18)}`;

          // ── 4a. Insert Family record ──────────────────────────────────────
          await queryInterface.bulkInsert('families', [{
            school_id: schoolId,
            family_name: familyName,
            primary_contact: fatherName,
            phone: familyPhone,
            email: familyEmail,
            created_at: now,
            updated_at: now
          }]);

          const [family] = await queryInterface.sequelize.query(
            `SELECT id FROM families WHERE school_id = :schoolId AND email = :familyEmail ORDER BY id DESC LIMIT 1;`,
            { replacements: { schoolId, familyEmail } }
          );
          const familyId = family[0].id;

          // ── 4b. Insert Student record ─────────────────────────────────────
          const admissionNo = `GWA/2026/${admissionCounter++}`;
          await queryInterface.bulkInsert('students', [{
            school_id: schoolId,
            admission_no: admissionNo,
            first_name: firstName,
            last_name: lastName,
            date_of_birth: dob,
            gender: gender,
            aadhar_no: randomAadhar(),
            family_id: familyId,
            is_deleted: false,
            is_active: true,
            status: 'active',
            failed_login_attempts: 0,
            created_at: now,
            updated_at: now
          }]);

          const [student] = await queryInterface.sequelize.query(
            `SELECT id FROM students WHERE school_id = :schoolId AND admission_no = :admissionNo ORDER BY id DESC LIMIT 1;`,
            { replacements: { schoolId, admissionNo } }
          );
          const studentId = student[0].id;

          // ── 4c. Insert Student Profile record ──────────────────────────────
          const guardianName = `${randomItem(firstNamesMale)} ${randomItem(lastNames)}`;
          const guardianEmail = `${guardianName.split(' ')[0].toLowerCase()}@gmail.com`;

          await queryInterface.bulkInsert('student_profiles', [{
            student_id: studentId,
            address: addressText,
            city: 'Guwahati',
            state: 'Assam',
            pincode: loc.pin,
            phone: familyPhone,
            email: `${firstName.toLowerCase()}.${studentId}@greenwoodacademy.edu.in`,
            father_name: fatherName,
            father_phone: familyPhone,
            father_occupation: randomItem(occupations),
            father_qualification: randomItem(qualifications),
            father_aadhar: randomAadhar(),
            father_annual_income: `${Math.floor(2 + Math.random() * 15)} Lakhs`,
            mother_name: motherName,
            mother_phone: randomPhone(),
            mother_email: `${motherFirstName.toLowerCase()}@gmail.com`,
            mother_occupation: randomItem(occupations),
            mother_qualification: randomItem(qualifications),
            mother_aadhar: randomAadhar(),
            mother_annual_income: `${Math.floor(1 + Math.random() * 8)} Lakhs`,
            parent_email: familyEmail,
            emergency_contact: familyPhone,
            
            // Local geography and auxiliary fields
            village: loc.village,
            police_station: loc.ps,
            post_office: loc.po,
            district: 'Kamrup Metropolitan',
            nationality: 'Indian',
            religion: randomItem(religions),
            caste: randomItem(castes),
            mother_tongue: 'Assamese',
            identification_marks: `A mole on the ${Math.random() > 0.5 ? 'right cheek' : 'left arm'}.`,
            is_hostel: Math.random() > 0.9, // 10% hostellers
            medium: randomItem(media),
            pen_no: randomPen(),
            apaar_id: randomApaar(),
            prev_attendance_days: Math.floor(180 + Math.random() * 40),
            distance_km: parseFloat((1 + Math.random() * 12).toFixed(2)),
            
            // Guardian details (for complete coverage)
            guardian_name: guardianName,
            guardian_relation: randomItem(relations),
            guardian_phone: randomPhone(),
            guardian_occupation: randomItem(occupations),
            guardian_qualification: randomItem(qualifications),
            guardian_aadhar: randomAadhar(),
            guardian_email: guardianEmail,
            
            blood_group: randomItem(bloodGroups),
            medical_notes: 'None. General health status is excellent.',
            photo_path: `/uploads/profiles/student_${studentId}.jpg`,
            
            // Permanent address configuration (mostly same, occasionally different)
            is_permanent_same: true,
            perm_address: addressText,
            perm_village: loc.village,
            perm_police_station: loc.ps,
            perm_post_office: loc.po,
            perm_district: 'Kamrup Metropolitan',
            perm_city: 'Guwahati',
            perm_state: 'Assam',
            perm_pincode: loc.pin,

            valid_from: now.toISOString().split('T')[0],
            is_current: true
          }]);

          // ── 4d. Insert Enrollment record ──────────────────────────────────
          await queryInterface.bulkInsert('enrollments', [{
            student_id: studentId,
            session_id: sessionId,
            class_id: cls.id,
            section_id: sec.id,
            stream: cls.stream,
            roll_number: i.toString(),
            joined_date: now.toISOString().split('T')[0],
            joining_type: 'fresh',
            status: 'active',
            created_at: now,
            updated_at: now
          }]);
        }
      }
      console.log(`Seeded 40 students successfully for ${cls.name} [Stream: ${cls.stream}]`);
    }

    console.log('Successfully completed seeding 720 students across 18 classes!');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`DELETE FROM enrollments;`);
    await queryInterface.sequelize.query(`DELETE FROM student_profiles;`);
    await queryInterface.sequelize.query(`DELETE FROM students;`);
    await queryInterface.sequelize.query(`DELETE FROM families;`);
  }
};
