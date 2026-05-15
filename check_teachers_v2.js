require('dotenv').config({ path: './.env' });
const sequelize = require('./config/database');
sequelize.query('SELECT count(*) as count FROM teachers')
  .then(r => {
    console.log(`Total Teachers: ${r[0][0].count}`);
    return sequelize.query("SELECT first_name, last_name, email FROM teachers WHERE email LIKE 'teacher.%' LIMIT 10");
  })
  .then(r => {
    console.log('Recent Teacher Provisioning:');
    r[0].forEach(t => console.log(` - ${t.first_name} ${t.last_name} (${t.email})`));
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
