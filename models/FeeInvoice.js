'use strict';

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const FeeInvoice = sequelize.define('FeeInvoice', {
  id                    : { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  enrollment_id         : { type: DataTypes.INTEGER, allowNull: false },
  fee_structure_id      : { type: DataTypes.INTEGER, allowNull: false },
  amount_due            : { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  amount_paid           : { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0.00 },
  due_date              : { type: DataTypes.DATEONLY, allowNull: false },
  paid_date             : { type: DataTypes.DATEONLY, allowNull: true },
  status                : {
    type         : DataTypes.ENUM('pending', 'paid', 'partial', 'waived', 'carried_forward'),
    allowNull    : false,
    defaultValue : 'pending',
  },
  carry_from_invoice_id : { type: DataTypes.INTEGER, allowNull: true },
  late_fee_amount       : { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0.00 },
  concession_amount     : { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0.00 },
  concession_reason     : { type: DataTypes.TEXT, allowNull: true },
}, {
  tableName   : 'fee_invoices',
  underscored : true,

  // Virtual: net amount actually owed after concession + late fee
  getterMethods: {
    netPayable() {
      return (
        parseFloat(this.amount_due)        +
        parseFloat(this.late_fee_amount)   -
        parseFloat(this.concession_amount)
      ).toFixed(2);
    },
    balanceDue() {
      return (
        parseFloat(this.netPayable) - parseFloat(this.amount_paid)
      ).toFixed(2);
    },
  },
});

module.exports = FeeInvoice;