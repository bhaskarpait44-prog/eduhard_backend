'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();

    // 1. Retrieve default school
    const [schools] = await queryInterface.sequelize.query(
      `SELECT id FROM schools LIMIT 1;`
    );
    if (schools.length === 0) {
      throw new Error('Please run school-and-admin seeder first!');
    }
    const schoolId = schools[0].id;

    // 2. Clear existing transport stops and routes
    // Set student transport references to NULL first to prevent foreign key errors
    await queryInterface.sequelize.query('UPDATE students SET transport_stop_id = NULL;');
    await queryInterface.sequelize.query('DELETE FROM transport_stops;');
    await queryInterface.sequelize.query('DELETE FROM transport_routes;');

    // 3. Define 10 transport routes
    const routes = [
      { name: 'Route 1 - Zoo Road Line', driver_name: 'Ramesh Dutta', driver_phone: '9864223344', vehicle_number: 'AS-01-EC-1234' },
      { name: 'Route 2 - Ganeshguri Line', driver_name: 'Bhaben Kalita', driver_phone: '9864334455', vehicle_number: 'AS-01-EC-5678' },
      { name: 'Route 3 - Paltan Bazar Line', driver_name: 'Kamal Das', driver_phone: '9864445566', vehicle_number: 'AS-01-EC-9012' },
      { name: 'Route 4 - Khanapara Line', driver_name: 'Robin Sarma', driver_phone: '9864556677', vehicle_number: 'AS-01-EC-3456' },
      { name: 'Route 5 - Jalukbari Line', driver_name: 'Utpal Deka', driver_phone: '9864667788', vehicle_number: 'AS-01-EC-7890' },
      { name: 'Route 6 - Chandmari Line', driver_name: 'Dilip Bhuyan', driver_phone: '9864778899', vehicle_number: 'AS-01-EC-2345' },
      { name: 'Route 7 - Six Mile Line', driver_name: 'Pradip Gogoi', driver_phone: '9864889900', vehicle_number: 'AS-01-EC-6789' },
      { name: 'Route 8 - Kahilipara Line', driver_name: 'Jatin Nath', driver_phone: '9864990011', vehicle_number: 'AS-01-EC-0123' },
      { name: 'Route 9 - Beltola Line', driver_name: 'Sanjib Barman', driver_phone: '9864112255', vehicle_number: 'AS-01-EC-4567' },
      { name: 'Route 10 - Noonmati Line', driver_name: 'Sarat Saikia', driver_phone: '9864223366', vehicle_number: 'AS-01-EC-8901' }
    ];

    // Define stops templates for the routes
    const stopsTemplates = [
      [
        { name: 'Zoo Road Tiniali', pickup: '07:15:00', drop: '14:15:00', fare: 1200.00 },
        { name: 'Geetanagar Bus Stop', pickup: '07:25:00', drop: '14:05:00', fare: 1300.00 },
        { name: 'RG Baruah Road Crossing', pickup: '07:35:00', drop: '13:55:00', fare: 1100.00 }
      ],
      [
        { name: 'Ganeshguri Flyover', pickup: '07:10:00', drop: '14:20:00', fare: 1400.00 },
        { name: 'Dispur Last Gate', pickup: '07:20:00', drop: '14:10:00', fare: 1500.00 },
        { name: 'Supermarket Bus Stop', pickup: '07:30:00', drop: '14:00:00', fare: 1350.00 }
      ],
      [
        { name: 'Paltan Bazar ASTC Station', pickup: '07:00:00', drop: '14:35:00', fare: 1800.00 },
        { name: 'Ulubari Chariali', pickup: '07:12:00', drop: '14:23:00', fare: 1700.00 },
        { name: 'Bhangagarh Bus Stop', pickup: '07:22:00', drop: '14:13:00', fare: 1600.00 }
      ],
      [
        { name: 'Khanapara Koinadhara', pickup: '07:05:00', drop: '14:30:00', fare: 1900.00 },
        { name: 'Jayanagar Chariali', pickup: '07:15:00', drop: '14:20:00', fare: 1800.00 },
        { name: 'Beltola Tiniali', pickup: '07:25:00', drop: '14:10:00', fare: 1600.00 }
      ],
      [
        { name: 'Jalukbari Rotary', pickup: '06:45:00', drop: '14:50:00', fare: 2200.00 },
        { name: 'Adabari Bus Stand', pickup: '06:58:00', drop: '14:37:00', fare: 2000.00 },
        { name: 'Maligaon Chariali', pickup: '07:08:00', drop: '14:27:00', fare: 1900.00 }
      ],
      [
        { name: 'Chandmari Colony', pickup: '07:15:00', drop: '14:15:00', fare: 1200.00 },
        { name: 'Silpukhuri Junction', pickup: '07:25:00', drop: '14:05:00', fare: 1300.00 },
        { name: 'Guwahati Club', pickup: '07:35:00', drop: '13:55:00', fare: 1400.00 }
      ],
      [
        { name: 'Six Mile Junction', pickup: '07:12:00', drop: '14:18:00', fare: 1500.00 },
        { name: 'Chachal Road', pickup: '07:22:00', drop: '14:08:00', fare: 1400.00 },
        { name: 'VIP Road Crossing', pickup: '07:32:00', drop: '13:58:00', fare: 1300.00 }
      ],
      [
        { name: 'Kahilipara Colony', pickup: '07:08:00', drop: '14:22:00', fare: 1600.00 },
        { name: 'Lal Ganesh Junction', pickup: '07:18:00', drop: '14:12:00', fare: 1500.00 },
        { name: 'Odalbakra Point', pickup: '07:28:00', drop: '14:02:00', fare: 1450.00 }
      ],
      [
        { name: 'Beltola Survey', pickup: '07:18:00', drop: '14:12:00', fare: 1550.00 },
        { name: 'Bhetapara Chariali', pickup: '07:28:00', drop: '14:02:00', fare: 1650.00 },
        { name: 'Hatigaon Road', pickup: '07:38:00', drop: '13:52:00', fare: 1450.00 }
      ],
      [
        { name: 'Noonmati Sector 1', pickup: '07:05:00', drop: '14:25:00', fare: 1500.00 },
        { name: 'Refinery Gate', pickup: '07:15:00', drop: '14:15:00', fare: 1400.00 },
        { name: 'Choonsali Area', pickup: '07:25:00', drop: '14:05:00', fare: 1600.00 }
      ]
    ];

    console.log(`Seeding 10 transport routes and 30 stops...`);

    for (let rIndex = 0; rIndex < routes.length; rIndex++) {
      const r = routes[rIndex];

      // 1. Insert route
      await queryInterface.bulkInsert('transport_routes', [{
        school_id: schoolId,
        name: r.name,
        vehicle_number: r.vehicle_number,
        driver_name: r.driver_name,
        driver_phone: r.driver_phone,
        created_at: now,
        updated_at: now
      }]);

      // 2. Fetch the newly inserted route ID
      const [routeRow] = await queryInterface.sequelize.query(
        `SELECT id FROM transport_routes WHERE name = :name AND school_id = :schoolId LIMIT 1;`,
        { replacements: { name: r.name, schoolId } }
      );
      const routeId = routeRow[0].id;

      // 3. Insert stops for this route
      const stops = stopsTemplates[rIndex];
      for (const stop of stops) {
        await queryInterface.bulkInsert('transport_stops', [{
          route_id: routeId,
          name: stop.name,
          pickup_time: stop.pickup,
          drop_time: stop.drop,
          fare: stop.fare,
          created_at: now,
          updated_at: now
        }]);
      }
    }

    // 4. Fetch all inserted stop IDs
    const [stopsRows] = await queryInterface.sequelize.query(
      `SELECT id FROM transport_stops;`
    );
    const stopIds = stopsRows.map(s => s.id);

    // 5. Fetch active students to assign to these routes
    const [studentsRows] = await queryInterface.sequelize.query(
      `SELECT id FROM students WHERE is_deleted = false AND status = 'active' ORDER BY id ASC;`
    );

    // Assign approximately 150 students to random transport stops
    console.log(`Assigning 150 students to transport stops...`);
    const studentCountToAssign = Math.min(studentsRows.length, 150);

    for (let i = 0; i < studentCountToAssign; i++) {
      const studentId = studentsRows[i].id;
      const randomStopId = stopIds[i % stopIds.length];

      await queryInterface.sequelize.query(
        `UPDATE students SET transport_stop_id = :stopId WHERE id = :studentId;`,
        { replacements: { stopId: randomStopId, studentId } }
      );
    }

    console.log(`Successfully completed seeding transport system!`);
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('UPDATE students SET transport_stop_id = NULL;');
    await queryInterface.sequelize.query('DELETE FROM transport_stops;');
    await queryInterface.sequelize.query('DELETE FROM transport_routes;');
  }
};
