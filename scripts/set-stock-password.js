// Cấp / đổi mật khẩu riêng để mở khoá trang Nhập kho.
// Mật khẩu này KHÁC mật khẩu đăng nhập của từng nhân viên — ai cũng đăng nhập được vào app,
// nhưng phải nhập đúng mật khẩu này thì mới dùng được trang Nhập kho. Chỉ chạy được bằng lệnh trên
// máy chủ (giống hệt cách cấp tài khoản bằng scripts/create-user.js), không có form nào trên
// web để tự đổi mật khẩu này.
//
// Cách dùng:
//   node scripts/set-stock-password.js "MatKhauNhapKhoCuaQuan123"
//
// Chạy lại lệnh này sẽ ĐỔI mật khẩu cũ sang mật khẩu mới (không cần biết mật khẩu cũ).

require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { getDbConfig, TZ_OFFSET } = require('../dbConfig');

async function main() {
  const [password] = process.argv.slice(2);
  if (!password) {
    console.log('Cách dùng: node scripts/set-stock-password.js "MatKhauNhapKho123"');
    process.exit(1);
  }
  if (password.length < 6) {
    console.log('Mật khẩu nên có ít nhất 6 ký tự.');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);

  const conn = await mysql.createConnection(getDbConfig());
  await conn.query(`SET time_zone = '${TZ_OFFSET}'`);

  await conn.execute(
    `INSERT INTO settings (\`key\`, value) VALUES ('stock_password_hash', ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [hash]
  );

  try {
    await conn.execute(
      `INSERT INTO audit_logs (category, action, description, actor_name)
       VALUES ('auth', 'set_stock_password', 'Cấp/đổi mật khẩu mở khoá trang Nhập kho bằng script trên máy chủ', 'Hệ thống (script)')`
    );
  } catch (e) { /* bảng audit_logs có thể chưa tồn tại nếu chưa chạy migration — bỏ qua, không chặn việc đặt mật khẩu */ }

  console.log('✔ Đã cấp/đổi mật khẩu trang Nhập kho. Từ giờ ai muốn vào trang Nhập kho đều phải nhập đúng mật khẩu này.');
  await conn.end();
}

main().catch(err => { console.error('Lỗi:', err.message); process.exit(1); });
