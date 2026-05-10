'use strict';

const bcrypt = require('bcryptjs');

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    const hash = await bcrypt.hash('Password@123', 12);

    // 1. Get School ID
    const [schools] = await queryInterface.sequelize.query(
      `SELECT id FROM schools LIMIT 1;`
    );
    if (schools.length === 0) {
      throw new Error('No school found. Please run school seeder first.');
    }
    const schoolId = schools[0].id;

    // 2. Seed Accountant
    const [existingAccountant] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE role = 'accountant' AND school_id = ${schoolId} LIMIT 1;`
    );
    if (existingAccountant.length === 0) {
      await queryInterface.bulkInsert('users', [{
        school_id: schoolId,
        name: 'John Accountant',
        email: 'accountant@greenwood.edu',
        password_hash: hash,
        role: 'accountant',
        is_active: true,
        created_at: now,
        updated_at: now
      }]);
    }

    // 3. Seed Teachers
    const teachersData = [
      { first_name: 'Alice', last_name: 'Smith', email: 'alice.teacher@greenwood.edu', employee_id: 'TCH001', department: 'Science' },
      { first_name: 'Bob', last_name: 'Jones', email: 'bob.teacher@greenwood.edu', employee_id: 'TCH002', department: 'Mathematics' },
    ];

    for (const t of teachersData) {
      const [existing] = await queryInterface.sequelize.query(
        `SELECT id FROM teachers WHERE email = '${t.email}' LIMIT 1;`
      );
      if (existing.length === 0) {
        await queryInterface.bulkInsert('teachers', [{
          school_id: schoolId,
          first_name: t.first_name,
          last_name: t.last_name,
          email: t.email,
          password_hash: hash,
          employee_id: t.employee_id,
          department: t.department,
          designation: 'Senior Teacher',
          joining_date: '2020-01-01',
          is_active: true,
          created_at: now,
          updated_at: now
        }]);
      }
    }

    // 4. Seed Parents and Families
    const parentsData = [
      { name: 'Michael Parent', email: 'parent1@gmail.com', family_name: 'The Michaels' },
      { name: 'Sarah Parent', email: 'parent2@gmail.com', family_name: 'The Sarahs' },
    ];

    for (const p of parentsData) {
      const [existingUser] = await queryInterface.sequelize.query(
        `SELECT id FROM users WHERE email = '${p.email}' LIMIT 1;`
      );
      let userId;
      if (existingUser.length === 0) {
        await queryInterface.bulkInsert('users', [{
          school_id: schoolId,
          name: p.name,
          email: p.email,
          password_hash: hash,
          role: 'parent',
          is_active: true,
          created_at: now,
          updated_at: now
        }]);
        const [newUser] = await queryInterface.sequelize.query(
          `SELECT id FROM users WHERE email = '${p.email}' LIMIT 1;`
        );
        userId = newUser[0].id;
      } else {
        userId = existingUser[0].id;
      }

      const [existingFamily] = await queryInterface.sequelize.query(
        `SELECT id FROM families WHERE user_id = ${userId} LIMIT 1;`
      );
      if (existingFamily.length === 0) {
        await queryInterface.bulkInsert('families', [{
          school_id: schoolId,
          user_id: userId,
          family_name: p.family_name,
          primary_contact: p.name,
          email: p.email,
          phone: '+91-9999988888',
          created_at: now,
          updated_at: now
        }]);
      }
    }

    // 5. Seed Library Settings
    const [existingLibSettings] = await queryInterface.sequelize.query(
      `SELECT id FROM library_settings WHERE school_id = ${schoolId} LIMIT 1;`
    );
    if (existingLibSettings.length === 0) {
      await queryInterface.bulkInsert('library_settings', [{
        school_id: schoolId,
        fine_per_day: 5.00,
        max_books_per_borrower: 5,
        max_issue_days: 15,
        created_at: now,
        updated_at: now
      }]);
    }

    // 6. Seed Library Books
    const booksData = [
      { title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', category: 'literature', total_copies: 5, isbn: '9780743273565' },
      { title: 'A Brief History of Time', author: 'Stephen Hawking', category: 'science', total_copies: 3, isbn: '9780553380163' },
      { title: 'Introduction to Algorithms', author: 'CLRS', category: 'mathematics', total_copies: 2, isbn: '9780262033848' },
    ];

    for (const b of booksData) {
      const [existingBook] = await queryInterface.sequelize.query(
        `SELECT id FROM library_books WHERE isbn = '${b.isbn}' AND school_id = ${schoolId} LIMIT 1;`
      );
      if (existingBook.length === 0) {
        await queryInterface.bulkInsert('library_books', [{
          school_id: schoolId,
          title: b.title,
          author: b.author,
          category: b.category,
          total_copies: b.total_copies,
          available_copies: b.total_copies,
          isbn: b.isbn,
          publisher: 'Various',
          publication_year: 2020,
          shelf_location: 'A1',
          created_at: now,
          updated_at: now
        }]);
      }
    }
  },

  async down(queryInterface) {
    // Optional: Cleanup
    await queryInterface.bulkDelete('library_books', null, {});
    await queryInterface.bulkDelete('library_settings', null, {});
    await queryInterface.bulkDelete('families', null, {});
    await queryInterface.bulkDelete('teachers', null, {});
    await queryInterface.bulkDelete('users', { role: ['accountant', 'parent'] }, {});
  }
};
