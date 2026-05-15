require('dotenv').config({ path: './.env' });
const sequelize = require('./config/database');

sequelize.query('SELECT count(*) as count FROM timetable_slots')
  .then(r => {
    console.log(`Total Timetable Slots: ${r[0][0].count}`);
    process.exit(0);
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
