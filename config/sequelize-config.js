'use strict';

require('dotenv').config();

module.exports = {
  production: {
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        // Default to true (secure) unless explicitly set to 'false' in environment
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
        // Support custom CA if provided
        ca: process.env.DB_SSL_CA ? [process.env.DB_SSL_CA] : undefined,
      },
    },
  },
  development: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false,
  },
};