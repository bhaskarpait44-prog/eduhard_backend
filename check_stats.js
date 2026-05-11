const sequelize = require('./config/database');

async function checkStats() {
  try {
    const [[cCount]] = await sequelize.query('SELECT COUNT(*) FROM classes');
    const [[sCount]] = await sequelize.query('SELECT COUNT(*) FROM students');
    const [[eCount]] = await sequelize.query('SELECT COUNT(*) FROM enrollments');
    const [[sessCount]] = await sequelize.query('SELECT COUNT(*) FROM sessions');
    const [[subCount]] = await sequelize.query('SELECT COUNT(*) FROM subjects');

    console.log({
      classes: cCount.count,
      students: sCount.count,
      enrollments: eCount.count,
      sessions: sessCount.count,
      subjects: subCount.count
    });

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkStats();
