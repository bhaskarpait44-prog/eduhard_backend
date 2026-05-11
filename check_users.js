const sequelize = require('./config/database');

async function checkUsers() {
  try {
    const [users] = await sequelize.query('SELECT id, email, school_id FROM users');
    console.log('Users:', users);
    
    const [schools] = await sequelize.query('SELECT id, name FROM schools');
    console.log('Schools:', schools);

    const [[students]] = await sequelize.query('SELECT COUNT(*) FROM students');
    console.log('Global Students Count:', students.count);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

checkUsers();
