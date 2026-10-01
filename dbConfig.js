// Cấu hình kết nối MySQL dùng chung cho web (db.js) và các script (scripts/*.js).
// Đọc từ biến môi trường (file .env ở máy, hoặc Environment Variables trên Vercel).
require('dotenv').config();

// Cố định múi giờ Việt Nam cho toàn bộ app. Vercel chạy giờ UTC (chậm hơn VN 7 tiếng) —
// nếu không cố định, giờ mở bàn, giờ đặt bàn và báo cáo theo ngày sẽ bị lệch.
const APP_TZ = process.env.APP_TZ || 'Asia/Ho_Chi_Minh';
const TZ_OFFSET = process.env.APP_TZ_OFFSET || '+07:00'; // phải khớp với APP_TZ
process.env.TZ = APP_TZ;

function getDbConfig() {
  const cfg = {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'billiard_coffee',
    timezone: TZ_OFFSET, // cách mysql2 đổi giờ giữa JavaScript và DATETIME
  };
  // MySQL trên mạng (TiDB Cloud, Aiven, PlanetScale...) bắt buộc kết nối SSL.
  // Đặt DB_SSL=true để bật. MySQL chạy trên máy mình thì để trống/false.
  if (String(process.env.DB_SSL).toLowerCase() === 'true') {
    cfg.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  }
  return cfg;
}

module.exports = { getDbConfig, TZ_OFFSET };
