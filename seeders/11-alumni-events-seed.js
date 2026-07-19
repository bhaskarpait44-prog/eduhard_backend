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

    // 2. Clear existing events to prevent duplication on multiple runs
    await queryInterface.sequelize.query('DELETE FROM alumni_events;');

    // 3. Define alumni events
    const events = [
      {
        school_id: schoolId,
        title: 'Annual Alumni Reunion 2026',
        description: 'Join us for the grand annual reunion of Greenwood Academy alumni. A day filled with nostalgia, networking, cultural events, and delicious dinner.',
        event_date: '2026-12-25',
        event_time: '10:00 AM',
        venue: 'Main Auditorium, Greenwood Academy Campus',
        type: 'reunion',
        status: 'upcoming',
        created_at: now,
        updated_at: now
      },
      {
        school_id: schoolId,
        title: 'Career Guidance Seminar: Campus to Corporate',
        description: 'A seminar where our successful alumni working in tech, healthcare, and finance share their professional journeys and guide higher secondary students.',
        event_date: '2026-08-15',
        event_time: '02:00 PM',
        venue: 'Conference Hall, Greenwood Academy Campus',
        type: 'seminar',
        status: 'upcoming',
        created_at: now,
        updated_at: now
      },
      {
        school_id: schoolId,
        title: 'Alumni Networking Dinner - Bangalore Chapter',
        description: 'An exclusive networking dinner for Greenwood Academy alumni residing in Bangalore to connect and discuss professional opportunities.',
        event_date: '2026-10-10',
        event_time: '07:30 PM',
        venue: 'The Grand Ballroom, Hotel Orchid, Bangalore',
        type: 'networking',
        status: 'upcoming',
        created_at: now,
        updated_at: now
      },
      {
        school_id: schoolId,
        title: 'Silver Jubilee Reunion (Class of 2001)',
        description: 'Celebration of the 25th graduation anniversary of the Class of 2001. Includes felicitation of former teachers and interactive sessions.',
        event_date: '2026-05-10',
        event_time: '09:00 AM',
        venue: 'Greenwood Academy Ground',
        type: 'reunion',
        status: 'completed',
        created_at: now,
        updated_at: now
      },
      {
        school_id: schoolId,
        title: 'Panel Discussion: Entrepreneurship & Startups',
        description: 'Successful alumni entrepreneurs sharing their experiences of building startups, raising capital, and managing growth.',
        event_date: '2026-06-20',
        event_time: '11:00 AM',
        venue: 'Seminar Room 2, Science Block',
        type: 'seminar',
        status: 'completed',
        created_at: now,
        updated_at: now
      },
      {
        school_id: schoolId,
        title: 'Alumni Excellence Felicitation Ceremony',
        description: 'Felicitation of alumni who have achieved exceptional milestones in academics, public services, and sports in the past year.',
        event_date: '2026-09-05',
        event_time: '10:00 AM',
        venue: 'Main Auditorium',
        type: 'felicitation',
        status: 'upcoming',
        created_at: now,
        updated_at: now
      }
    ];

    await queryInterface.bulkInsert('alumni_events', events);
    console.log('Seeded 6 alumni events successfully!');
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query('DELETE FROM alumni_events;');
  }
};
