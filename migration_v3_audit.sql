-- =========================================================
-- Billiard Coffee — NÂNG CẤP CSDL (v3): Lịch sử hoạt động (audit log)
-- Chỉ chạy nếu bạn ĐÃ có database từ trước.
-- (Cài mới: db_schema.sql bản mới nhất đã có sẵn bảng này.)
--
-- Chạy:  mysql -u root -p billiard_coffee < migration_v3_audit.sql
-- (PowerShell:  Get-Content migration_v3_audit.sql | mysql -u root -p billiard_coffee)
-- =========================================================
USE billiard_coffee;

-- Bảng lịch sử: web CHỈ ĐƯỢC THÊM dòng mới và ĐỌC. Không có API nào sửa/xoá bảng này,
-- muốn sửa/xoá phải làm trực tiếp trong MySQL.
-- Cố ý KHÔNG có khoá ngoại: xoá bàn / nhân viên / món thì lịch sử cũ vẫn còn nguyên,
-- vì tên đã được chụp lại (entity_label, actor_name) tại thời điểm xảy ra.
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  category ENUM('table','transaction','employee','menu','rate','reservation','auth') NOT NULL,
  action VARCHAR(40) NOT NULL,
  entity_id INT NULL,
  entity_label VARCHAR(150) NULL,
  description VARCHAR(500) NOT NULL,
  details TEXT NULL,
  actor_id INT NULL,
  actor_name VARCHAR(100) NULL,
  ip VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cat_time (category, created_at),
  INDEX idx_time (created_at),
  INDEX idx_actor (actor_name)
);
