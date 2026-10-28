-- ============================================================================
-- CẬP NHẬT DATABASE cho 2 tính năng mới: TẠM DỪNG BÀN + KHO (nhập/xuất/tồn)
-- Cách dùng: TiDB Cloud → SQL Editor → dán TOÀN BỘ file này → Run.
-- CHỈ CHẠY 1 LẦN (chạy lại sẽ báo "Duplicate column" ở 2 dòng đầu — không sao, bỏ qua).
-- Nếu SQL Editor chỉ chạy được từng câu: bôi đen từng câu lệnh (kết thúc bằng dấu ;) rồi Run.
-- ============================================================================

-- ---- 1) Tạm dừng bàn: 2 cột mới cho bảng bàn ----
ALTER TABLE billiard_tables ADD COLUMN paused_at DATETIME NULL;
ALTER TABLE billiard_tables ADD COLUMN paused_total_sec INT NOT NULL DEFAULT 0;

-- ---- 2) Kho ----
-- Cho phép Lịch sử ghi loại "Kho"
ALTER TABLE audit_logs MODIFY COLUMN category ENUM('table','transaction','employee','menu','rate','reservation','auth','inventory') NOT NULL;

-- Danh mục hàng trong kho (menu_item_id = món menu được liên kết, NULL = chưa lên menu)
CREATE TABLE IF NOT EXISTS inventory_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT '',
  cost_price DECIMAL(12,0) NOT NULL DEFAULT 0,
  qty INT NOT NULL DEFAULT 0,
  menu_item_id INT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_inv_menu (menu_item_id),
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE SET NULL
);

-- Lịch sử NHẬP kho
CREATE TABLE IF NOT EXISTS stock_in (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NULL,
  item_name VARCHAR(100) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT '',
  qty INT NOT NULL,
  unit_cost DECIMAL(12,0) NOT NULL DEFAULT 0,
  total_cost DECIMAL(14,0) NOT NULL DEFAULT 0,
  note VARCHAR(255) NOT NULL DEFAULT '',
  actor_name VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_in_time (created_at),
  FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE SET NULL
);

-- Lịch sử XUẤT kho: reason = 'sale' (khách mua, tự ghi khi thanh toán) hoặc 'manual' (xuất tay)
CREATE TABLE IF NOT EXISTS stock_out (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NULL,
  item_name VARCHAR(100) NOT NULL,
  qty INT NOT NULL,
  unit_price DECIMAL(12,0) NOT NULL DEFAULT 0,
  reason VARCHAR(20) NOT NULL DEFAULT 'sale',
  transaction_id INT NULL,
  table_name VARCHAR(60) NULL,
  note VARCHAR(255) NOT NULL DEFAULT '',
  actor_name VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_out_time (created_at),
  FOREIGN KEY (item_id) REFERENCES inventory_items(id) ON DELETE SET NULL
);
