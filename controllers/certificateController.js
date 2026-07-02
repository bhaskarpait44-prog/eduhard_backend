'use strict';

const { Certificate, Student, Teacher, User, School, Enrollment, Class, Family } = require('../models');
const { Op, literal } = require('sequelize');
const sequelize = require('../config/database');
const { writeAuditLog } = require('../utils/writeAuditLog');

/**
 * Helper to format date as "DD Month YYYY"
 */
const formatDate = (date) => {
  if (!date) return 'N/A';
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  const day = d.getDate();
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];
  return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
};

const certificateController = {
  async getCertificates(req, res) {
    try {
      const { school_id } = req.user;
      const { 
        type, 
        recipient_type, 
        student_id, 
        teacher_id, 
        status, 
        search, 
        page = 1, 
        limit = 20 
      } = req.query;

      const pLimit = parseInt(limit) || 20;
      const pPage = parseInt(page) || 1;
      const offset = (pPage - 1) * pLimit;

      const andConditions = [{ school_id }];
      if (type)           andConditions.push({ type });
      if (status)         andConditions.push({ status });
      if (student_id)     andConditions.push({ student_id });
      if (teacher_id)     andConditions.push({ teacher_id });
      if (recipient_type) andConditions.push({ recipient_type });

      if (search) {
        const matchingStudents = await Student.findAll({
          where: {
            school_id,
            [Op.or]: [
              { first_name: { [Op.iLike]: `%${search}%` } },
              { last_name:  { [Op.iLike]: `%${search}%` } },
              { admission_no: { [Op.iLike]: `%${search}%` } },
            ]
          },
          attributes: ['id']
        });
        const studentIds = matchingStudents.map(s => s.id);

        const matchingTeachers = await Teacher.findAll({
          where: {
            school_id,
            [Op.or]: [
              { first_name:  { [Op.iLike]: `%${search}%` } },
              { last_name:   { [Op.iLike]: `%${search}%` } },
              { employee_id: { [Op.iLike]: `%${search}%` } },
            ]
          },
          attributes: ['id']
        });
        const teacherIds = matchingTeachers.map(t => t.id);

        // Bug #10 fix: only include non-empty IN() clauses — empty arrays produce
        // `column IN ()` which is valid but wasteful (and some DB engines warn about it)
        const orConditions = [{ certificate_no: { [Op.iLike]: `%${search}%` } }];
        if (studentIds.length) orConditions.push({ student_id: { [Op.in]: studentIds } });
        if (teacherIds.length)  orConditions.push({ teacher_id: { [Op.in]: teacherIds } });
        andConditions.push({ [Op.or]: orConditions });
      }

      const where = { [Op.and]: andConditions };

      const { count, rows } = await Certificate.findAndCountAll({
        where,
        distinct: true,
        include: [
          { 
            model: Student, 
            as: 'student', 
            attributes: ['first_name', 'last_name', 'admission_no'],
            required: false,
            include: [
              {
                model: Enrollment,
                as: 'enrollments',
                separate: true,
                order: [['created_at', 'DESC']],
                include: [{ model: Class, as: 'class', attributes: ['name'] }]
              },
              {
                model: Family,
                as: 'family',
                attributes: ['primary_contact']
              }
            ]
          },
          { 
            model: Teacher, 
            as: 'teacher', 
            attributes: ['first_name', 'last_name', 'employee_id', 'designation'],
            required: false
          },
          { model: User, as: 'issuer', attributes: ['name'] },
          { model: School, as: 'school' },
        ],
        order: [['created_at', 'DESC']],
        limit: pLimit,
        offset: offset >= 0 ? offset : 0,
      });

      // Transform rows for frontend PDF compatibility
      const transformedRows = rows.map(cert => {
        const c = cert.toJSON();
        const recipient = c.recipient_type === 'student' ? {
          name: `${c.student?.first_name || ''} ${c.student?.last_name || ''}`.trim() || 'N/A',
          father_name: c.student?.family?.primary_contact || 'N/A',
          admission_no: c.student?.admission_no || 'N/A',
          class_name: c.student?.enrollments?.[0]?.class?.name || 'N/A'
        } : {
          name: `${c.teacher?.first_name || ''} ${c.teacher?.last_name || ''}`.trim() || 'N/A',
          employee_id: c.teacher?.employee_id || 'N/A',
          designation: c.teacher?.designation || 'Teacher'
        };

        return {
          ...c,
          issued_date: formatDate(c.issued_date), // Bug 1 normalization
          recipient,
          school: c.school
        };
      });

      return res.ok({
        certificates: transformedRows,
        total: count,
        page: parseInt(page),
        // Bug #2 fix: use parsed integer pLimit, not raw query-string `limit`
        pages: Math.ceil(count / pLimit),
      });
    } catch (error) {
      console.error('[CertificateController.getCertificates]', error);
      return res.fail('Failed to fetch certificates.');
    }
  },

  async generateCertificate(req, res) {
    try {
      const { school_id, id: user_id } = req.user;
      const { type, recipient_type, student_id, teacher_id, extra_data } = req.body;

      if (!type || !recipient_type) {
        return res.fail('Type and recipient type are required.', [], 422);
      }

      // Bug #4 fix: validate presence of recipient ID before doing any DB work
      if (recipient_type === 'student' && !student_id) {
        return res.fail('student_id is required for student certificates.', [], 422);
      }
      if (recipient_type === 'staff' && !teacher_id) {
        return res.fail('teacher_id is required for staff certificates.', [], 422);
      }

      const school = await School.findByPk(school_id);
      if (!school) return res.fail('School not found.', [], 404);

      // Bug #3 fix: IDOR guard — verify the recipient belongs to this school
      if (recipient_type === 'student') {
        const studentExists = await Student.findOne({ where: { id: student_id, school_id, is_deleted: false } });
        if (!studentExists) return res.fail('Student not found or unauthorized.', [], 404);
      }
      if (recipient_type === 'staff') {
        const teacherExists = await Teacher.findOne({ where: { id: teacher_id, school_id, is_deleted: false } });
        if (!teacherExists) return res.fail('Teacher not found or unauthorized.', [], 404);
      }

      // Generate certificate number
      const prefixMap = {
        transfer: 'TC',
        bonafide: 'BC',
        character: 'CC',
        migration: 'MC',
        marksheet: 'MS',
        sports: 'SC',
        study: 'ST',
        experience: 'EC',
      };

      const prefix = prefixMap[type] || 'CERT';
      const year = new Date().getFullYear();

      // Duplicate check
      const existing = await Certificate.findOne({
        where: {
          school_id,
          type,
          recipient_type,
          student_id: recipient_type === 'student' ? student_id : null,
          teacher_id: recipient_type === 'staff' ? teacher_id : null,
          status: 'active'
        }
      });

      if (existing && type === 'transfer') {
        return res.fail('A Transfer Certificate has already been issued for this student.', [], 400);
      }
      
      // Bug #5 fix: use a transaction + SELECT FOR UPDATE to eliminate the race condition
      // where two concurrent requests read the same lastCert and generate duplicate cert numbers
      const certificate = await sequelize.transaction(async (tx) => {
        const lastCert = await Certificate.findOne({
          where: {
            certificate_no: { [Op.like]: `${prefix}-${year}-%` },
            school_id
          },
          order: [['created_at', 'DESC']],
          lock: tx.LOCK.UPDATE,
          transaction: tx,
        });

        let sequence = 1;
        if (lastCert) {
          const parts = lastCert.certificate_no.split('-');
          const lastNo = parts[parts.length - 1];
          sequence = parseInt(lastNo) + 1;
        }
        const certificate_no = `${prefix}-${year}-${sequence.toString().padStart(4, '0')}`;

        return Certificate.create({
          certificate_no,
          school_id,
          type,
          recipient_type,
          student_id: recipient_type === 'student' ? student_id : null,
          teacher_id: recipient_type === 'staff'   ? teacher_id : null,
          issued_by: user_id,
          issued_date: new Date(),
          extra_data: extra_data || {},
          status: 'active',
        }, { transaction: tx });
      });

      // Fetch recipient data for immediate frontend use
      let recipient = {};
      if (recipient_type === 'student') {
        const student = await Student.findByPk(student_id, {
          include: [
            {
              model: Enrollment,
              as: 'enrollments',
              separate: true,
              limit: 1,
              order: [['created_at', 'DESC']],
              include: [{ model: Class, as: 'class', attributes: ['name'] }]
            },
            {
              model: Family,
              as: 'family',
              attributes: ['primary_contact']
            }
          ]
        });
        recipient = {
          name: `${student.first_name} ${student.last_name}`,
          father_name: student.family?.primary_contact || 'N/A',
          admission_no: student.admission_no,
          class_name: student.enrollments?.[0]?.class?.name || 'N/A'
        };
      } else {
        const teacher = await Teacher.findByPk(teacher_id);
        recipient = {
          name: `${teacher.first_name} ${teacher.last_name}`,
          employee_id: teacher.employee_id,
          designation: teacher.designation
        };
      }

      const c = certificate.toJSON();
      return res.ok({ 
        certificate: {
          ...c,
          issued_date: formatDate(c.issued_date), // Bug 1 normalization
          school,
          recipient,
        } 
      });
    } catch (error) {
      console.error('[CertificateController.generateCertificate]', error);
      return res.fail('Failed to generate certificate.');
    }
  },

  async getCertificateById(req, res) {
    try {
      const { school_id } = req.user;
      const { id } = req.params;

      const certificate = await Certificate.findOne({
        where: { id, school_id },
        include: [
          { 
            model: Student, 
            as: 'student',
            include: [
              {
                model: Enrollment,
                as: 'enrollments',
                separate: true,
                limit: 1,
                order: [['created_at', 'DESC']],
                include: [{ model: Class, as: 'class', attributes: ['name'] }]
              },
              {
                model: Family,
                as: 'family',
                attributes: ['primary_contact']
              }
            ]
          },
          { model: Teacher, as: 'teacher' },
          { model: User, as: 'issuer', attributes: ['name'] },
          { model: School, as: 'school' }
        ],
      });

      if (!certificate) return res.fail('Certificate not found.', [], 404);

      const c = certificate.toJSON();
      const recipient = c.recipient_type === 'student' ? {
        name: `${c.student?.first_name} ${c.student?.last_name}`,
        father_name: c.student?.family?.primary_contact || 'N/A',
        admission_no: c.student?.admission_no,
        class_name: c.student?.enrollments?.[0]?.class?.name || 'N/A'
      } : {
        name: `${c.teacher?.first_name} ${c.teacher?.last_name}`,
        employee_id: c.teacher?.employee_id,
        designation: c.teacher?.designation
      };

      return res.ok({ 
        certificate: {
          ...c,
          issued_date: formatDate(c.issued_date), // Bug 1 normalization
          recipient,
          school: c.school
        } 
      });
    } catch (error) {
      console.error('[CertificateController.getCertificateById]', error);
      return res.fail('Failed to fetch certificate.');
    }
  },

  async revokeCertificate(req, res) {
    try {
      const { school_id } = req.user;
      const { id } = req.params;

      const certificate = await Certificate.findOne({
        where: { id, school_id },
      });

      if (!certificate) {
        return res.fail('Certificate not found.', [], 404);
      }

      // Bug #8 fix: write audit trail before mutating — revoking is permanent
      await writeAuditLog(sequelize, {
        tableName : 'certificates',
        recordId  : certificate.id,
        schoolId  : req.user.school_id,
        changes   : [{ field: 'status', oldValue: certificate.status, newValue: 'revoked' }],
        changedBy : req.user.id,
        reason    : 'Admin revoked certificate — permanent action',
        ipAddress : req.ip,
        deviceInfo: req.headers['user-agent'],
      });

      certificate.status = 'revoked';
      await certificate.save();

      return res.ok({ message: 'Certificate revoked successfully.' });
    } catch (error) {
      console.error('[CertificateController.revokeCertificate]', error);
      return res.fail('Failed to revoke certificate.');
    }
  },

  async getSettings(req, res) {
    try {
      const { school_id } = req.user;
      const school = await School.findByPk(school_id, {
        attributes: ['name', 'address', 'phone', 'email', 'principal_name']
      });
      return res.ok(school);
    } catch (error) {
      console.error('[CertificateController.getSettings]', error);
      return res.fail('Failed to fetch certificate settings.');
    }
  },

  async updateSettings(req, res) {
    try {
      const { school_id } = req.user;
      const { school_name, address, phone, email, principal_name } = req.body;
      
      const school = await School.findByPk(school_id);
      if (!school) return res.fail('School not found.', [], 404);

      await school.update({
        name: school_name,
        address,
        phone,
        email,
        principal_name
      });

      return res.ok(school, 'Settings updated successfully.');
    } catch (error) {
      console.error('[CertificateController.updateSettings]', error);
      return res.fail('Failed to update certificate settings.');
    }
  }
};

module.exports = certificateController;
