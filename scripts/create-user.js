// Cấp tài khoản đăng nhập trực tiếp vào SQL — đây là "trang đăng ký" duy nhất,
// nhưng chạy ở dòng lệnh (chỉ chủ quán có quyền truy cập server mới chạy được),
// KHÔNG có form đăng ký nào lộ ra ngoài web.
//
// Cách dùng:
//   node scripts/create-user.js <username> <password> [full_name] [role]
// Ví dụ:
//   node scripts/create-user.js admin "MatKhauManh123" "Chủ quán" admin
//   node scripts/create-user.js nga "MatKhauNhanVien1" "Đoàn Thủy Nga" staff
//
// Nếu username đã tồn tại, script sẽ CẬP NHẬT lại mật khẩu/họ tên/quyền cho username đó.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const { getDbConfig, TZ_OFFSET } = require('../dbConfig');

async function main() {
  const [username, password, fullName, role] = process.argv.slice(2);
  if (!username || !password) {
    console.log('Cách dùng: node scripts/create-user.js <username> <password> [full_name] [role: admin|staff]');
    process.exit(1);
  }
  if (password.length < 6) {
    console.log('Mật khẩu nên có ít nhất 6 ký tự.');
    process.exit(1);
  }
  const finalRole = role === 'admin' ? 'admin' : 'staff';
  const hash = await bcrypt.hash(password, 10);

  const conn = await mysql.createConnection(getDbConfig());
  await conn.query(`SET time_zone = '${TZ_OFFSET}'`);

  await conn.execute(
    `INSERT INTO users (username, password_hash, full_name, role)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), full_name=VALUES(full_name), role=VALUES(role)`,
    [username, hash, fullName || username, finalRole]
  );

  try {
    await conn.execute(
      `INSERT INTO audit_logs (category, action, entity_label, description, actor_name)
       VALUES ('auth','create_user',?,?,?)`,
      [username, `Cấp/đổi tài khoản "${username}" (quyền: ${finalRole}) bằng script trên máy chủ`, 'Hệ thống (script)']
    );
  } catch (e) { console.log('(Chưa ghi được lịch sử — đã chạy migration_v3_audit.sql chưa?)'); }

  console.log(`✔ Đã cấp/tạo tài khoản "${username}" (quyền: ${finalRole}).`);
  await conn.end();
}

main().catch(err => { console.error('Lỗi:', err.message); process.exit(1); });
