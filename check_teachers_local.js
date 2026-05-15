require('dotenv').config({ path: './backend/.env' });
const sequelize = require('./backend/config/database');
sequelize.query('SELECT count(*) as count FROM teachers')
  .then(r => {
    console.log(`Total Teachers: ${r[0][0].count}`);
    return sequelize.query("SELECT name, email FROM teachers WHERE email LIKE 'teacher.%' LIMIT 5");
  })
  .then(r => {
    console.log('Recent Teacher Provisioning:');
    r[0].forEach(t => console.log(` - ${t.name} (${t.email})`));
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
