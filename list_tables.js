const sequelize = require('./config/database');

async function listTables() {
  try {
    const [tables] = await sequelize.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    console.log('Tables:', tables.map(t => t.table_name));

    const [[count]] = await sequelize.query('SELECT COUNT(*) FROM students');
    console.log('Students Count:', count.count);

  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}

listTables();
