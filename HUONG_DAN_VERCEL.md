# Hướng dẫn đưa Billiard Coffee lên Vercel (từng bước)

Vercel chỉ chạy web. **Dữ liệu phải nằm ở MySQL trên mạng** — hướng dẫn này dùng
TiDB Cloud Starter (miễn phí, tương thích MySQL). Dùng Aiven/Railway... cũng được, làm tương tự.

## Phần A — Tạo database online
1. Vào https://tidbcloud.com → đăng ký (Google/GitHub).
2. Tạo cluster **Starter** (gói miễn phí), chọn vùng gần Việt Nam (Singapore).
3. Bấm **Connect** → tạo/copy mật khẩu. Ghi lại 4 thông tin:
   `Host`, `Port` (thường là **4000**, KHÔNG phải 3306), `User` (dạng `abc123.root`), `Password`.
4. Mở **SQL Editor** trong TiDB Cloud, mở file `db_schema.sql`, copy toàn bộ nội dung dán vào và bấm **Run**.
   (Tạo database `billiard_coffee` + toàn bộ bảng + dữ liệu mẫu.)

## Phần B — Tạo tài khoản đăng nhập (làm 1 lần, từ máy tính của bạn)
1. Giải nén zip, mở terminal trong thư mục dự án, chạy `npm install`.
2. Copy `.env.example` thành `.env`, điền:
   ```
   DB_HOST=<Host của TiDB>
   DB_PORT=4000
   DB_USER=<User của TiDB>
   DB_PASSWORD=<Password>
   DB_NAME=billiard_coffee
   DB_SSL=true
   ```
3. Tạo tài khoản chủ quán và mật khẩu xem Lịch sử:
   ```
   npm run create-user -- admin "MatKhauManh123" "Chủ quán" admin
   npm run set-audit-password -- "MatKhauLichSu123"
   ```
4. (Nên làm) Chạy thử `npm start` → mở http://localhost:3000 → đăng nhập được là DB đã ổn.

## Phần C — Đưa code lên GitHub
1. Tạo repo mới (nên để **Private**) trên https://github.com/new
2. Trong thư mục dự án:
   ```
   git init
   git add .
   git commit -m "Billiard Coffee"
   git branch -M main
   git remote add origin https://github.com/<ten-ban>/<ten-repo>.git
   git push -u origin main
   ```
   File `.gitignore` đã loại `.env` và `node_modules` nên mật khẩu DB không bị đẩy lên.

## Phần D — Deploy trên Vercel
1. Vào https://vercel.com → đăng nhập bằng GitHub → **Add New → Project** → chọn repo → **Import**.
2. Để nguyên Framework Preset / Build Command (file `vercel.json` đã cấu hình sẵn).
3. Mở mục **Environment Variables**, thêm từng biến:

   | Tên | Giá trị |
   |---|---|
   | DB_HOST | Host TiDB |
   | DB_PORT | 4000 |
   | DB_USER | User TiDB |
   | DB_PASSWORD | Password TiDB |
   | DB_NAME | billiard_coffee |
   | DB_SSL | true |
   | SESSION_SECRET | chuỗi ngẫu nhiên dài (tạo bằng lệnh bên dưới) |

   Tạo SESSION_SECRET: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
4. Bấm **Deploy**, chờ 1–2 phút → mở link `xxx.vercel.app` → đăng nhập bằng tài khoản ở Phần B.

## Sau này
- Sửa code → `git push` → Vercel tự deploy lại.
- Đổi biến môi trường → phải **Redeploy** mới có hiệu lực.
- Thêm nhân viên: chạy lại `npm run create-user -- ...` từ máy bạn (với `.env` trỏ tới DB online).

## Lỗi thường gặp
- **Đăng nhập xong bị văng ra / lỗi 500**: kiểm tra `DB_SSL=true`, đúng `DB_PORT`, `SESSION_SECRET` đã điền. Xem log: Vercel → Project → Logs.
- **Lỗi kết nối DB (ECONNREFUSED / ENOTFOUND)**: sai Host/Port, hoặc DB chưa cho phép kết nối từ ngoài.
- **Thấy trang trống / 404 file .html**: đảm bảo `vercel.json` có trong repo.
- **Giờ bị lệch**: app đã cố định giờ Việt Nam (UTC+7); đừng đặt biến `APP_TZ` sai.
- Gói **Hobby** của Vercel theo điều khoản là dùng cá nhân/phi thương mại; quán chạy thật nên xem xét gói Pro.
