'use strict';

const { LibraryReservation, LibraryBook, Student, User, sequelize } = require('../models');

exports.getReservations = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { status, borrower_type, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const where = { school_id: schoolId };
    if (status) where.status = status;
    if (borrower_type) where.borrower_type = borrower_type;

    const { count, rows } = await LibraryReservation.findAndCountAll({
      where,
      include: [
        { model: LibraryBook, as: 'book', attributes: ['title', 'author', 'available_copies'] },
        { 
          model: Student, 
          as: 'studentBorrower', 
          attributes: ['first_name', 'last_name', 'admission_no'],
          required: false 
        },
        { 
          model: User, 
          as: 'staffBorrower', 
          attributes: ['name', 'email'],
          required: false 
        }
      ],
      order: [['reservation_date', 'ASC']],
      limit: parseInt(limit),
      offset
    });

    res.ok({
      reservations: rows,
      total: count,
      page: parseInt(page),
      totalPages: Math.ceil(count / limit)
    });
  } catch (err) { next(err); }
};

exports.createReservation = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const { book_id } = req.body;
    const borrower_id = req.user.id;
    const borrower_type = req.user.role === 'student' ? 'student' : 'staff';

    // 1. Check if book exists
    const book = await LibraryBook.findOne({
      where: { id: book_id, school_id: schoolId, is_deleted: false }
    });

    if (!book) return res.fail('Book not found.', [], 404);

    // 2. If student, get their student ID
    let actualBorrowerId = borrower_id;
    if (borrower_type === 'student') {
      const student = await Student.findOne({ where: { user_id: borrower_id, school_id: schoolId } });
      if (!student) return res.fail('Student record not found.', [], 404);
      actualBorrowerId = student.id;
    }

    // 3. Check if already reserved or issued
    const existing = await LibraryReservation.findOne({
      where: { 
        school_id: schoolId, 
        book_id, 
        borrower_id: actualBorrowerId, 
        borrower_type,
        status: ['pending', 'ready']
      }
    });

    if (existing) return res.fail('You already have an active reservation for this book.', [], 400);

    // 4. Create reservation
    const reservation = await LibraryReservation.create({
      school_id: schoolId,
      book_id,
      borrower_id: actualBorrowerId,
      borrower_type,
      status: 'pending'
    });

    res.ok(reservation, 'Book reserved successfully.', 201);
  } catch (err) { next(err); }
};

exports.cancelReservation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const schoolId = req.user.school_id;

    const reservation = await LibraryReservation.findOne({
      where: { id, school_id: schoolId }
    });

    if (!reservation) return res.fail('Reservation not found.', [], 404);
    
    // Security check: Only allow users to cancel their own reservations (unless admin)
    if (req.user.role !== 'admin' && req.user.role !== 'librarian') {
       let currentBorrowerId = req.user.id;
       if (req.user.role === 'student') {
         const student = await Student.findOne({ where: { user_id: req.user.id } });
         currentBorrowerId = student.id;
       }
       if (reservation.borrower_id !== currentBorrowerId) {
         return res.fail('Unauthorized to cancel this reservation.', [], 403);
       }
    }

    reservation.status = 'cancelled';
    await reservation.save();

    res.ok(null, 'Reservation cancelled.');
  } catch (err) { next(err); }
};

exports.getMyReservations = async (req, res, next) => {
  try {
    const schoolId = req.user.school_id;
    const userId = req.user.id;
    const role = req.user.role;

    let borrowerId = userId;
    let borrowerType = 'staff';

    if (role === 'student') {
      const student = await Student.findOne({ where: { user_id: userId, school_id: schoolId } });
      if (!student) return res.fail('Student record not found', [], 404);
      borrowerId = student.id;
      borrowerType = 'student';
    }

    const reservations = await LibraryReservation.findAll({
      where: { school_id: schoolId, borrower_id: borrowerId, borrower_type: borrowerType },
      include: [{ model: LibraryBook, as: 'book', attributes: ['title', 'author'] }],
      order: [['reservation_date', 'DESC']]
    });

    res.ok(reservations);
  } catch (err) { next(err); }
};
