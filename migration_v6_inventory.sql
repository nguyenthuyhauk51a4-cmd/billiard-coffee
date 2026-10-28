-- Tính năng KHO (nhập kho / xuất kho / tồn kho) — chạy MỘT LẦN trên database đang dùng.
-- Chạy lần lượt từng câu lệnh (nếu SQL Editor chỉ cho chạy từng câu thì bôi đen từng câu rồi Run).

-- 1) Cho phép lịch sử ghi loại "inventory" (Kho)
ALTER TABLE audit_logs MODIFY COLUMN category ENUM('table','transaction','employee','menu','rate','reservation','auth','inventory') NOT NULL;

-- 2) Danh mục hàng trong kho. menu_item_id = món trên menu được liên kết (NULL = chưa lên menu)
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

-- 3) Lịch sử NHẬP kho
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

-- 4) Lịch sử XUẤT kho: reason = 'sale' (khách mua, tự ghi khi thanh toán) hoặc 'manual' (xuất tay: hỏng, dùng nội bộ...)
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
