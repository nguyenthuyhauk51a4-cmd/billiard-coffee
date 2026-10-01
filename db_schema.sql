-- =========================================================
-- Billiard Coffee — CSDL MySQL
-- Chạy file này 1 lần để tạo database + bảng + dữ liệu mẫu.
-- Ví dụ:  mysql -u root -p < db_schema.sql
-- =========================================================

CREATE DATABASE IF NOT EXISTS billiard_coffee
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE billiard_coffee;

-- ---------- Tài khoản đăng nhập (chỉ tạo bằng SQL / script, KHÔNG có trang đăng ký) ----------
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100),
  role ENUM('admin','staff') NOT NULL DEFAULT 'staff',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Nhân viên ----------
CREATE TABLE IF NOT EXISTS employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ---------- Hạng giá bàn ----------
CREATE TABLE IF NOT EXISTS rates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  per_hour DECIMAL(12,0) NOT NULL
);

-- ---------- Menu đồ uống ----------
CREATE TABLE IF NOT EXISTS menu_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  price DECIMAL(12,0) NOT NULL
);

-- ---------- Bàn billiard ----------
-- id để AUTO_INCREMENT để chủ quán có thể thêm bàn mới tuỳ ý (sửa sơ đồ bàn).
-- label: tên tuỳ chỉnh (VD "Bàn VIP 1", "Sân ngoài A2") — để trống thì hiển thị "Bàn {id}".
-- rate_name / rate_per_hour là "chụp ảnh" giá tại thời điểm MỞ bàn, để sau này
-- nếu quản lý sửa giá trong bảng rates thì các bàn ĐANG mở vẫn giữ giá cũ.
-- current_segment / segment_start_time phục vụ tính năng "Cắt bàn": mỗi lần cắt,
-- lần chơi hiện tại được chốt lại vào bảng table_segments, rồi bắt đầu đếm lại từ đầu
-- cho lần kế tiếp trong khi bàn vẫn tiếp tục mở liên tục.
CREATE TABLE IF NOT EXISTS billiard_tables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  label VARCHAR(50) NULL,
  busy TINYINT(1) NOT NULL DEFAULT 0,
  start_time DATETIME NULL,
  rate_id INT NULL,
  rate_name VARCHAR(50) NULL,
  rate_per_hour DECIMAL(12,0) NULL,
  guests INT NOT NULL DEFAULT 0,
  note VARCHAR(255) NOT NULL DEFAULT '',
  expected_end DATETIME NULL,
  current_segment INT NOT NULL DEFAULT 1,
  segment_start_time DATETIME NULL,
  FOREIGN KEY (rate_id) REFERENCES rates(id) ON DELETE SET NULL
);

-- ---------- Món đang gọi trên từng bàn (xoá khi thanh toán / huỷ bàn) ----------
-- segment: món được gắn với đúng "lần chơi" hiện tại của bàn — khi cắt bàn,
-- lần chơi mới bắt đầu với danh sách món trống, món của lần trước vẫn được giữ lại
-- (đã chốt trong table_segments) để tính đúng hoá đơn cuối cùng.
CREATE TABLE IF NOT EXISTS table_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_id INT NOT NULL,
  menu_item_id INT NOT NULL,
  segment INT NOT NULL DEFAULT 1,
  qty INT NOT NULL DEFAULT 0,
  FOREIGN KEY (table_id) REFERENCES billiard_tables(id) ON DELETE CASCADE,
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_table_item_segment (table_id, menu_item_id, segment)
);

-- ---------- Các "lần chơi" đã chốt của một bàn đang mở (tính năng Cắt bàn) ----------
-- Mỗi lần bấm "Cắt bàn", 1 dòng được ghi vào đây với tiền giờ + tiền đồ uống ĐÃ CHỐT
-- tại thời điểm cắt. Khi thanh toán, các dòng này (+ lần hiện tại) được gộp lại thành
-- hoá đơn "Lần 1 / Lần 2 / Lần 3" để khách tự chia nhau trả, rồi bị xoá sau khi thanh toán.
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

-- ---------- Đặt bàn trước ----------
CREATE TABLE IF NOT EXISTS reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(30),
  reserve_time DATETIME NOT NULL,
  guests INT NOT NULL DEFAULT 1,
  note VARCHAR(255),
  table_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (table_id) REFERENCES billiard_tables(id) ON DELETE SET NULL
);

-- ---------- Giao dịch đã thanh toán ----------
-- segments_json: lưu lại chi tiết các "lần chơi" (do Cắt bàn) của hoá đơn này, dạng
-- [{segment_no, time_amount, drinks_amount, items}], để in lại/tra cứu sau này nếu cần.
CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_id INT NOT NULL,
  employee_id INT NULL,
  employee_name VARCHAR(100),
  amount DECIMAL(14,0) NOT NULL,
  method ENUM('cash','transfer') NOT NULL,
  note VARCHAR(255),
  segments_json TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL
);

-- ---------- Chi tiết món trong từng giao dịch (lưu lại giá tại thời điểm bán) ----------
CREATE TABLE IF NOT EXISTS transaction_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id INT NOT NULL,
  item_name VARCHAR(100) NOT NULL,
  price DECIMAL(12,0) NOT NULL,
  qty INT NOT NULL,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
);

-- ---------- Cấu hình chung (key-value) — hiện dùng để lưu mật khẩu (đã băm) mở khoá xem Lịch sử ----------
-- Mật khẩu này KHÁC mật khẩu đăng nhập từng nhân viên, chỉ cấp/đổi bằng lệnh chạy trên máy chủ
-- (scripts/set-audit-password.js), giống hệt cách cấp tài khoản đăng nhập bằng create-user.js.
CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(50) PRIMARY KEY,
  value VARCHAR(255) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------- Lịch sử hoạt động (audit log) — chỉ thêm & đọc trên web, xoá/sửa chỉ làm được trong MySQL ----------
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

-- =========================================================
-- DỮ LIỆU MẪU
-- =========================================================
INSERT INTO rates (name, per_hour) VALUES
  ('Hạng 1', 35000),
  ('Hạng 2', 45000),
  ('Hạng 3', 55000);

INSERT INTO menu_items (name, price) VALUES
  ('Cà phê đen', 25000),
  ('Trà đào', 35000),
  ('Nước suối', 15000);

INSERT INTO employees (name) VALUES
  ('Đoàn Thủy Nga'),
  ('Trần Minh Khoa');

-- Tạo sẵn 20 bàn trống (id tự tăng 1..20)
INSERT INTO billiard_tables (label) VALUES
  (NULL),(NULL),(NULL),(NULL),(NULL),(NULL),(NULL),(NULL),(NULL),(NULL),
  (NULL),(NULL),(NULL),(NULL),(NULL),(NULL),(NULL),(NULL),(NULL),(NULL);

-- Không insert sẵn tài khoản ở đây vì mật khẩu cần được mã hoá (hash) đúng cách.
-- Dùng script scripts/create-user.js để tạo tài khoản đầu tiên, xem README.md.
