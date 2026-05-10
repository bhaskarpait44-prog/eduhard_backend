const { Model, DataTypes } = require('sequelize');
const sequelize = require('../config/database');

class LibrarySetting extends Model {}

LibrarySetting.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
  fine_per_day: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 2 },
  max_books_per_borrower: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
  max_issue_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 14 }
}, {
  sequelize,
  modelName: 'LibrarySetting',
  tableName: 'library_settings',
  underscored: true,
  timestamps: true
});

module.exports = LibrarySetting;
