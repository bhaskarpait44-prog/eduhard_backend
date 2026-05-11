const sequelize = require('./config/database');
const bcrypt = require('bcryptjs');

async function runSeed() {
  const schoolId = 1;
  const sessionId = 1;
  const now = new Date();
  const hash = await bcrypt.hash('Student@123', 12);

  try {
    const [classes] = await sequelize.query(
      `SELECT id, name, stream FROM classes WHERE school_id = :schoolId AND is_active = true AND is_deleted = false;`,
      { replacements: { schoolId } }
    );

    let totalCreated = 0;

    for (const cls of classes) {
      const [sections] = await sequelize.query(
        `SELECT id, name FROM sections WHERE class_id = :classId AND is_active = true AND is_deleted = false;`,
        { replacements: { classId: cls.id } }
      );

      for (const sec of sections) {
        const [[{ count }]] = await sequelize.query(
          `SELECT COUNT(*)::int FROM enrollments WHERE class_id = :classId AND section_id = :sectionId AND session_id = :sessionId;`,
          { replacements: { classId: cls.id, sectionId: sec.id, sessionId } }
        );

        const studentsToCreate = 5 - parseInt(count);
        if (studentsToCreate <= 0) {
          console.log(`Skipping ${cls.name} ${cls.stream || ''} Section ${sec.name} - already has ${count} students.`);
          continue;
        }

        console.log(`Seeding ${studentsToCreate} students for ${cls.name} ${cls.stream || ''} Section ${sec.name}`);

        for (let i = 1; i <= studentsToCreate; i++) {
          const studentNum = parseInt(count) + i;
          const timestamp = Date.now().toString().slice(-4);
          const admNo = `ADM-${cls.id}-${sec.id}-${studentNum}-${timestamp}`;
          const lastName = `${cls.name.replace(' ', '')}${sec.name}${studentNum}`;
          
          await sequelize.transaction(async (t) => {
            // 1. Insert Student
            const [studentResult] = await sequelize.query(
              `INSERT INTO students (
                school_id, admission_no, first_name, last_name, 
                date_of_birth, gender, password_hash, is_active, 
                status, is_deleted, created_at, updated_at
              )
              VALUES (
                :schoolId, :admNo, 'Student', :lastName, 
                '2015-01-01', :gender, :hash, true, 
                'active', false, NOW(), NOW()
              )
              RETURNING id;`,
              { 
                replacements: { 
                  schoolId, admNo, lastName, hash, 
                  gender: i % 2 === 0 ? 'female' : 'male' 
                },
                transaction: t 
              }
            );
            const studentId = studentResult[0].id;

            // 2. Insert Profile
            await sequelize.query(
              `INSERT INTO student_profiles (
                student_id, email, is_current, valid_from, created_at
              )
              VALUES (
                :studentId, :email, true, NOW(), NOW()
              );`,
              { 
                replacements: { 
                  studentId, 
                  email: `std.${admNo.toLowerCase()}@example.com` 
                },
                transaction: t 
              }
            );

            // 3. Insert Enrollment
            await sequelize.query(
              `INSERT INTO enrollments (
                student_id, session_id, class_id, section_id, 
                roll_number, stream, joined_date, joining_type, 
                status, created_at, updated_at
              )
              VALUES (
                :studentId, :sessionId, :classId, :sectionId, 
                :studentNum, :stream, CURRENT_DATE, 'fresh', 
                'active', NOW(), NOW()
              );`,
              { 
                replacements: { 
                  studentId, sessionId, classId: cls.id, sectionId: sec.id, 
                  studentNum: String(studentNum), stream: cls.stream || 'regular' 
                },
                transaction: t 
              }
            );
          });
          
          totalCreated++;
          console.log(`   DONE: ${studentNum} for ${cls.name} ${sec.name}`);
        }
      }
    }
    console.log(`\nSuccessfully seeded ${totalCreated} students.`);
  } catch (err) {
    console.error('Seeding failed:', err);
  } finally {
    process.exit();
  }
}

runSeed();
