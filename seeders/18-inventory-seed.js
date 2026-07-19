'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // 1. Retrieve default school and admin user ID
    const [schools] = await queryInterface.sequelize.query(
      `SELECT id FROM schools LIMIT 1;`
    );
    if (schools.length === 0) {
      throw new Error('Please run school-and-admin seeder first!');
    }
    const schoolId = schools[0].id;

    const [admins] = await queryInterface.sequelize.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1;`
    );
    const adminId = admins.length > 0 ? admins[0].id : null;

    // 2. Clear existing inventory transactions and items
    await queryInterface.sequelize.query('DELETE FROM inventory_transactions;');
    await queryInterface.sequelize.query('DELETE FROM inventory_items;');

    // 3. Define 40 inventory item templates
    const templates = [
      // Stationery (6 items)
      { name: 'Whiteboard Markers (Blue)', category: 'Stationery', unit: 'Box', reorder_level: 5, unit_price: 250.00, location: 'Store Room A', qtyIn: 25, qtyOut: 12, desc: 'Pack of 10 blue markers for classroom whiteboards.' },
      { name: 'Whiteboard Markers (Black)', category: 'Stationery', unit: 'Box', reorder_level: 5, unit_price: 250.00, location: 'Store Room A', qtyIn: 25, qtyOut: 15, desc: 'Pack of 10 black markers for classroom whiteboards.' },
      { name: 'Chalk Box (Dustless White)', category: 'Stationery', unit: 'Box', reorder_level: 10, unit_price: 80.00, location: 'Store Room A', qtyIn: 50, qtyOut: 30, desc: 'Calcium carbonate dustless chalk box containing 100 pieces.' },
      { name: 'Wooden Duster', category: 'Stationery', unit: 'Piece', reorder_level: 8, unit_price: 45.00, location: 'Store Room A', qtyIn: 30, qtyOut: 18, desc: 'Premium wooden whiteboard duster with felt padding.' },
      { name: 'A4 Printing Paper Reams', category: 'Stationery', unit: 'Ream', reorder_level: 15, unit_price: 320.00, location: 'Store Room A', qtyIn: 100, qtyOut: 65, desc: '80GSM premium A4 printing paper ream (500 sheets).' },
      { name: 'Class Attendance Register Book', category: 'Stationery', unit: 'Piece', reorder_level: 5, unit_price: 120.00, location: 'Store Room A', qtyIn: 45, qtyOut: 36, desc: 'Paperbound attendance register ledger for class teachers.' },
      // Laboratory (6 items)
      { name: 'Borosilicate Glass Beaker 250ml', category: 'Laboratory', unit: 'Piece', reorder_level: 10, unit_price: 150.00, location: 'Science Lab', qtyIn: 40, qtyOut: 5, desc: 'Heat-resistant borosilicate beaker for science experiments.' },
      { name: 'Test Tubes (Pack of 50)', category: 'Laboratory', unit: 'Pack', reorder_level: 3, unit_price: 600.00, location: 'Science Lab', qtyIn: 10, qtyOut: 2, desc: 'Rimmed glass test tubes with size 15x125mm.' },
      { name: 'Litmus Paper Blue', category: 'Laboratory', unit: 'Pack', reorder_level: 5, unit_price: 45.00, location: 'Science Lab', qtyIn: 20, qtyOut: 8, desc: 'Acid indicator blue litmus paper strips book.' },
      { name: 'Litmus Paper Red', category: 'Laboratory', unit: 'Pack', reorder_level: 5, unit_price: 45.00, location: 'Science Lab', qtyIn: 20, qtyOut: 7, desc: 'Base indicator red litmus paper strips book.' },
      { name: 'Conical Flask 500ml', category: 'Laboratory', unit: 'Piece', reorder_level: 6, unit_price: 220.00, location: 'Science Lab', qtyIn: 25, qtyOut: 4, desc: 'Narrow mouth Erlenmeyer flask for lab use.' },
      { name: 'Microscope Slides Box (50 pcs)', category: 'Laboratory', unit: 'Box', reorder_level: 4, unit_price: 180.00, location: 'Science Lab', qtyIn: 15, qtyOut: 6, desc: 'Pre-cleaned glass slides with ground edges.' },
      // Sports (6 items)
      { name: 'Cosco Football (Size 5)', category: 'Sports', unit: 'Piece', reorder_level: 3, unit_price: 650.00, location: 'Sports Room', qtyIn: 12, qtyOut: 4, desc: 'FIFA-approved synthetic hand-stitched football.' },
      { name: 'Cricket Bat (Kashmir Willow)', category: 'Sports', unit: 'Piece', reorder_level: 2, unit_price: 1200.00, location: 'Sports Room', qtyIn: 8, qtyOut: 3, desc: 'Standard short-handle willow bat with rubber grip.' },
      { name: 'Cricket Leather Balls (Red)', category: 'Sports', unit: 'Piece', reorder_level: 6, unit_price: 250.00, location: 'Sports Room', qtyIn: 24, qtyOut: 12, desc: 'Alum tanned four-piece leather ball for matches.' },
      { name: 'YONEX Mavis 350 Shuttlecock', category: 'Sports', unit: 'Tube', reorder_level: 5, unit_price: 900.00, location: 'Sports Room', qtyIn: 15, qtyOut: 8, desc: 'Nylon shuttlecock tube containing 6 yellow shuttles.' },
      { name: 'Badminton Racket (Carbon Steel)', category: 'Sports', unit: 'Piece', reorder_level: 4, unit_price: 850.00, location: 'Sports Room', qtyIn: 20, qtyOut: 10, desc: 'Lightweight pre-strung steel badminton racket.' },
      { name: 'Nivia Basketball (Size 7)', category: 'Sports', unit: 'Piece', reorder_level: 2, unit_price: 750.00, location: 'Sports Room', qtyIn: 10, qtyOut: 3, desc: 'Deep channel rubber composite outdoor basketball.' },
      // Furniture (5 items)
      { name: 'Student Single Desk', category: 'Furniture', unit: 'Piece', reorder_level: 10, unit_price: 2400.00, location: 'Main Building', qtyIn: 80, qtyOut: 70, desc: 'Dual-wood student desk with iron frame and shelf.' },
      { name: 'Student Chair', category: 'Furniture', unit: 'Piece', reorder_level: 10, unit_price: 850.00, location: 'Main Building', qtyIn: 80, qtyOut: 70, desc: 'Ergonomic plastic seat student chair with steel legs.' },
      { name: 'Teacher Wooden Table', category: 'Furniture', unit: 'Piece', reorder_level: 2, unit_price: 4500.00, location: 'Main Building', qtyIn: 20, qtyOut: 18, desc: 'Polished wooden table with double drawers.' },
      { name: 'Teacher Chair (Ergonomic)', category: 'Furniture', unit: 'Piece', reorder_level: 2, unit_price: 3500.00, location: 'Staff Room', qtyIn: 20, qtyOut: 18, desc: 'Mid-back mesh desk chair with lumbar support.' },
      { name: 'Steel Filing Cabinet (4 Drawer)', category: 'Furniture', unit: 'Piece', reorder_level: 1, unit_price: 8500.00, location: 'Office', qtyIn: 6, qtyOut: 5, desc: 'Fireproof heavy-duty vertical filing cabinet.' },
      // IT Equipment (6 items)
      { name: 'Dell Vostro 15 Laptop', category: 'IT Equipment', unit: 'Piece', reorder_level: 2, unit_price: 45000.00, location: 'Staff Room', qtyIn: 8, qtyOut: 5, desc: 'Intel i5 laptop with 8GB RAM for faculty staff.' },
      { name: 'Epson Projector EB-E01', category: 'IT Equipment', unit: 'Piece', reorder_level: 1, unit_price: 36000.00, location: 'Seminar Hall', qtyIn: 5, qtyOut: 4, desc: '3LCD projector with XGA resolution and HDMI support.' },
      { name: 'Logitech USB Optical Mouse', category: 'IT Equipment', unit: 'Piece', reorder_level: 5, unit_price: 350.00, location: 'Computer Lab', qtyIn: 50, qtyOut: 42, desc: 'Simple USB plug-and-play wired mouse.' },
      { name: 'Logitech Keyboard K120', category: 'IT Equipment', unit: 'Piece', reorder_level: 5, unit_price: 650.00, location: 'Computer Lab', qtyIn: 50, qtyOut: 40, desc: 'Spill-resistant USB wired full-size keyboard.' },
      { name: 'TP-Link Gigabit Wi-Fi Router', category: 'IT Equipment', unit: 'Piece', reorder_level: 2, unit_price: 1800.00, location: 'Main Building', qtyIn: 10, qtyOut: 8, desc: 'Dual-band gigabit wireless router for corridors.' },
      { name: 'HDMI Cable 5 meters', category: 'IT Equipment', unit: 'Piece', reorder_level: 3, unit_price: 450.00, location: 'Store Room B', qtyIn: 15, qtyOut: 9, desc: 'High-speed male-to-male gold-plated HDMI cable.' },
      // Medical (5 items)
      { name: 'First Aid Kit Box', category: 'Medical', unit: 'Piece', reorder_level: 2, unit_price: 650.00, location: 'Infirmary', qtyIn: 10, qtyOut: 6, desc: 'Wall-mounted emergency kit containing basic medicines.' },
      { name: 'Band-Aid Strips (Box of 100)', category: 'Medical', unit: 'Box', reorder_level: 3, unit_price: 150.00, location: 'Infirmary', qtyIn: 12, qtyOut: 8, desc: 'Plastic washproof bandages strip box.' },
      { name: 'Dettol Antiseptic Liquid 500ml', category: 'Medical', unit: 'Bottle', reorder_level: 4, unit_price: 220.00, location: 'Infirmary', qtyIn: 15, qtyOut: 10, desc: 'Antiseptic disinfectant liquid for wound cleaning.' },
      { name: 'Paracetamol Tablets 650mg', category: 'Medical', unit: 'Strip', reorder_level: 10, unit_price: 30.00, location: 'Infirmary', qtyIn: 50, qtyOut: 35, desc: 'Fever and pain relief tablet strips.' },
      { name: 'Digital Thermometer', category: 'Medical', unit: 'Piece', reorder_level: 2, unit_price: 180.00, location: 'Infirmary', qtyIn: 8, qtyOut: 5, desc: 'Fast reading clinical digital thermometer.' },
      // Cleaning (6 items)
      { name: 'Floor Mop with Spinner Bucket', category: 'Cleaning', unit: 'Set', reorder_level: 3, unit_price: 750.00, location: 'Janitor Room', qtyIn: 15, qtyOut: 11, desc: '360 rotating microfibre mop with steel spinner.' },
      { name: 'Lizol Floor Cleaner 5L', category: 'Cleaning', unit: 'Can', reorder_level: 2, unit_price: 850.00, location: 'Janitor Room', qtyIn: 10, qtyOut: 7, desc: 'Disinfectant floor cleaner liquid can.' },
      { name: 'Liquid Handwash 5L Can', category: 'Cleaning', unit: 'Can', reorder_level: 2, unit_price: 650.00, location: 'Janitor Room', qtyIn: 10, qtyOut: 8, desc: 'Moisturizing liquid hand wash refills can.' },
      { name: 'Large Plastic Trash Bins', category: 'Cleaning', unit: 'Piece', reorder_level: 5, unit_price: 450.00, location: 'Corridors', qtyIn: 25, qtyOut: 20, desc: '60L pedal-operated plastic dustbin for waste.' },
      { name: 'Microfiber Cleaning Cloths (5 pk)', category: 'Cleaning', unit: 'Pack', reorder_level: 4, unit_price: 250.00, location: 'Janitor Room', qtyIn: 20, qtyOut: 14, desc: 'Absorbent lint-free surface cleaning cloth packs.' },
      { name: 'Toilet Cleaning Brush', category: 'Cleaning', unit: 'Piece', reorder_level: 3, unit_price: 90.00, location: 'Janitor Room', qtyIn: 12, qtyOut: 9, desc: 'Ergonomic double-sided bristled toilet brush.' }
    ];

    console.log(`Seeding 40 inventory items and transactions...`);

    for (const t of templates) {
      // Calculate remaining quantity
      const currentQty = t.qtyIn - t.qtyOut;

      // 1. Insert Inventory Item
      await queryInterface.bulkInsert('inventory_items', [{
        school_id: schoolId,
        name: t.name,
        category: t.category,
        unit: t.unit,
        quantity: currentQty,
        reorder_level: t.reorder_level,
        description: t.desc,
        location: t.location,
        unit_price: t.unit_price,
        created_at: now,
        updated_at: now
      }]);

      // 2. Fetch the newly inserted item ID
      const [itemRow] = await queryInterface.sequelize.query(
        `SELECT id FROM inventory_items WHERE name = :name AND school_id = :schoolId LIMIT 1;`,
        { replacements: { name: t.name, schoolId } }
      );
      const itemId = itemRow[0].id;

      // 3. Create 'in' transaction (Stock Purchase)
      await queryInterface.bulkInsert('inventory_transactions', [{
        item_id: itemId,
        type: 'in',
        quantity: t.qtyIn,
        date: '2026-04-05',
        vendor: 'Eastern School Supplies Ltd.',
        remarks: 'Initial stock intake for academic session.',
        performed_by: adminId,
        created_at: now,
        updated_at: now
      }]);

      // 4. Create 'out' transaction (Stock Issue)
      if (t.qtyOut > 0) {
        await queryInterface.bulkInsert('inventory_transactions', [{
          item_id: itemId,
          type: 'out',
          quantity: t.qtyOut,
          date: '2026-05-10',
          vendor: null,
          remarks: `Issued to staff and campus departments for daily operations.`,
          performed_by: adminId,
          created_at: now,
          updated_at: now
        }]);
      }
    }

    console.log(`Successfully completed seeding 40 inventory items and transactions!`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DELETE FROM inventory_transactions;');
    await queryInterface.sequelize.query('DELETE FROM inventory_items;');
  }
};
