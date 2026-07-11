'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const LibraryReservation = sequelize.define('LibraryReservation', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true
  },
  school_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  book_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  borrower_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  borrower_type: {
    type: DataTypes.ENUM('student', 'teacher', 'staff'),
    allowNull: false
  },
  reservation_date: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  status: {
    type: DataTypes.ENUM('pending', 'ready', 'completed', 'cancelled', 'expired'),
    defaultValue: 'pending'
  },
  expires_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'library_reservations',
  underscored: true
});

module.exports = LibraryReservation;
