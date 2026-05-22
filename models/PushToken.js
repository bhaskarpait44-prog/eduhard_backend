'use strict';

const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  class PushToken extends Model {
    static associate(models) {
      PushToken.belongsTo(models.User, { foreignKey: 'user_id', onDelete: 'CASCADE' });
      PushToken.belongsTo(models.Student, { foreignKey: 'student_id', onDelete: 'CASCADE' });
      PushToken.belongsTo(models.Teacher, { foreignKey: 'teacher_id', onDelete: 'CASCADE' });
    }
  }

  PushToken.init({
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    student_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    teacher_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    token: {
      type: DataTypes.STRING(500),
      allowNull: false,
      unique: true,
    },
    platform: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    device_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    last_used: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  }, {
    sequelize,
    modelName: 'PushToken',
    tableName: 'push_tokens',
    underscored: true,
  });

  return PushToken;
};
