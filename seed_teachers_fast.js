require('dotenv').config({ path: './.env' });
const sequelize = require('./config/database');
const bcrypt = require('bcryptjs');

const SCHOOL_ID = 1;
const SESSION_ID = 1;
const DEFAULT_PASSWORD = 'Teacher@1234';

const TEACHER_PERMISSIONS = [
  'students.view',
  'attendance.view', 'attendance.mark', 'attendance.edit',
  'results.view', 'results.enter',
  'notices.view', 'notices.post',
  'classes.view'
];

async function seed() {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  
  // 1. Get all classes
  const [classes] = await sequelize.query('SELECT * FROM classes WHERE school_id = :schoolId', {
    replacements: { schoolId: SCHOOL_ID }
  });
  
  // 2. Get all permissions for mapping
  const [perms] = await sequelize.query('SELECT id, name FROM permissions WHERE name IN (:names)', {
    replacements: { names: TEACHER_PERMISSIONS }
  });
  const permissionIds = perms.map(p => p.id);

  console.log(`Found ${classes.length} classes. Starting seeding...`);

  for (const cls of classes) {
    // Get sections
    const [sections] = await sequelize.query('SELECT * FROM sections WHERE class_id = :classId', {
      replacements: { classId: cls.id }
    });
    
    // Get subjects
    const [subjects] = await sequelize.query('SELECT * FROM subjects WHERE class_id = :classId', {
      replacements: { classId: cls.id }
    });

    for (const sec of sections) {
      const email = `teacher.${cls.id}.${sec.id}@greenwood.edu.in`.toLowerCase();
      const firstName = 'Teacher';
      const lastName = `${cls.name} ${cls.stream || ''} ${sec.name}`.trim();
      const employeeId = `TCH-${cls.id}-${sec.id}`;

      // Check if teacher exists
      let [[teacher]] = await sequelize.query('SELECT id FROM teachers WHERE email = :email', {
        replacements: { email }
      });

      if (!teacher) {
        console.log(`Creating teacher: ${email}`);
        [[teacher]] = await sequelize.query(`
          INSERT INTO teachers 
            (school_id, first_name, last_name, email, password_hash, phone, employee_id, department, designation, is_active, force_password_change, created_at, updated_at)
          VALUES
            (:schoolId, :firstName, :lastName, :email, :passwordHash, :phone, :employeeId, :dept, :desig, true, true, NOW(), NOW())
          RETURNING id
        `, {
          replacements: {
            schoolId: SCHOOL_ID,
            firstName,
            lastName,
            email,
            passwordHash,
            phone: '9000000000',
            employeeId,
            dept: cls.stream || 'General',
            desig: 'Class Teacher'
          }
        });
      } else {
        console.log(`Teacher already exists: ${email}`);
      }

      const teacherId = teacher.id;

      // Add permissions
      if (permissionIds.length > 0) {
        for (const pid of permissionIds) {
          await sequelize.query(`
            INSERT INTO teacher_permissions (teacher_id, permission_id, granted_at)
            VALUES (:teacherId, :permissionId, NOW())
            ON CONFLICT (teacher_id, permission_id) DO NOTHING
          `, { replacements: { teacherId, permissionId: pid } });
        }
      }

      // Add Class Teacher Assignment
      await sequelize.query(`
        INSERT INTO teacher_assignments (teacher_id, session_id, class_id, section_id, is_class_teacher, is_active, created_at, updated_at)
        VALUES (:teacherId, :sessionId, :classId, :sectionId, true, true, NOW(), NOW())
        ON CONFLICT DO NOTHING
      `, {
        replacements: { teacherId, sessionId: SESSION_ID, classId: cls.id, sectionId: sec.id }
      });

      // Add Subject Teacher Assignments
      for (const sub of subjects) {
        await sequelize.query(`
          INSERT INTO teacher_assignments (teacher_id, session_id, class_id, section_id, subject_id, is_class_teacher, is_active, created_at, updated_at)
          VALUES (:teacherId, :sessionId, :classId, :sectionId, :subjectId, false, true, NOW(), NOW())
          ON CONFLICT DO NOTHING
        `, {
          replacements: { teacherId, sessionId: SESSION_ID, classId: cls.id, sectionId: sec.id, subjectId: sub.id }
        });
      }
    }
  }

  console.log('Seeding completed successfully.');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
