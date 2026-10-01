require('dotenv').config();
require('express-async-errors'); // để lỗi trong các hàm async (VD: DB tạm lỗi) trả 500 thay vì làm sập server
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const pool = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Vercel/Railway/Render đứng sau proxy HTTPS — cần bật để cookie đăng nhập hoạt động đúng
app.set('trust proxy', 1);

app.use(express.json());

// Phiên đăng nhập lưu trong MySQL (bảng `sessions`, tự tạo nếu chưa có).
// Không dùng bộ nhớ RAM vì Vercel chạy serverless: mỗi request có thể vào 1 instance khác.
const sessionStore = new MySQLStore({
  clearExpired: false, // không chạy timer nền (không hợp serverless) — dọn thủ công bên dưới
  createDatabaseTable: true,
}, pool);
pool.query('DELETE FROM sessions WHERE expires < UNIX_TIMESTAMP()').catch(() => {});

if (process.env.VERCEL && !process.env.SESSION_SECRET) {
  console.error('THIẾU biến môi trường SESSION_SECRET — hãy thêm trong Vercel → Settings → Environment Variables.');
}

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-me',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto', // tự bật khi chạy HTTPS (Vercel), tự tắt khi chạy http://localhost
    maxAge: 12 * 60 * 60 * 1000, // 12 giờ
  },
}));

// Mỗi trang là 1 file riêng trong features/ — tự xử lý cả giao diện (HTML/JS)
// lẫn API (backend) của trang đó. Muốn sửa trang nào chỉ cần mở đúng 1 file đó.
app.use(require('./features/auth'));         // trang đăng nhập
app.use(require('./features/tables'));        // trang Sơ đồ bàn
app.use(require('./features/reservations'));  // trang Đặt bàn
app.use(require('./features/manage'));        // trang Quản lý
app.use(require('./features/audit'));         // API xem lịch sử (chỉ đọc, admin)

app.get('/', (req, res) => res.redirect(req.session.user ? '/tables.html' : '/login.html'));
app.use((req, res) => res.status(404).send('Không tìm thấy trang.'));

// Bắt mọi lỗi chưa xử lý → trả JSON gọn, không làm sập server
app.use((err, req, res, next) => {
  console.error('[lỗi]', req.method, req.originalUrl, '-', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Lỗi máy chủ (có thể không kết nối được CSDL). Thử lại sau ít phút.' });
});

// Chạy local (npm start): tự mở cổng. Trên Vercel: chỉ export app, Vercel tự gọi.
if (require.main === module) {
  app.listen(PORT, () => console.log(`Billiard Coffee đang chạy tại http://localhost:${PORT}`));
}

module.exports = app;
