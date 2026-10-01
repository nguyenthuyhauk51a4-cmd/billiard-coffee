const mysql = require('mysql2/promise');
const { getDbConfig, TZ_OFFSET } = require('./dbConfig');

// Trên Vercel (serverless) mỗi instance chỉ nên giữ ít kết nối để khỏi làm đầy giới hạn của MySQL.
const pool = mysql.createPool({
  ...getDbConfig(),
  waitForConnections: true,
  connectionLimit: process.env.VERCEL ? 3 : 10,
  enableKeepAlive: true,  keepAliveInitialDelay: 10000,
});

// Để NOW() và các cột created_at trong MySQL cũng tính theo giờ Việt Nam
pool.pool.on('connection', (conn) => conn.query(`SET time_zone = '${TZ_OFFSET}'`));

module.exports = pool;
