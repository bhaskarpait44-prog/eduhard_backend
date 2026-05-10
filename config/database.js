'use strict';

/**
 * config/database.js
 * Sequelize connection instance - single source of truth for DB config.
 * Reads all values from environment variables via dotenv.
 * Supports either a full DATABASE_URL or discrete DB_* variables.
 */

require('dotenv').config();
const { Sequelize } = require('sequelize');

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_DIALECT'];

if (!hasDatabaseUrl) {
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required database environment variables: ${missing.join(', ')}.\n` +
      'Set DATABASE_URL or provide all DB_* variables.'
    );
  }
}

const dialect = process.env.DB_DIALECT || 'postgres';
const useSsl =
  process.env.DB_SSL === 'true' ||
  (hasDatabaseUrl && process.env.DB_SSL !== 'false');
const dialectOptions = useSsl
  ? {
      ssl: {
        require: true,
        rejectUnauthorized: false,
      },
    }
  : {};

const commonOptions = {
  dialect,
  dialectOptions,
  pool: {
    max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
    min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
    acquire: parseInt(process.env.DB_POOL_ACQUIRE, 10) || 30000,
    idle: parseInt(process.env.DB_POOL_IDLE, 10) || 10000,
  },
  logging:
    process.env.NODE_ENV === 'development'
      ? (msg) => console.log(`[SQL] ${msg}`)
      : false,
  define: {
    underscored: true,
    freezeTableName: true,
    timestamps: true,
  },
};

const sequelize = hasDatabaseUrl
  ? new Sequelize(process.env.DATABASE_URL, commonOptions)
  : new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
      ...commonOptions,
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      dialect,
    });

module.exports = sequelize;
