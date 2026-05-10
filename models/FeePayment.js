'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FeePayment = sequelize.define('FeePayment', {
  id              : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  invoice_id      : { type: DataTypes.INTEGER, allowNull: false },
  amount          : { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  payment_date    : { type: DataTypes.DATEONLY, allowNull: false },
  payment_mode    : {
    type      : DataTypes.ENUM('cash', 'online', 'cheque', 'dd'),
    allowNull : false,
  },
  transaction_ref : { type: DataTypes.STRING(200), allowNull: true },
  received_by     : { type: DataTypes.INTEGER, allowNull: true },
}, {
  tableName   : 'fee_payments',
  underscored : true,
  updatedAt   : false,

  hooks: {
    beforeUpdate  : () => { throw new Error('fee_payments records are immutable.'); },
    beforeDestroy : () => { throw new Error('fee_payments records are immutable.'); },
  },
});

module.exports = FeePayment;