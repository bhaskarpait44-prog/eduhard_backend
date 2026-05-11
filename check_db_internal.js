const sequelize = require('./config/database');

async function checkEnrollments() {
  try {
    const [[count]] = await sequelize.query('SELECT COUNT(*) FROM enrollments');
    console.log('Total Enrollments:', count.count);

    const [[students]] = await sequelize.query('SELECT COUNT(*) FROM students');
    console.log('Total Students:', students.count);

    const [sessions] = await sequelize.query('SELECT id, name, is_active FROM sessions');
    console.log('Sessions:', sessions);

    const [enrollmentList] = await sequelize.query(`
      SELECT e.id, e.student_id, e.class_id, e.section_id, e.session_id, c.name as class_name, s.name as section_name
      FROM enrollments e
      JOIN classes c ON c.id = e.class_id
      JOIN sections s ON s.id = e.section_id
      LIMIT 20
    `);
    console.log('Enrollments Detail:', enrollmentList);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkEnrollments();
