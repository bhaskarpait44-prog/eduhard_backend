'use strict';

const PDFDocument = require('pdfkit');
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { AlumniProfile, AlumniEvent, Student, School, User, StudentProfile } = require('../models');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function safeFileName(value, fallback = 'alumni-list') {
  return String(value || fallback)
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || fallback;
}

// ─── ALUMNI DIRECTORY ────────────────────────────────────────────────────────

/**
 * GET /api/alumni/directory
 * Paginated alumni list with optional filters.
 * Query params: page, perPage, search, batch_year, occupation, city, is_mentor
 */
exports.getAlumniDirectory = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const {
      page = 1,
      perPage = 20,
      search = '',
      batch_year,
      occupation,
      city,
      is_mentor
    } = req.query;

    const limitNum = parseInt(perPage, 10) || 20;
    const offsetNum = (parseInt(page, 10) - 1) * limitNum;

    const where = {
      school_id: schoolId,
      status: { [Op.in]: ['left', 'graduated'] },
      is_deleted: false
    };

    if (search) {
      where[Op.or] = [
        { first_name: { [Op.iLike]: `%${search}%` } },
        { last_name: { [Op.iLike]: `%${search}%` } },
        { admission_no: { [Op.iLike]: `%${search}%` } }
      ];
    }

    if (batch_year) {
      const year = parseInt(batch_year, 10);
      if (!isNaN(year)) {
        where[Op.and] = [
          sequelize.where(sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM left_date')), year)
        ];
      }
    }

    const alumniWhere = {};
    if (occupation) alumniWhere.current_occupation = occupation;
    if (city) alumniWhere.current_city = { [Op.iLike]: `%${city}%` };
    if (is_mentor !== undefined) alumniWhere.is_mentor_volunteer = is_mentor === 'true';

    const include = [
      {
        model: StudentProfile,
        as: 'profiles',
        where: { is_current: true },
        required: false,
        attributes: ['photo_path']
      }
    ];

    if (Object.keys(alumniWhere).length > 0) {
      include.push({
        model: AlumniProfile,
        as: 'alumniProfile',
        where: alumniWhere,
        required: true
      });
    } else {
      include.push({
        model: AlumniProfile,
        as: 'alumniProfile',
        required: false
      });
    }

    const { count, rows: students } = await Student.findAndCountAll({
      where,
      include,
      order: [['left_date', 'DESC']],
      limit: limitNum,
      offset: offsetNum,
      distinct: true
    });

    res.ok({
      students: students.map(s => ({
        id: s.id,
        admission_no: s.admission_no,
        first_name: s.first_name,
        last_name: s.last_name,
        status: s.status,
        left_date: s.left_date,
        photo_url: s.profiles?.[0]?.photo_path,
        alumniProfile: s.alumniProfile
      })),
      pagination: {
        total: count,
        page: parseInt(page, 10),
        perPage: limitNum,
        totalPages: Math.ceil(count / limitNum)
      }
    }, 'Alumni directory retrieved.');
  } catch (err) { next(err); }
};

/**
 * GET /api/alumni/:id
 * Full alumni profile for one student (student record + alumniProfile).
 */
exports.getAlumniProfile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const student = await Student.findOne({
      where: { id, school_id: schoolId, is_deleted: false },
      include: [
        { model: AlumniProfile, as: 'alumniProfile' },
        {
          model: StudentProfile,
          as: 'profiles',
          where: { is_current: true },
          required: false
        }
      ]
    });

    if (!student) return res.fail('Alumni profile not found.', [], 404);

    res.ok({
      student: {
        id: student.id,
        admission_no: student.admission_no,
        first_name: student.first_name,
        last_name: student.last_name,
        status: student.status,
        left_date: student.left_date,
        leaving_reason: student.leaving_reason,
        leaving_remarks: student.leaving_remarks,
        photo_url: student.profiles?.[0]?.photo_path
      },
      alumniProfile: student.alumniProfile
    }, 'Alumni profile retrieved.');
  } catch (err) { next(err); }
};

/**
 * PUT /api/alumni/:id/profile
 * Create or update the AlumniProfile for a graduated/left student.
 */
exports.upsertAlumniProfile = async (req, res, next) => {
  try {
    const { id: student_id } = req.params;
    const schoolId = req.user.school_id;
    const data = req.body;

    const student = await Student.findOne({
      where: { id: student_id, school_id: schoolId, is_deleted: false }
    });

    if (!student) return res.fail('Student not found.', [], 404);

    const [profile, created] = await AlumniProfile.findOrCreate({
      where: { student_id, school_id: schoolId },
      defaults: { ...data, school_id: schoolId, student_id, created_by: req.user.id }
    });

    if (!created) {
      await profile.update({
        ...data,
        profile_updated_at: new Date()
      });
    }

    res.ok(profile, `Alumni profile ${created ? 'created' : 'updated'} successfully.`);
  } catch (err) { next(err); }
};

// ─── STATS / DASHBOARD ───────────────────────────────────────────────────────

/**
 * GET /api/alumni/stats
 */
exports.getAlumniStats = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;

    const totalAlumni = await Student.count({
      where: { school_id: schoolId, status: { [Op.in]: ['left', 'graduated'] }, is_deleted: false }
    });

    const withProfile = await AlumniProfile.count({ where: { school_id: schoolId } });

    const mentorVolunteers = await AlumniProfile.count({
      where: { school_id: schoolId, is_mentor_volunteer: true }
    });

    const publicTestimonials = await AlumniProfile.count({
      where: { school_id: schoolId, is_testimonial_public: true, testimonial: { [Op.ne]: null } }
    });

    const today = new Date().toISOString().split('T')[0];
    const upcomingEvents = await AlumniEvent.count({
      where: { school_id: schoolId, status: 'upcoming', event_date: { [Op.gte]: today } }
    });

    const byOccupation = await AlumniProfile.findAll({
      where: { school_id: schoolId },
      attributes: [
        'current_occupation',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['current_occupation'],
      raw: true
    });

    const byBatchYear = await Student.findAll({
      where: { school_id: schoolId, status: { [Op.in]: ['left', 'graduated'] }, is_deleted: false },
      attributes: [
        [sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM left_date')), 'batch_year'],
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: [sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM left_date'))],
      order: [[sequelize.fn('EXTRACT', sequelize.literal('YEAR FROM left_date')), 'DESC']],
      raw: true
    });

    res.ok({
      total: totalAlumni,
      withProfile,
      mentorVolunteers,
      publicTestimonials,
      upcomingEvents,
      byOccupation: byOccupation.reduce((acc, curr) => {
        acc[curr.current_occupation || 'other'] = parseInt(curr.count, 10);
        return acc;
      }, {}),
      byBatchYear: byBatchYear.map(b => ({
        year: b.batch_year,
        count: parseInt(b.count, 10)
      }))
    }, 'Alumni stats retrieved.');
  } catch (err) { next(err); }
};

// ─── EVENTS ──────────────────────────────────────────────────────────────────

exports.listEvents = async (req, res, next) => {
  try {
    const { status, type } = req.query;
    const where = { school_id: req.user.school_id };
    if (status) where.status = status;
    if (type) where.type = type;

    const events = await AlumniEvent.findAll({
      where,
      order: [['event_date', 'ASC']]
    });

    res.ok(events, 'Alumni events retrieved.');
  } catch (err) { next(err); }
};

exports.createEvent = async (req, res, next) => {
  try {
    const event = await AlumniEvent.create({
      ...req.body,
      school_id: req.user.school_id,
      created_by: req.user.id
    });
    res.ok(event, 'Alumni event created successfully.');
  } catch (err) { next(err); }
};

exports.updateEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const event = await AlumniEvent.findOne({ where: { id, school_id: req.user.school_id } });
    if (!event) return res.fail('Event not found.', [], 404);

    await event.update(req.body);
    res.ok(event, 'Alumni event updated successfully.');
  } catch (err) { next(err); }
};

exports.deleteEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const deleted = await AlumniEvent.destroy({ where: { id, school_id: req.user.school_id } });
    if (!deleted) return res.fail('Event not found.', [], 404);
    res.ok({}, 'Alumni event deleted successfully.');
  } catch (err) { next(err); }
};

// ─── PDF EXPORT ───────────────────────────────────────────────────────────────

exports.downloadAlumniDirectoryPdf = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { search = '', batch_year, occupation } = req.query;

    const replacements = {
      schoolId,
      search: `%${search}%`,
      batchYear: batch_year ? parseInt(batch_year, 10) : null,
      occupation: occupation || null
    };

    const [[school]] = await sequelize.query(`
      SELECT name FROM schools WHERE id = :schoolId LIMIT 1
    `, { replacements: { schoolId } });

    const [alumni] = await sequelize.query(`
      SELECT 
        s.admission_no, s.first_name, s.last_name, 
        EXTRACT(YEAR FROM s.left_date) as batch_year,
        ap.current_occupation, ap.company_or_institution, ap.current_city, ap.contact_email
      FROM students s
      LEFT JOIN alumni_profiles ap ON ap.student_id = s.id
      WHERE s.school_id = :schoolId 
        AND s.status IN ('left', 'graduated')
        AND s.is_deleted = false
        AND (s.first_name ILIKE :search OR s.last_name ILIKE :search OR s.admission_no ILIKE :search)
        AND (:batchYear IS NULL OR EXTRACT(YEAR FROM s.left_date) = :batchYear)
        AND (:occupation IS NULL OR ap.current_occupation = :occupation)
      ORDER BY s.left_date DESC
    `, { replacements });

    const filename = safeFileName(`alumni-directory-${new Date().getTime()}`) + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, left: 40, right: 40, bottom: 10 },
      bufferPages: true,
    });

    doc.pipe(res);

    // Header
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#1e293b').text(school?.name || 'School', { align: 'center' });
    doc.fontSize(12).fillColor('#334155').text('Alumni Directory', { align: 'center' });
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(`Generated on ${new Date().toLocaleDateString()}`, { align: 'center' });
    doc.moveDown(1.5);

    // Table Header
    const tableTop = doc.y;
    const cols = {
      idx: 40,
      adm: 60,
      name: 120,
      batch: 240,
      occ: 290,
      comp: 380,
      city: 490
    };

    doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e293b');
    doc.text('#', cols.idx, tableTop);
    doc.text('Adm No.', cols.adm, tableTop);
    doc.text('Name', cols.name, tableTop);
    doc.text('Batch', cols.batch, tableTop);
    doc.text('Occupation', cols.occ, tableTop);
    doc.text('Company/Institution', cols.comp, tableTop);
    doc.text('City', cols.city, tableTop);

    doc.moveTo(40, tableTop + 15).lineTo(555, tableTop + 15).lineWidth(1).strokeColor('#cbd5e1').stroke();

    let currentY = tableTop + 25;

    alumni.forEach((s, i) => {
      if (currentY > 750) {
        doc.addPage();
        currentY = 50;
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#1e293b');
        doc.text('#', cols.idx, currentY);
        doc.text('Adm No.', cols.adm, currentY);
        doc.text('Name', cols.name, currentY);
        doc.text('Batch', cols.batch, currentY);
        doc.text('Occupation', cols.occ, currentY);
        doc.text('Company/Institution', cols.comp, currentY);
        doc.text('City', cols.city, currentY);
        doc.moveTo(40, currentY + 15).lineTo(555, currentY + 15).stroke();
        currentY += 25;
      }

      doc.font('Helvetica').fontSize(8).fillColor('#334155');
      const fullName = `${s.first_name} ${s.last_name || ''}`.trim();
      
      doc.text(i + 1, cols.idx, currentY);
      doc.text(s.admission_no || '--', cols.adm, currentY);
      doc.text(fullName, cols.name, currentY, { width: 110, lineBreak: false });
      doc.text(s.batch_year ? s.batch_year.toString() : '--', cols.batch, currentY);
      doc.text(s.current_occupation || '--', cols.occ, currentY, { width: 80, lineBreak: false });
      doc.text(s.company_or_institution || '--', cols.comp, currentY, { width: 100, lineBreak: false });
      doc.text(s.current_city || '--', cols.city, currentY);

      doc.moveTo(40, currentY + 12).lineTo(555, currentY + 12).lineWidth(0.5).strokeColor('#f1f5f9').stroke();
      currentY += 18;
    });

    if (!alumni.length) {
      doc.moveDown(2).font('Helvetica-Oblique').text('No records found.', { align: 'center' });
    }

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#94a3b8').text(
        `Generated by EduCore • Page ${i + 1} of ${range.count}`,
        40, doc.page.height - 25, { align: 'center', width: doc.page.width - 80 }
      );
    }

    doc.end();
  } catch (err) { next(err); }
};
