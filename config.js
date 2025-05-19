const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'k98108ya.beget.tech',
  database: 'k98108ya_ntadmin',
  user: 'k98108ya_ntadmin',
  password: '!0r6oC2txTr&',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool; 