'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // 1. Fetch foundation data
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

    // 2. Clear existing alumni data to avoid duplicates/conflicts
    await queryInterface.sequelize.query(`ALTER TABLE student_profiles DISABLE TRIGGER ALL;`);
    await queryInterface.sequelize.query(`DELETE FROM alumni_profiles;`);
    await queryInterface.sequelize.query(`DELETE FROM enrollments WHERE status = 'inactive' AND leaving_type = 'graduated';`);
    await queryInterface.sequelize.query(`DELETE FROM student_profiles WHERE student_id IN (SELECT id FROM students WHERE status = 'graduated');`);
    await queryInterface.sequelize.query(`DELETE FROM students WHERE status = 'graduated';`);
    await queryInterface.sequelize.query(`DELETE FROM families WHERE id NOT IN (SELECT DISTINCT family_id FROM students WHERE family_id IS NOT NULL);`);
    await queryInterface.sequelize.query(`ALTER TABLE student_profiles ENABLE TRIGGER ALL;`);

    // Fetch Class 12 IDs for stream-based enrollments
    const [class12s] = await queryInterface.sequelize.query(
      `SELECT id, stream FROM classes WHERE name = 'Class 12' AND school_id = :schoolId;`,
      { replacements: { schoolId } }
    );
    if (class12s.length === 0) {
      throw new Error('Please seed classes first.');
    }

    const class12Map = {};
    for (const c of class12s) {
      class12Map[c.stream] = c.id;
      // Get first section
      const [secs] = await queryInterface.sequelize.query(
        `SELECT id FROM sections WHERE class_id = :classId LIMIT 1;`,
        { replacements: { classId: c.id } }
      );
      class12Map[c.stream + '_section'] = secs.length > 0 ? secs[0].id : null;
    }

    // 3. Data lists for mock profiles
    const firstNamesMale = [
      'Dev', 'Kabir', 'Rohan', 'Neel', 'Karan', 'Aryan', 'Samar', 'Dhruv', 'Siddharth', 'Nikhil',
      'Yash', 'Abhay', 'Manish', 'Kunal', 'Harsh', 'Varun', 'Tarun', 'Aniket', 'Ishaan', 'Kartik'
    ];
    const firstNamesFemale = [
      'Alia', 'Kiara', 'Kriti', 'Shraddha', 'Rhea', 'Ananya', 'Shanaya', 'Tara', 'Janhavi', 'Sara',
      'Aditi', 'Meera', 'Riya', 'Tanya', 'Isha', 'Payal', 'Simran', 'Pooja', 'Neha', 'Divya'
    ];
    const lastNames = [
      'Sharma', 'Verma', 'Gupta', 'Das', 'Roy', 'Sen', 'Banerjee', 'Barua', 'Borah', 'Saikia',
      'Choudhury', 'Gogoi', 'Talukdar', 'Kalita', 'Pathak', 'Goswami', 'Bhuyan', 'Deka', 'Nath', 'Sarma'
    ];

    const companies = ['TCS', 'Infosys', 'Wipro', 'Microsoft', 'Google India', 'Amazon', 'Cognizant', 'HDFC Bank', 'SBI', 'Accenture'];
    const jobTitles = ['Software Engineer', 'Systems Analyst', 'Graduate Engineer Trainee', 'Consultant', 'Business Development Associate', 'Operations Manager', 'Account Executive'];
    const higherEduCourses = ['B.Tech Computer Science', 'M.Tech', 'MBA Finance', 'MBBS', 'M.Sc Chemistry', 'B.A. Political Science', 'M.Com', 'BBA'];
    const institutions = ['IIT Guwahati', 'Gauhati University', 'Cotton University', 'Tezpur University', 'Delhi University', 'BITS Pilani', 'Assam Engineering College'];
    const industries = ['Information Technology', 'Banking & Finance', 'Higher Education', 'Healthcare', 'Automobile', 'Consultancy'];
    const cities = ['Guwahati', 'Bangalore', 'Delhi', 'Mumbai', 'Pune', 'Hyderabad', 'Kolkata', 'Chennai'];
    const states = ['Assam', 'Karnataka', 'Delhi', 'Maharashtra', 'Maharashtra', 'Telangana', 'West Bengal', 'Tamil Nadu'];
    const occupations = ['employed', 'self_employed', 'higher_studies', 'unemployed', 'other'];

    const testimonials = [
      'Greenwood Academy shaped my personality and gave me the analytical skills to succeed.',
      'My high school teachers guided me beautifully. The support was incredible!',
      'An amazing foundation for both academics and extracurricular activities.',
      'The exposure and opportunities I got here helped me clear my engineering entrance.'
    ];

    const randomItem = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const randomPhone = () => '9854' + Math.floor(100000 + Math.random() * 900000);
    const randomAadhar = () => Math.floor(1000 + Math.random() * 9000) + ' ' + Math.floor(1000 + Math.random() * 9000) + ' ' + Math.floor(1000 + Math.random() * 9000);

    let admissionCounter = 9001;

    console.log('Generating 120 alumni...');

    for (let i = 1; i <= 120; i++) {
      const gender = Math.random() > 0.5 ? 'male' : 'female';
      const firstName = gender === 'male' ? randomItem(firstNamesMale) : randomItem(firstNamesFemale);
      const lastName = randomItem(lastNames);
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@gmail.com`;

      const fatherName = `${randomItem(firstNamesMale)} ${lastName}`;
      const motherName = `${randomItem(firstNamesFemale)} ${lastName}`;

      // Generate date of birth (older, e.g. born 2006-2007)
      const dob = `2006-08-${Math.floor(10 + Math.random() * 18)}`;

      // ── 3a. Family ────────────────────────────────────────────────────────
      await queryInterface.bulkInsert('families', [{
        school_id: schoolId,
        family_name: `${lastName} Family`,
        primary_contact: fatherName,
        phone: randomPhone(),
        email: email,
        created_at: now,
        updated_at: now
      }]);

      const [fam] = await queryInterface.sequelize.query(
        `SELECT id FROM families WHERE school_id = :schoolId AND email = :email ORDER BY id DESC LIMIT 1;`,
        { replacements: { schoolId, email } }
      );
      const familyId = fam[0].id;

      // ── 3b. Student (graduated status) ────────────────────────────────────
      const admissionNo = `ALM/2025/${admissionCounter++}`;
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
        is_active: false,
        status: 'graduated',
        left_date: '2025-05-15',
        leaving_reason: 'Completed Class 12 studies successfully',
        created_at: now,
        updated_at: now
      }]);

      const [stud] = await queryInterface.sequelize.query(
        `SELECT id FROM students WHERE school_id = :schoolId AND admission_no = :admissionNo ORDER BY id DESC LIMIT 1;`,
        { replacements: { schoolId, admissionNo } }
      );
      const studentId = stud[0].id;

      // ── 3c. Student Profile ───────────────────────────────────────────────
      await queryInterface.bulkInsert('student_profiles', [{
        student_id: studentId,
        address: `${Math.floor(1 + Math.random() * 200)} ABC Road, Guwahati`,
        city: 'Guwahati',
        state: 'Assam',
        pincode: '781003',
        phone: randomPhone(),
        email: `${firstName.toLowerCase()}.${i}@alumni.greenwoodacademy.edu.in`,
        father_name: fatherName,
        father_phone: randomPhone(),
        father_occupation: 'Professional',
        mother_name: motherName,
        emergency_contact: randomPhone(),
        valid_from: '2022-04-01',
        valid_to: '2025-05-15',
        is_current: true
      }]);

      // ── 3d. Inactive enrollment in Class 12 ────────────────────────────────
      const streams = ['science', 'commerce', 'arts'];
      const stream = randomItem(streams);
      const classId = class12Map[stream];
      const sectionId = class12Map[stream + '_section'];

      await queryInterface.bulkInsert('enrollments', [{
        student_id: studentId,
        session_id: sessionId,
        class_id: classId,
        section_id: sectionId,
        stream: stream,
        roll_number: `ALM-${i}`,
        joined_date: '2024-04-01',
        left_date: '2025-05-15',
        joining_type: 'promoted',
        leaving_type: 'graduated',
        status: 'inactive',
        created_at: now,
        updated_at: now
      }]);

      // ── 3e. Alumni Profile ────────────────────────────────────────────────
      const occ = randomItem(occupations);
      const cityIdx = Math.floor(Math.random() * cities.length);
      
      const alumniProfile = {
        student_id: studentId,
        school_id: schoolId,
        current_occupation: occ,
        company_or_institution: occ === 'employed' ? randomItem(companies) : (occ === 'higher_studies' ? randomItem(institutions) : null),
        job_title: occ === 'employed' ? randomItem(jobTitles) : null,
        industry: occ === 'employed' ? randomItem(industries) : null,
        higher_edu_course: occ === 'higher_studies' ? randomItem(higherEduCourses) : null,
        higher_edu_institution: occ === 'higher_studies' ? randomItem(institutions) : null,
        higher_edu_year: occ === 'higher_studies' ? 2028 : null,
        contact_email: email,
        contact_phone: randomPhone(),
        current_city: cities[cityIdx],
        current_state: states[cityIdx],
        current_country: 'India',
        linkedin_url: `https://www.linkedin.com/in/${firstName.toLowerCase()}-${lastName.toLowerCase()}-${studentId}`,
        is_mentor_volunteer: Math.random() > 0.6,
        testimonial: Math.random() > 0.4 ? randomItem(testimonials) : null,
        is_testimonial_public: Math.random() > 0.5,
        admin_notes: 'Active member of the alumni association.',
        profile_updated_at: now,
        created_at: now,
        updated_at: now
      };

      await queryInterface.bulkInsert('alumni_profiles', [alumniProfile]);
    }

    console.log('Seeded 120 Alumni profiles and their student accounts successfully!');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`ALTER TABLE student_profiles DISABLE TRIGGER ALL;`);
    await queryInterface.sequelize.query(`DELETE FROM alumni_profiles;`);
    await queryInterface.sequelize.query(`DELETE FROM enrollments WHERE status = 'inactive' AND leaving_type = 'graduated';`);
    await queryInterface.sequelize.query(`DELETE FROM student_profiles WHERE student_id IN (SELECT id FROM students WHERE status = 'graduated');`);
    await queryInterface.sequelize.query(`DELETE FROM students WHERE status = 'graduated';`);
    await queryInterface.sequelize.query(`DELETE FROM families WHERE id NOT IN (SELECT DISTINCT family_id FROM students WHERE family_id IS NOT NULL);`);
    await queryInterface.sequelize.query(`ALTER TABLE student_profiles ENABLE TRIGGER ALL;`);
  }
};
