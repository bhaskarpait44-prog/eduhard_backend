'use strict';

const { Stream } = require('../models');
const sequelize = require('../config/database');
const { invalidateCache } = require('../middlewares/cache');

/**
 * List all streams for the school
 */
exports.list = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const streams = await Stream.findAll({
      where: { school_id: schoolId },
      order: [['name', 'ASC']],
    });
    res.ok(streams, 'Streams retrieved successfully.');
  } catch (err) {
    next(err);
  }
};

/**
 * Create a new stream
 */
exports.create = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const nameNormalized = String(req.body.name).trim().toLowerCase();

    // Prevent duplicate stream names in the same school
    const existing = await Stream.findOne({
      where: {
        school_id: schoolId,
        name: nameNormalized,
      },
    });

    if (existing) {
      return res.fail(`Stream "${req.body.name}" already exists.`, [], 409);
    }

    const stream = await Stream.create({
      school_id: schoolId,
      name: nameNormalized,
    });

    invalidateCache(schoolId, '/api/streams*');
    res.ok(stream, 'Stream created successfully.', 201);
  } catch (err) {
    next(err);
  }
};

/**
 * Delete a stream
 */
exports.delete = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { id } = req.params;

    const stream = await Stream.findOne({
      where: { id, school_id: schoolId },
    });

    if (!stream) {
      return res.fail('Stream not found.', [], 404);
    }

    const streamName = stream.name;

    // Check if any class is currently using this stream name
    const [[classUsage]] = await sequelize.query(`
      SELECT id FROM classes 
      WHERE school_id = :schoolId 
        AND LOWER(stream) = :streamName 
        AND is_deleted = false 
      LIMIT 1;
    `, { replacements: { schoolId, streamName: streamName.toLowerCase() } });

    if (classUsage) {
      return res.fail(`Cannot delete stream "${streamName}" because it is currently assigned to one or more classes.`, [], 400);
    }

    // Check if any active enrollment is currently using this stream name
    const [[enrollmentUsage]] = await sequelize.query(`
      SELECT e.id FROM enrollments e
      JOIN students s ON s.id = e.student_id
      WHERE s.school_id = :schoolId 
        AND LOWER(e.stream) = :streamName 
        AND e.status = 'active' 
      LIMIT 1;
    `, { replacements: { schoolId, streamName: streamName.toLowerCase() } });

    if (enrollmentUsage) {
      return res.fail(`Cannot delete stream "${streamName}" because it is currently assigned to active student enrollments.`, [], 400);
    }

    await stream.destroy();

    invalidateCache(schoolId, '/api/streams*');
    res.ok({}, 'Stream deleted successfully.');
  } catch (err) {
    next(err);
  }
};
