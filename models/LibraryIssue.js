const { Model, DataTypes } = require('sequelize');
const sequelize = require('../config/database');

class LibraryIssue extends Model {}

LibraryIssue.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id: { type: DataTypes.INTEGER, allowNull: false },
  book_id: { type: DataTypes.INTEGER, allowNull: false },
  borrower_type: { type: DataTypes.ENUM('student', 'teacher', 'staff'), allowNull: false },
  borrower_id: { type: DataTypes.INTEGER, allowNull: false },
  issue_date: { type: DataTypes.DATEONLY, allowNull: false },
  due_date: { type: DataTypes.DATEONLY, allowNull: false },
  return_date: { type: DataTypes.DATEONLY, allowNull: true },
  status: { type: DataTypes.ENUM('issued', 'returned', 'overdue'), allowNull: false, defaultValue: 'issued' },
  fine_amount: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
  fine_status: { type: DataTypes.ENUM('none', 'pending', 'paid', 'waived'), allowNull: false, defaultValue: 'none' },
  fine_remarks: { type: DataTypes.TEXT, allowNull: true },
  issued_by: { type: DataTypes.INTEGER, allowNull: true }
}, {
  sequelize,
  modelName: 'LibraryIssue',
  tableName: 'library_issues',
  underscored: true,
  timestamps: true
});

module.exports = LibraryIssue;
