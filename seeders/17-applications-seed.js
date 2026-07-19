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

    const [sessions] = await queryInterface.sequelize.query(
      `SELECT id FROM sessions ORDER BY id DESC LIMIT 1;`
    );
    if (sessions.length === 0) {
      throw new Error('Please run academic sessions seeder first!');
    }
    const sessionId = sessions[0].id;

    const [admins] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1;`
    );
    const adminId = admins.length > 0 ? admins[0].id : null;

    // 2. Fetch all classes
    const [classes] = await queryInterface.sequelize.query(
      `SELECT id, name, stream FROM classes WHERE school_id = :schoolId AND is_deleted = false;`,
      { replacements: { schoolId } }
    );
    if (classes.length === 0) {
      throw new Error('Please run classes seeder first!');
    }

    // 3. Clear existing applications
    await queryInterface.sequelize.query(`DELETE FROM applications;`);

    // 4. Generate 200 applications
    const firstNamesMale = [
      'Aarav', 'Vihaan', 'Vivaan', 'Ananya', 'Diya', 'Saisha', 'Kiara', 'Anya', 'Aadhya', 'Anika',
      'Kabir', 'Rohan', 'Reyansh', 'Aryan', 'Ishaan', 'Dhruv', 'Arjun', 'Pranav', 'Dev', 'Aditya',
      'Atharv', 'Shreyas', 'Krishna', 'Madhav', 'Raghav', 'Ayush', 'Yash', 'Rishi', 'Neil', 'Karan'
    ];
    const firstNamesFemale = [
      'Diya', 'Ira', 'Avani', 'Myra', 'Ananya', 'Riya', 'Suhana', 'Pooja', 'Neha', 'Aditi',
      'Tanya', 'Sneha', 'Simran', 'Priya', 'Kriti', 'Nisha', 'Komal', 'Shruti', 'Megha', 'Pooja',
      'Payal', 'Riddhi', 'Siddhi', 'Kavya', 'Divya', 'Anjali', 'Rashmi', 'Jyoti', 'Shweta', 'Preeti'
    ];
    const lastNames = [
      'Sharma', 'Verma', 'Gupta', 'Das', 'Roy', 'Sen', 'Banerjee', 'Borah', 'Saikia', 'Gogoi',
      'Choudhury', 'Talukdar', 'Kalita', 'Pathak', 'Goswami', 'Bhuyan', 'Deka', 'Nath', 'Sarma', 'Barman'
    ];

    const joiningTypes = ['New Admission', 'Transfer', 'Re-admission', 'Lateral Entry'];
    const bloodGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

    const applications = [];

    console.log(`Generating 200 online admission applications...`);

    for (let i = 1; i <= 200; i++) {
      const isMale = Math.random() > 0.5;
      const firstName = isMale ? randomItem(firstNamesMale) : randomItem(firstNamesFemale);
      const lastName = randomItem(lastNames);
      const gender = isMale ? 'male' : 'female';

      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}.${i}@gmail.com`;
      const phone = '9854' + Math.floor(100000 + Math.random() * 900000);

      // Determine class
      const cls = classes[i % classes.length];
      const stream = cls.stream;

      // Date of birth: 5 to 17 years old
      const currentYear = new Date().getFullYear();
      let age = 5 + (i % 13); // ages 5 to 17
      if (cls.name.includes('LKG') || cls.name.includes('UKG')) age = 4;
      else if (cls.name.includes('Class 1') || cls.name.includes('Class 2')) age = 6;
      else if (cls.name.includes('Class 11') || cls.name.includes('Class 12')) age = 16;
      
      const dobYear = currentYear - age;
      const dob = `${dobYear}-08-15`;

      const fatherName = `Rajesh ${lastName}`;
      const motherName = `Sunita ${lastName}`;

      const studentData = {
        first_name: firstName,
        last_name: lastName,
        email: email,
        phone: phone,
        date_of_birth: dob,
        gender: gender,
        aadhar_no: `4544 3212 ${2000 + i}`,
        stream: stream,
        joining_type: randomItem(joiningTypes),
        blood_group: randomItem(bloodGroups),
        father_name: fatherName,
        father_email: `rajesh.${lastName.toLowerCase()}.${i}@gmail.com`,
        father_phone: '9864' + Math.floor(100000 + Math.random() * 900000),
        father_occupation: 'Business',
        mother_name: motherName,
        mother_email: `sunita.${lastName.toLowerCase()}.${i}@gmail.com`,
        mother_phone: '9864' + Math.floor(100000 + Math.random() * 900000),
        mother_occupation: 'Homemaker',
        address: `${Math.floor(1 + Math.random() * 150)} Zoo Road, Bylane 2`,
        city: 'Guwahati',
        state: 'Assam',
        pincode: '781003',
        previous_academic_records: [
          {
            school_name: 'Guwahati Public School',
            location: 'Guwahati',
            class_name: 'Previous Class',
            year_of_study: '2025',
            percentage_grade: `${75 + (i % 20)}%`
          }
        ],
        documents: {
          birth_certificate: `/uploads/documents/birth_cert_${i}.pdf`,
          aadhar_card: `/uploads/documents/aadhar_${i}.pdf`,
          transfer_certificate: `/uploads/documents/tc_${i}.pdf`
        }
      };

      // Status distribution
      let status = 'pending';
      if (i <= 100) {
        status = 'pending';
      } else if (i <= 150) {
        status = 'approved';
      } else if (i <= 180) {
        status = 'rejected';
      } else {
        status = 'admitted';
      }

      const isReviewed = status !== 'pending';
      const isAdmitted = status === 'admitted';

      applications.push({
        school_id: schoolId,
        session_id: sessionId,
        class_id: cls.id,
        reference_no: `APP-2026-${1000 + i}`,
        student_data: JSON.stringify(studentData),
        status: status,
        reviewed_by: isReviewed ? adminId : null,
        reviewed_at: isReviewed ? now : null,
        remarks: isReviewed ? (status === 'rejected' ? 'Academic criteria not met.' : 'Eligible for admission.') : null,
        admitted_by: isAdmitted ? adminId : null,
        admitted_at: isAdmitted ? now : null,
        created_at: now,
        updated_at: now
      });
    }

    if (applications.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < applications.length; i += batchSize) {
        const batch = applications.slice(i, i + batchSize);
        await queryInterface.bulkInsert('applications', batch);
      }
    }

    console.log(`Successfully seeded 200 online admission applications!`);

    function randomItem(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    }
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DELETE FROM applications;');
  }
};
