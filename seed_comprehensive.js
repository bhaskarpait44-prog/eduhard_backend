require('dotenv').config();
const { 
  sequelize, School, Session, Class, Section, Subject, 
  Teacher, Student, StudentProfile, Enrollment, 
  Notice, Exam, ExamSubject, FeeStructure, FeeInvoice 
} = require('./models');
const bcrypt = require('bcryptjs');

async function seed() {
  const transaction = await sequelize.transaction();
  try {
    console.log('--- Starting Comprehensive Seeding ---');

    // 1. School
    const [school] = await School.findOrCreate({
      where: { email: 'admin@greenwoodacademy.edu.in' },
      defaults: {
        name: 'Greenwood Academy',
        branch_name: 'Main Campus',
        address: '12 Education Lane, Guwahati, Assam 781001',
        phone: '+91-361-2345678',
        is_active: true
      },
      transaction
    });
    console.log('✅ School ready');

    // 2. Session
    const [session] = await Session.findOrCreate({
      where: { school_id: school.id, name: '2024-2025' },
      defaults: {
        start_date: '2024-04-01',
        end_date: '2025-03-31',
        is_active: true
      },
      transaction
    });
    console.log('✅ Session ready');

    // 3. Classes & Sections
    const classData = [
      { name: '9', stream: null },
      { name: '10', stream: null },
      { name: '11', stream: 'Science' },
      { name: '12', stream: 'Science' }
    ];

    const classes = [];
    const sections = [];

    for (const c of classData) {
      const [cls] = await Class.findOrCreate({
        where: { school_id: school.id, name: c.name, stream: c.stream },
        defaults: { is_active: true },
        transaction
      });
      classes.push(cls);

      const [sec] = await Section.findOrCreate({
        where: { class_id: cls.id, name: 'A' },
        defaults: { capacity: 40, is_active: true },
        transaction
      });
      sections.push(sec);
    }
    console.log('✅ Classes and Sections ready');

    // 4. Subjects
    const commonSubjects = ['Mathematics', 'Science', 'Social Science', 'English', 'Hindi'];
    const scienceSubjects = ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'English'];

    const subjectMap = {}; // class_id -> subjects[]

    for (const cls of classes) {
      const subs = (cls.name === '11' || cls.name === '12') ? scienceSubjects : commonSubjects;
      subjectMap[cls.id] = [];
      for (const sName of subs) {
        const [sub] = await Subject.findOrCreate({
          where: { class_id: cls.id, name: sName },
          defaults: { code: `${sName.substring(0, 3).toUpperCase()}-${cls.name}`, is_active: true },
          transaction
        });
        subjectMap[cls.id].push(sub);
      }
    }
    console.log('✅ Subjects ready');

    // 5. Teachers
    const teacherNames = [
      { first: 'Arun', last: 'Sharma', dept: 'Mathematics' },
      { first: 'Priya', last: 'Das', dept: 'Science' },
      { first: 'Rajesh', last: 'Kumar', dept: 'English' },
      { first: 'Sunita', last: 'Barua', dept: 'Social Science' },
      { first: 'Vikram', last: 'Singh', dept: 'Physics' }
    ];

    const teachers = [];
    const passwordHash = await bcrypt.hash('Teacher@1234', 12);

    for (let i = 0; i < teacherNames.length; i++) {
      const t = teacherNames[i];
      const email = `${t.first.toLowerCase()}.${t.last.toLowerCase()}@greenwood.edu.in`;
      const [teacher] = await Teacher.findOrCreate({
        where: { email },
        defaults: {
          school_id: school.id,
          first_name: t.first,
          last_name: t.last,
          password_hash: passwordHash,
          phone: `987654321${i}`,
          employee_id: `TCH-2024-${i+1}`,
          department: t.dept,
          designation: 'Senior Teacher',
          is_active: true
        },
        transaction
      });
      teachers.push(teacher);
    }
    console.log('✅ Teachers ready');

    // 6. Teacher Assignments (Class Teachers)
    // Map classes to teachers
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      const sec = sections[i];
      const teacher = teachers[i];

      // Update Section with class_teacher_id
      await sec.update({ class_teacher_id: teacher.id }, { transaction });

      // Create Teacher Assignment entry via SQL (since model might not be exported)
      await sequelize.query(`
        INSERT INTO teacher_assignments (teacher_id, session_id, class_id, section_id, is_class_teacher, is_active, created_at, updated_at)
        VALUES (:teacherId, :sessionId, :classId, :sectionId, true, true, NOW(), NOW())
        ON CONFLICT (teacher_id, session_id, class_id, section_id, subject_id) DO NOTHING
      `, {
        replacements: { 
          teacherId: teacher.id, 
          sessionId: session.id, 
          classId: cls.id, 
          sectionId: sec.id 
        },
        transaction
      });
    }
    console.log('✅ Class Teacher Assignments ready');

    // 7. Students & Enrollments (5 per class)
    const firstNames = ['Amit', 'Rahul', 'Sneha', 'Anjali', 'Deepak', 'Pooja', 'Rohan', 'Simran', 'Karan', 'Ishita', 'Manoj', 'Neeta', 'Suresh', 'Kavita', 'Vijay', 'Maya', 'Arjun', 'Sonia', 'Ravi', 'Preeti'];
    const lastNames = ['Verma', 'Gupta', 'Mehta', 'Joshi', 'Choudhury', 'Borah', 'Saikia', 'Talukdar', 'Kalita', 'Deka'];

    let studentIdx = 0;
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      const sec = sections[i];

      for (let j = 0; j < 5; j++) {
        const fName = firstNames[studentIdx % firstNames.length];
        const lName = lastNames[studentIdx % lastNames.length];
        const admissionNo = `2024${cls.name}${sec.name}0${j+1}`;
        const email = `${fName.toLowerCase()}.${lName.toLowerCase()}.${admissionNo}@student.edu.in`;

        const [student] = await Student.findOrCreate({
          where: { admission_no: admissionNo },
          defaults: {
            school_id: school.id,
            first_name: fName,
            last_name: lName,
            password_hash: passwordHash,
            gender: j % 2 === 0 ? 'male' : 'female',
            date_of_birth: '2010-05-15',
            is_active: true
          },
          transaction
        });

        // Check if profile exists before creating to avoid immutable update error
        const existingProfile = await StudentProfile.findOne({
          where: { student_id: student.id, is_current: true },
          transaction
        });

        if (!existingProfile) {
          await StudentProfile.create({
            student_id: student.id,
            address: 'Guwahati, Assam',
            city: 'Guwahati',
            state: 'Assam',
            pincode: '781001',
            phone: `9954000${studentIdx}`,
            email: email,
            father_name: `${lName} Senior`,
            mother_name: `Mrs. ${lName}`,
            blood_group: 'O+',
            religion: 'Hindu',
            nationality: 'Indian',
            valid_from: '2024-04-01',
            is_current: true
          }, { transaction });
        }

        await Enrollment.findOrCreate({
          where: { student_id: student.id, session_id: session.id },
          defaults: {
            class_id: cls.id,
            section_id: sec.id,
            roll_number: j + 1,
            status: 'active'
          },
          transaction
        });

        studentIdx++;
      }
    }
    console.log('✅ Students and Enrollments ready');

    // 8. Timetable
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
    for (let i = 0; i < classes.length; i++) {
      const cls = classes[i];
      const sec = sections[i];
      const subs = subjectMap[cls.id];

      for (const day of days) {
        for (let p = 1; p <= 4; p++) {
          const sub = subs[(p - 1) % subs.length];
          const teacher = teachers[(p - 1) % teachers.length];
          
          await sequelize.query(`
            INSERT INTO timetable_slots (session_id, class_id, section_id, teacher_id, subject_id, day_of_week, period_number, start_time, end_time, room_number, is_active, created_at, updated_at)
            VALUES (:sessionId, :classId, :sectionId, :teacherId, :subjectId, :day, :period, :start, :end, :room, true, NOW(), NOW())
            ON CONFLICT (class_id, section_id, day_of_week, period_number) DO NOTHING
          `, {
            replacements: {
              sessionId: session.id,
              classId: cls.id,
              sectionId: sec.id,
              teacherId: teacher.id,
              subjectId: sub.id,
              day: day,
              period: p,
              start: `${8 + p}:00:00`,
              end: `${9 + p}:00:00`,
              room: `Room ${cls.name}${sec.name}`
            },
            transaction
          });
        }
      }
    }
    console.log('✅ Timetable ready');

    // 9. Exams
    for (const cls of classes) {
      const [exam] = await Exam.findOrCreate({
        where: { class_id: cls.id, name: 'First Terminal Examination 2024' },
        defaults: {
          session_id: session.id,
          term: 'Term 1',
          start_date: '2024-09-15',
          end_date: '2024-09-30',
          status: 'scheduled',
          total_marks: 100,
          weightage: 50
        },
        transaction
      });

      const subs = subjectMap[cls.id];
      for (let k = 0; k < subs.length; k++) {
        await ExamSubject.findOrCreate({
          where: { exam_id: exam.id, subject_id: subs[k].id },
          defaults: {
            exam_date: `2024-09-${15 + k}`,
            start_time: '09:00:00',
            end_time: '12:00:00',
            max_marks: 100,
            min_marks: 33
          },
          transaction
        });
      }
    }
    console.log('✅ Exams ready');

    // 10. Notices
    await Notice.create({
      school_id: school.id,
      title: 'Welcome to Academic Year 2024-25',
      body: 'We are excited to welcome all students and teachers to the new academic session.',
      posted_by_role: 'admin',
      audience: 'school_wide',
      is_school_wide: true,
      priority: 'normal'
    }, { transaction });

    await Notice.create({
      school_id: school.id,
      title: 'Science Fair 2024',
      body: 'A school-wide science fair will be held in November. Start preparing your projects!',
      posted_by_role: 'admin',
      audience: 'school_wide',
      is_school_wide: true,
      priority: 'info'
    }, { transaction });
    console.log('✅ Notices ready');

    // 11. Fees
    for (const cls of classes) {
      const [feeStruct] = await FeeStructure.findOrCreate({
        where: { session_id: session.id, class_id: cls.id, name: 'Monthly Tuition Fee' },
        defaults: {
          amount: cls.name === '11' || cls.name === '12' ? 3500 : 2500,
          frequency: 'monthly',
          due_day: 10,
          is_active: true
        },
        transaction
      });

      // Generate invoices for active enrollments
      const enrollments = await Enrollment.findAll({ 
        where: { session_id: session.id, class_id: cls.id },
        transaction 
      });

      for (const enr of enrollments) {
        await FeeInvoice.findOrCreate({
          where: { enrollment_id: enr.id, fee_structure_id: feeStruct.id, due_date: '2024-04-10' },
          defaults: {
            amount_due: feeStruct.amount,
            amount_paid: 0,
            status: 'pending'
          },
          transaction
        });
      }
    }
    console.log('✅ Fee structures and initial invoices ready');

    await transaction.commit();
    console.log('--- Seeding Completed Successfully ---');
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Seeding failed:', error);
  } finally {
    process.exit();
  }
}

seed();
