'use strict';
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const validate = require('../middlewares/validate');
const { requireAdmin, requireAdminOrTeacher } = require('../middlewares/auth');
const ctrl = require('../controllers/alumniController');

// 1. Static/Specific Routes (Must come before wildcards like :id)
router.get('/stats', requireAdminOrTeacher, ctrl.getAlumniStats);

router.get('/directory', requireAdminOrTeacher, [
  query('page').optional().isInt({ min: 1 }),
  query('perPage').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString().trim(),
  query('batch_year').optional().isInt(),
  query('occupation').optional().isIn(['employed','self_employed','higher_studies','unemployed','other']),
  query('city').optional().isString(),
  query('is_mentor').optional().isBoolean(),
], validate, ctrl.getAlumniDirectory);

router.get('/directory/download', requireAdminOrTeacher, ctrl.downloadAlumniDirectoryPdf);

// 2. Events Routes (Must come before :id)
router.get('/events',       requireAdminOrTeacher, ctrl.listEvents);
router.post('/events',      requireAdmin, [
  body('title').notEmpty(),
  body('event_date').isDate(),
  body('type').isIn(['reunion','seminar','felicitation','networking','other']),
], validate, ctrl.createEvent);
router.put('/events/:id',   requireAdmin, param('id').isInt(), validate, ctrl.updateEvent);
router.delete('/events/:id',requireAdmin, param('id').isInt(), validate, ctrl.deleteEvent);

// 3. Wildcard Routes
router.get('/:id', requireAdminOrTeacher, param('id').isInt(), validate, ctrl.getAlumniProfile);

router.put('/:id/profile', requireAdmin, [
  param('id').isInt(),
  body('current_occupation').optional().isIn(['employed','self_employed','higher_studies','unemployed','other']),
  body('contact_email').optional({ checkFalsy: true }).isEmail(),
  body('linkedin_url').optional({ checkFalsy: true }).isURL(),
  body('higher_edu_year').optional({ checkFalsy: true }).isInt({ min: 1990, max: 2099 }),
], validate, ctrl.upsertAlumniProfile);

module.exports = router;
