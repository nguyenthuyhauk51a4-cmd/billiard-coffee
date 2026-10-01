-- =========================================================
-- Billiard Coffee — NÂNG CẤP CSDL (v4): Mật khẩu riêng cho Lịch sử
-- Chỉ chạy nếu bạn ĐÃ có database từ trước (đã chạy db_schema.sql / migration_v3_audit.sql rồi).
-- Nếu đây là lần đầu cài đặt, KHÔNG cần chạy file này — db_schema.sql bản mới nhất đã có sẵn.
--
-- Chạy:  mysql -u root -p billiard_coffee < migration_v4_audit_password.sql
-- (PowerShell:  Get-Content migration_v4_audit_password.sql | mysql -u root -p billiard_coffee)
-- =========================================================
USE billiard_coffee;

-- Bảng cấu hình chung, dạng key-value. Trước mắt chỉ dùng để lưu mật khẩu (đã băm)
-- để mở khoá xem Lịch sử — mật khẩu này KHÁC với mật khẩu đăng nhập của từng nhân viên,
-- và chỉ cấp/đổi được bằng lệnh chạy trên máy chủ (scripts/set-audit-password.js),
-- giống hệt cách cấp tài khoản đăng nhập.
CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(50) PRIMARY KEY,
  value VARCHAR(255) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Sau khi chạy xong file này, nhớ cấp mật khẩu Lịch sử:
--   node scripts/set-audit-password.js "MatKhauLichSuCuaQuan123"
