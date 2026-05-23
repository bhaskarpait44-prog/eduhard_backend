'use strict';

const { Certificate, Student, Teacher, User, School, Enrollment, Class, Family } = require('../models');
const { Op } = require('sequelize');

const certificateController = {
  async getCertificates(req, res) {
    try {
      const { school_id } = req.user;
      const { type, recipient_type, student_id, teacher_id, status, search, page = 1, limit = 20 } = req.query;

      const where = { school_id };
      if (type) where.type = type;
      if (recipient_type) where.recipient_type = recipient_type;
      if (student_id) where.student_id = student_id;
      if (teacher_id) where.teacher_id = teacher_id;
      if (status) where.status = status;

      if (search) {
        where[Op.or] = [
          { certificate_no: { [Op.iLike]: `%${search}%` } },
          { '$student.first_name$': { [Op.iLike]: `%${search}%` } },
          { '$student.last_name$': { [Op.iLike]: `%${search}%` } },
          { '$teacher.first_name$': { [Op.iLike]: `%${search}%` } },
          { '$teacher.last_name$': { [Op.iLike]: `%${search}%` } },
        ];
      }

      const offset = (page - 1) * limit;

      const { count, rows } = await Certificate.findAndCountAll({
        where,
        include: [
          { 
            model: Student, 
            as: 'student', 
            attributes: ['first_name', 'last_name', 'admission_no'],
            include: [
              {
                model: Enrollment,
                as: 'enrollments',
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
          { model: Teacher, as: 'teacher', attributes: ['first_name', 'last_name', 'employee_id', 'designation'] },
          { model: User, as: 'issuer', attributes: ['name'] },
          { model: School, as: 'school' },
        ],
        order: [['created_at', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(offset),
      });

      // Transform rows for frontend PDF compatibility
      const transformedRows = rows.map(cert => {
        const c = cert.toJSON();
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

        return {
          ...c,
          recipient,
          school: c.school
        };
      });

      return res.ok({
        certificates: transformedRows,
        total: count,
        page: parseInt(page),
        pages: Math.ceil(count / limit),
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
        return res.fail('Type and recipient type are required.');
      }

      const school = await School.findByPk(school_id);
      if (!school) return res.fail('School not found.', [], 404);

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
      
      const lastCert = await Certificate.findOne({
        where: {
          certificate_no: { [Op.like]: `${prefix}-${year}-%` },
          school_id
        },
        order: [['created_at', 'DESC']],
      });

      let sequence = 1;
      if (lastCert) {
        const parts = lastCert.certificate_no.split('-');
        const lastNo = parts[parts.length - 1];
        sequence = parseInt(lastNo) + 1;
      }
      const certificate_no = `${prefix}-${year}-${sequence.toString().padStart(4, '0')}`;

      const certificate = await Certificate.create({
        certificate_no,
        school_id,
        type,
        recipient_type,
        student_id: recipient_type === 'student' ? student_id : null,
        teacher_id: recipient_type === 'staff' ? teacher_id : null,
        issued_by: user_id,
        issued_date: new Date(),
        extra_data: extra_data || {},
        status: 'active',
      });

      // Fetch recipient data for immediate frontend use
      let recipient = {};
      if (recipient_type === 'student') {
        const student = await Student.findByPk(student_id, {
          include: [
            {
              model: Enrollment,
              as: 'enrollments',
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

      return res.ok({ 
        certificate: {
          ...certificate.toJSON(),
          school,
          recipient,
          issued_date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
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

      certificate.status = 'revoked';
      await certificate.save();

      return res.ok({ message: 'Certificate revoked successfully.' });
    } catch (error) {
      console.error('[CertificateController.revokeCertificate]', error);
      return res.fail('Failed to revoke certificate.');
    }
  },
};

module.exports = certificateController;
