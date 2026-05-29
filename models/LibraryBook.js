const { Model, DataTypes } = require('sequelize');
const sequelize = require('../config/database');

class LibraryBook extends Model {}

LibraryBook.init({
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  school_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  author: { type: DataTypes.STRING(255), allowNull: false },
  publisher: { type: DataTypes.STRING(255), allowNull: true },
  isbn: { type: DataTypes.STRING(50), allowNull: true },
  category: { 
    type: DataTypes.ENUM('fiction', 'non_fiction', 'science', 'mathematics', 'history', 'geography', 'literature', 'reference', 'magazine', 'other'), 
    allowNull: false,
    defaultValue: 'other'
  },
  total_copies: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  available_copies: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  shelf_location: { type: DataTypes.STRING(100), allowNull: true },
  publication_year: { type: DataTypes.INTEGER, allowNull: true },
  description: { type: DataTypes.TEXT, allowNull: true },
  digital_url: { type: DataTypes.STRING(500), allowNull: true },
  cover_image_url: { type: DataTypes.STRING(500), allowNull: true },
  is_deleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, {
  sequelize,
  modelName: 'LibraryBook',
  tableName: 'library_books',
  underscored: true,
  timestamps: true
});

module.exports = LibraryBook;
