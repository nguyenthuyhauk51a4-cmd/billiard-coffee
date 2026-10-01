-- =========================================================
-- Billiard Coffee — NÂNG CẤP CSDL (v2)
-- Chỉ chạy file này nếu bạn ĐÃ tạo database bằng db_schema.sql từ trước rồi.
-- (Nếu chưa tạo database bao giờ, chỉ cần chạy db_schema.sql bản mới nhất là đủ,
--  KHÔNG cần chạy file này.)
--
-- Thêm 3 tính năng:
--   1) Sửa sơ đồ bàn (thêm/xoá bàn tuỳ ý)
--   2) Cắt bàn (chia hoá đơn thành nhiều "lần chơi")
--   3) Thêm giờ (cộng thêm thời gian khi quên bấm mở bàn)
--
-- Chạy:  mysql -u root -p billiard_coffee < migration_v2_features.sql
-- (PowerShell:  Get-Content migration_v2_features.sql | mysql -u root -p billiard_coffee)
-- =========================================================

USE billiard_coffee;

-- 1) Cho phép thêm bàn mới tuỳ ý: chuyển cột id sang tự tăng
--    (AUTO_INCREMENT sẽ tự tiếp tục từ giá trị id lớn nhất hiện có, ví dụ đang có
--     bàn 1..20 thì bàn mới thêm sẽ là bàn 21, không đụng tới các bàn cũ).
ALTER TABLE billiard_tables MODIFY id INT NOT NULL AUTO_INCREMENT;

-- 2) Tên tuỳ chỉnh cho bàn (phục vụ sửa sơ đồ bàn theo deco quán)
ALTER TABLE billiard_tables ADD COLUMN IF NOT EXISTS label VARCHAR(50) NULL AFTER id;

-- 3) Cột phục vụ tính năng Cắt bàn
ALTER TABLE billiard_tables ADD COLUMN IF NOT EXISTS current_segment INT NOT NULL DEFAULT 1 AFTER expected_end;
ALTER TABLE billiard_tables ADD COLUMN IF NOT EXISTS segment_start_time DATETIME NULL AFTER current_segment;

-- 4) table_orders cần biết món thuộc "lần chơi" (segment) nào
ALTER TABLE table_orders ADD COLUMN IF NOT EXISTS segment INT NOT NULL DEFAULT 1 AFTER menu_item_id;
ALTER TABLE table_orders DROP INDEX uniq_table_item;
ALTER TABLE table_orders ADD UNIQUE KEY uniq_table_item_segment (table_id, menu_item_id, segment);

-- 5) Bảng lưu các "lần chơi" đã chốt (mỗi lần Cắt bàn ghi 1 dòng)
CREATE TABLE IF NOT EXISTS table_segments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_id INT NOT NULL,
  segment_no INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  time_amount DECIMAL(14,0) NOT NULL,
  drinks_amount DECIMAL(14,0) NOT NULL,
  items TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (table_id) REFERENCES billiard_tables(id) ON DELETE CASCADE
);

-- 6) Lưu chi tiết các lần cắt vào giao dịch đã thanh toán
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS segments_json TEXT NULL AFTER note;

-- 7) Đưa dữ liệu bàn hiện có về đúng trạng thái mặc định mới
UPDATE billiard_tables SET current_segment = 1, segment_start_time = start_time WHERE busy = 1;
