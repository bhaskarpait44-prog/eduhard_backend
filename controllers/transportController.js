'use strict';

const sequelize = require('../config/database');

exports.getRoutes = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;

    const [routes] = await sequelize.query(`
      SELECT 
        r.id, r.name, r.vehicle_number, r.driver_name, r.driver_phone,
        COALESCE(
          (
            SELECT JSON_AGG(
              JSON_BUILD_OBJECT(
                'id', s.id,
                'name', s.name,
                'pickup_time', s.pickup_time,
                'drop_time', s.drop_time,
                'fare', s.fare,
                'student_count', (SELECT COUNT(id)::int FROM students WHERE transport_stop_id = s.id AND is_deleted = false)
              ) ORDER BY s.pickup_time ASC
            )
            FROM transport_stops s
            WHERE s.route_id = r.id
          ),
          '[]'::json
        ) AS stops
      FROM transport_routes r
      WHERE r.school_id = :schoolId
      ORDER BY r.name ASC;
    `, { replacements: { schoolId } });

    res.ok(routes);
  } catch (err) { next(err); }
};

exports.createRoute = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { name, vehicle_number, driver_name, driver_phone } = req.body;

    const [route] = await sequelize.query(`
      INSERT INTO transport_routes (school_id, name, vehicle_number, driver_name, driver_phone, created_at, updated_at)
      VALUES (:schoolId, :name, :vehicle_number, :driver_name, :driver_phone, NOW(), NOW())
      RETURNING *
    `, { replacements: { schoolId, name, vehicle_number, driver_name, driver_phone } });

    res.ok(route[0], 'Route created.', 201);
  } catch (err) { next(err); }
};

exports.updateRoute = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { name, vehicle_number, driver_name, driver_phone } = req.body;

    const [result] = await sequelize.query(`
      UPDATE transport_routes SET
        name = :name, vehicle_number = :vehicle_number, 
        driver_name = :driver_name, driver_phone = :driver_phone, 
        updated_at = NOW()
      WHERE id = :id AND school_id = :schoolId
      RETURNING *
    `, { replacements: { id, schoolId, name, vehicle_number, driver_name, driver_phone } });

    if (result.length === 0) return res.fail('Route not found.', [], 404);

    res.ok(result[0], 'Route updated.');
  } catch (err) { next(err); }
};

exports.deleteRoute = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const [result] = await sequelize.query(`
      DELETE FROM transport_routes WHERE id = :id AND school_id = :schoolId RETURNING id
    `, { replacements: { id, schoolId } });

    if (result.length === 0) return res.fail('Route not found.', [], 404);

    res.ok(null, 'Route deleted.');
  } catch (err) { next(err); }
};

// ── Stops ────────────────────────────────────────────────────────────────────

exports.createStop = async (req, res, next) => {
  try {
    const { route_id } = req.params;
    const { name, pickup_time, drop_time, fare } = req.body;

    const [stop] = await sequelize.query(`
      INSERT INTO transport_stops (route_id, name, pickup_time, drop_time, fare, created_at, updated_at)
      VALUES (:route_id, :name, :pickup_time, :drop_time, :fare, NOW(), NOW())
      RETURNING *
    `, { replacements: { 
      route_id, name, 
      pickup_time: pickup_time || null, 
      drop_time: drop_time || null, 
      fare: fare || 0 
    } });

    res.ok(stop[0], 'Stop created.', 201);
  } catch (err) { next(err); }
};

exports.updateStop = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, pickup_time, drop_time, fare } = req.body;

    const [result] = await sequelize.query(`
      UPDATE transport_stops SET
        name = :name, pickup_time = :pickup_time, 
        drop_time = :drop_time, fare = :fare, 
        updated_at = NOW()
      WHERE id = :id
      RETURNING *
    `, { replacements: { 
      id, name, 
      pickup_time: pickup_time || null, 
      drop_time: drop_time || null, 
      fare: fare || 0 
    } });

    if (result.length === 0) return res.fail('Stop not found.', [], 404);

    res.ok(result[0], 'Stop updated.');
  } catch (err) { next(err); }
};

exports.deleteStop = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await sequelize.query(`
      DELETE FROM transport_stops WHERE id = :id RETURNING id
    `, { replacements: { id } });

    if (result.length === 0) return res.fail('Stop not found.', [], 404);

    res.ok(null, 'Stop deleted.');
  } catch (err) { next(err); }
};

// ── Assign Student ───────────────────────────────────────────────────────────

exports.assignStudent = async (req, res, next) => {
  try {
    const { student_id, transport_stop_id } = req.body;
    const schoolId = req.user.school_id;

    const [result] = await sequelize.query(`
      UPDATE students SET transport_stop_id = :transport_stop_id, updated_at = NOW()
      WHERE id = :student_id AND school_id = :schoolId
      RETURNING *
    `, { replacements: { student_id, transport_stop_id: transport_stop_id || null, schoolId } });

    if (result.length === 0) return res.fail('Student not found.', [], 404);
    
    res.ok(result[0], 'Transport assignment updated.');
  } catch (err) { next(err); }
};
