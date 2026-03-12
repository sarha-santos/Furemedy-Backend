const { Pool } = require('pg');

// Note: We don't necessarily need dotenv.config() here 
// because Render injects variables into process.env automatically.

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: String(process.env.DB_PASSWORD),
  port: Number(process.env.DB_PORT) || 5432,
  ssl: {
    rejectUnauthorized: false // This is REQUIRED for Supabase on Render
  }
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = pool;