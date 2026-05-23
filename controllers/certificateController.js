'use strict';

const { Certificate, Student, Teacher, User, School } = require('../models');
const { Op } = require('sequelize');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const certificateController = {
  async getCertificates(req, res) {
    try {
      const { school_id } = req.user;
      const { type, recipient_type, student_id, teacher_id, status, page = 1, limit = 20 } = req.query;

      const where = { school_id };
      if (type) where.type = type;
      if (recipient_type) where.recipient_type = recipient_type;
      if (student_id) where.student_id = student_id;
      if (teacher_id) where.teacher_id = teacher_id;
      if (status) where.status = status;

      const offset = (page - 1) * limit;

      const { count, rows } = await Certificate.findAndCountAll({
        where,
        include: [
          { model: Student, as: 'student', attributes: ['first_name', 'last_name', 'admission_no'] },
          { model: Teacher, as: 'teacher', attributes: ['first_name', 'last_name', 'employee_id'] },
          { model: User, as: 'issuer', attributes: ['name'] },
        ],
        order: [['createdAt', 'DESC']],
        limit: parseInt(limit),
        offset: parseInt(offset),
      });

      return res.ok({
        certificates: rows,
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
        order: [['createdAt', 'DESC']],
      });

      let sequence = 1;
      if (lastCert) {
        const parts = lastCert.certificate_no.split('-');
        const lastNo = parts[parts.length - 1];
        sequence = parseInt(lastNo) + 1;
      }
      const certificate_no = `${prefix}-${year}-${sequence.toString().padStart(4, '0')}`;

      // Create record
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

      // Prepare PDF directory
      const pdfDir = path.join(__dirname, '../uploads/certificates');
      if (!fs.existsSync(pdfDir)) {
        fs.mkdirSync(pdfDir, { recursive: true });
      }
      const pdfFileName = `${certificate.id}.pdf`;
      const pdfPath = `uploads/certificates/${pdfFileName}`;
      const fullPath = path.join(__dirname, '..', pdfPath);

      // Fetch School info for letterhead
      const school = await School.findByPk(school_id);
      
      // Generate PDF
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const stream = fs.createWriteStream(fullPath);
      doc.pipe(stream);

      // Add a border
      doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).stroke();

      // Header / Letterhead
      if (school.logo_url) {
        const logoPath = path.join(__dirname, '..', school.logo_url);
        if (fs.existsSync(logoPath)) {
          doc.image(logoPath, 50, 45, { width: 60 });
        }
      }

      doc.fillColor('#1e293b').fontSize(24).text(school.name.toUpperCase(), 120, 50, { align: 'left' });
      doc.fontSize(10).fillColor('#64748b').text(school.address || '', 120, 80);
      if (school.phone || school.email) {
        doc.text(`${school.phone ? 'Phone: ' + school.phone : ''} ${school.email ? ' | Email: ' + school.email : ''}`, 120, 95);
      }

      doc.moveDown(4);
      doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(50, 120).lineTo(doc.page.width - 50, 120).stroke();
      
      doc.moveDown(2);
      doc.fillColor('#1e293b').fontSize(18).text(type.replace('_', ' ').toUpperCase() + ' CERTIFICATE', { align: 'center', underline: true });
      
      doc.moveDown(2);
      doc.fontSize(12).text(`Certificate No: ${certificate_no}`, 50, 200, { align: 'left' });
      doc.text(`Date: ${new Date().toLocaleDateString('en-IN')}`, doc.page.width - 200, 200, { align: 'right' });

      doc.moveDown(3);
      
      let recipientName = '';
      let content = '';
      
      if (recipient_type === 'student') {
        const student = await Student.findByPk(student_id);
        recipientName = `${student.first_name} ${student.last_name}`;
        content = `This is to certify that ${recipientName}, son/daughter of ${student.father_name || 'N.A.'}, admission number ${student.admission_no}, was a student of this school.`;
      } else {
        const teacher = await Teacher.findByPk(teacher_id);
        recipientName = `${teacher.first_name} ${teacher.last_name}`;
        content = `This is to certify that ${recipientName}, holding employee ID ${teacher.employee_id || 'N.A.'}, was employed in this institution.`;
      }

      doc.fontSize(14).lineGap(10).text(content, { align: 'justify' });
      
      doc.moveDown();
      if (extra_data && Object.keys(extra_data).length > 0) {
        Object.entries(extra_data).forEach(([key, value]) => {
          if (value) {
            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
            doc.fontSize(12).text(`${label}: ${value}`);
          }
        });
      }

      doc.moveDown(4);
      const signatureY = doc.y;
      doc.fontSize(12).text('_________________________', 50, signatureY);
      doc.text('Authorized Signatory', 50, signatureY + 15);

      doc.text('_________________________', doc.page.width - 200, signatureY, { align: 'right' });
      doc.text(school.principal_name || 'Principal', doc.page.width - 200, signatureY + 15, { align: 'right' });

      // Footer
      doc.fontSize(8).fillColor('#94a3b8').text('This is a computer generated certificate and does not require a physical signature.', 0, doc.page.height - 60, { align: 'center' });

      doc.end();

      await new Promise((resolve) => stream.on('finish', resolve));

      certificate.pdf_path = pdfPath;
      await certificate.save();

      return res.ok({ certificate });
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
          { model: Student, as: 'student' },
          { model: Teacher, as: 'teacher' },
          { model: User, as: 'issuer', attributes: ['name'] },
        ],
      });

      if (!certificate) {
        return res.fail('Certificate not found.', [], 404);
      }

      return res.ok({ certificate });
    } catch (error) {
      console.error('[CertificateController.getCertificateById]', error);
      return res.fail('Failed to fetch certificate.');
    }
  },

  async downloadCertificate(req, res) {
    try {
      const { school_id } = req.user;
      const { id } = req.params;

      const certificate = await Certificate.findOne({
        where: { id, school_id },
      });

      if (!certificate || !certificate.pdf_path) {
        return res.fail('Certificate PDF not found.', [], 404);
      }

      const fullPath = path.join(__dirname, '..', certificate.pdf_path);
      if (!fs.existsSync(fullPath)) {
        return res.fail('File not found on server.', [], 404);
      }

      res.download(fullPath, `${certificate.certificate_no}.pdf`);
    } catch (error) {
      console.error('[CertificateController.downloadCertificate]', error);
      return res.fail('Failed to download certificate.');
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
