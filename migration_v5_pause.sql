-- Tính năng "Tạm dừng bàn" — chạy MỘT LẦN trên database đang dùng (mỗi dòng chạy riêng nếu SQL Editor yêu cầu)
ALTER TABLE billiard_tables ADD COLUMN paused_at DATETIME NULL;
ALTER TABLE billiard_tables ADD COLUMN paused_total_sec INT NOT NULL DEFAULT 0;
