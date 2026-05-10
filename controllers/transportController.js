'use strict';

const sequelize = require('../config/database');
const { TransportRoute, TransportStop, Student } = require('../models');

exports.getRoutes = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;

    const [routes] = await sequelize.query(`
      SELECT 
        r.id, r.name, r.vehicle_number, r.driver_name, r.driver_phone,
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', s.id,
              'name', s.name,
              'pickup_time', s.pickup_time,
              'drop_time', s.drop_time,
              'fare', s.fare,
              'student_count', (SELECT COUNT(id) FROM students WHERE transport_stop_id = s.id AND is_deleted = false AND status = 'active')
            ) ORDER BY s.pickup_time ASC
          ) FILTER (WHERE s.id IS NOT NULL),
          '[]'::json
        ) AS stops
      FROM transport_routes r
      LEFT JOIN transport_stops s ON s.route_id = r.id
      WHERE r.school_id = :schoolId
      GROUP BY r.id
      ORDER BY r.name ASC;
    `, { replacements: { schoolId } });

    res.ok(routes);
  } catch (err) { next(err); }
};

exports.createRoute = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { name, vehicle_number, driver_name, driver_phone } = req.body;

    const route = await TransportRoute.create({
      school_id: schoolId, name, vehicle_number, driver_name, driver_phone
    });

    res.ok(route, 'Route created.', 201);
  } catch (err) { next(err); }
};

exports.updateRoute = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;
    const { name, vehicle_number, driver_name, driver_phone } = req.body;

    const route = await TransportRoute.findOne({ where: { id, school_id: schoolId } });
    if (!route) return res.fail('Route not found.', [], 404);

    await route.update({ name, vehicle_number, driver_name, driver_phone });
    res.ok(route, 'Route updated.');
  } catch (err) { next(err); }
};

exports.deleteRoute = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    await TransportRoute.destroy({ where: { id, school_id: schoolId } });
    res.ok(null, 'Route deleted.');
  } catch (err) { next(err); }
};

// ── Stops ────────────────────────────────────────────────────────────────────

exports.createStop = async (req, res, next) => {
  try {
    const { route_id } = req.params;
    const { name, pickup_time, drop_time, fare } = req.body;

    const stop = await TransportStop.create({
      route_id, name, pickup_time: pickup_time || null, drop_time: drop_time || null, fare: fare || 0
    });

    res.ok(stop, 'Stop created.', 201);
  } catch (err) { next(err); }
};

exports.updateStop = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, pickup_time, drop_time, fare } = req.body;

    const stop = await TransportStop.findByPk(id);
    if (!stop) return res.fail('Stop not found.', [], 404);

    await stop.update({ name, pickup_time: pickup_time || null, drop_time: drop_time || null, fare: fare || 0 });
    res.ok(stop, 'Stop updated.');
  } catch (err) { next(err); }
};

exports.deleteStop = async (req, res, next) => {
  try {
    const { id } = req.params;
    await TransportStop.destroy({ where: { id } });
    res.ok(null, 'Stop deleted.');
  } catch (err) { next(err); }
};

// ── Assign Student ───────────────────────────────────────────────────────────

exports.assignStudent = async (req, res, next) => {
  try {
    const { student_id, transport_stop_id } = req.body;
    const schoolId = req.user.school_id;

    const student = await Student.findOne({ where: { id: student_id, school_id: schoolId } });
    if (!student) return res.fail('Student not found.', [], 404);

    await student.update({ transport_stop_id: transport_stop_id || null });
    
    res.ok(student, 'Transport assignment updated.');
  } catch (err) { next(err); }
};
