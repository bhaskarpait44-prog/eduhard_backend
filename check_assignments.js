require('dotenv').config({ path: './.env' });
const sequelize = require('./config/database');
sequelize.query(`
  SELECT ta.*, t.email, c.name as class_name, s.name as section_name
  FROM teacher_assignments ta
  JOIN teachers t ON t.id = ta.teacher_id
  JOIN classes c ON c.id = ta.class_id
  JOIN sections s ON s.id = ta.section_id
  WHERE t.email LIKE 'teacher.%'
`)
  .then(r => {
    console.log(`Total Assignments for new teachers: ${r[0].length}`);
    r[0].forEach(a => {
      console.log(` - ${a.email}: ${a.class_name} ${a.section_name} (Class Teacher: ${a.is_class_teacher})`);
    });
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
