'use strict';

module.exports = {
  async up(queryInterface) {
    const now = new Date();
    
    // 1. Transport Routes
    await queryInterface.bulkInsert('transport_routes', [
      { id: 1, school_id: 1, name: 'Route 01 - North Guwahati', vehicle_number: 'AS-01-AX-1234', driver_name: 'Bimal Das', driver_phone: '9864012345', created_at: now, updated_at: now },
      { id: 2, school_id: 1, name: 'Route 02 - Beltola', vehicle_number: 'AS-01-AX-5678', driver_name: 'Ratul Ali', driver_phone: '9864056789', created_at: now, updated_at: now }
    ], { ignoreDuplicates: true });

    // 2. Transport Stops
    await queryInterface.bulkInsert('transport_stops', [
      { id: 1, route_id: 1, name: 'Jalukbari', pickup_time: '07:30:00', fare: 1500, created_at: now, updated_at: now },
      { id: 2, route_id: 1, name: 'Maligaon', pickup_time: '07:45:00', fare: 1200, created_at: now, updated_at: now },
      { id: 3, route_id: 2, name: 'Six Mile', pickup_time: '07:20:00', fare: 1800, created_at: now, updated_at: now }
    ], { ignoreDuplicates: true });

    // 3. Inventory Items
    await queryInterface.bulkInsert('inventory_items', [
      { id: 1, school_id: 1, name: 'Chalk Box', category: 'Stationery', unit: 'box', quantity: 50, reorder_level: 10, created_at: now, updated_at: now },
      { id: 2, school_id: 1, name: 'A4 Paper Bundle', category: 'Stationery', unit: 'bundle', quantity: 20, reorder_level: 5, created_at: now, updated_at: now },
      { id: 3, school_id: 1, name: 'Football', category: 'Sports', unit: 'piece', quantity: 10, reorder_level: 2, created_at: now, updated_at: now }
    ], { ignoreDuplicates: true });

    // 4. Inventory Transactions (Add some stock)
    await queryInterface.bulkInsert('inventory_transactions', [
      { item_id: 1, type: 'in', quantity: 50, date: now, performed_by: 1, created_at: now, updated_at: now },
      { item_id: 2, type: 'in', quantity: 20, date: now, performed_by: 1, created_at: now, updated_at: now },
      { item_id: 3, type: 'in', quantity: 10, date: now, performed_by: 1, created_at: now, updated_at: now }
    ]);
  },

  async down(queryInterface) {
    await queryInterface.bulkDelete('inventory_transactions', null, {});
    await queryInterface.bulkDelete('inventory_items', null, {});
    await queryInterface.bulkDelete('transport_stops', null, {});
    await queryInterface.bulkDelete('transport_routes', null, {});
  }
};
