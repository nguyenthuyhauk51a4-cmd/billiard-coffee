# Billiard Coffee — Quản lý quán (bản SQL + đăng nhập)

> **Triển khai lên Vercel:** xem file [HUONG_DAN_VERCEL.md](HUONG_DAN_VERCEL.md).
> Bản này đã hỗ trợ MySQL trên mạng (`DB_SSL`), lưu phiên đăng nhập trong MySQL, và cố định giờ Việt Nam.

Toàn bộ dữ liệu (nhân viên, menu, giá bàn, bàn đang chơi, đặt bàn, giao dịch)
được lưu trong **MySQL** — không còn lưu tạm trên trình duyệt như bản trước.
Web có **trang đăng nhập**, **không có trang đăng ký**: tài khoản chỉ được
chủ quán tự cấp bằng lệnh chạy trực tiếp trên máy, ghi thẳng vào bảng `users`.

## Cấu trúc thư mục
```
billiard-coffee-sql/
├─ db_schema.sql          -> chạy 1 lần để tạo database + bảng + dữ liệu mẫu
├─ server.js               -> chỉ khởi động web + ghép các trang lại, KHÔNG chứa nghiệp vụ
├─ db.js                    -> kết nối MySQL dùng chung
├─ middleware/auth.js       -> 2 hàm kiểm tra đăng nhập dùng chung (rất ít khi phải sửa)
├─ package.json
├─ .env.example             -> copy thành .env rồi điền thông tin MySQL
├─ scripts/
│  └─ create-user.js         -> cấp tài khoản đăng nhập (thay cho trang đăng ký)
├─ public/                    -> GIAO DIỆN — mỗi trang 1 file .html, mở/sửa trực tiếp được
│  ├─ login.html               -> trang Đăng nhập
│  ├─ tables.html               -> trang Sơ đồ bàn
│  ├─ resv.html                  -> trang Đặt bàn
│  └─ manage.html                 -> trang Quản lý (nhân viên/giá bàn/menu/giao dịch)
└─ features/                   -> BACKEND — mỗi trang 1 file .js, chỉ chứa API (không có HTML)
   ├─ auth.js                    -> API đăng nhập/đăng xuất/phiên + phục vụ public/login.html
   ├─ tables.js                  -> API mở/gọi món/ghi chú/thanh toán bàn + phục vụ public/tables.html
   ├─ reservations.js            -> API đặt bàn trước + phục vụ public/resv.html
   └─ manage.js                  -> API nhân viên/giá bàn/menu/giao dịch + phục vụ public/manage.html
```
Mỗi cặp file cùng tên (VD: `public/tables.html` + `features/tables.js`) là **1 trang**:
- File `.html` là giao diện thật — mở bằng bất kỳ trình soạn thảo nào cũng thấy đúng
  HTML/CSS/JS, có tô màu cú pháp bình thường, dễ sửa giao diện.
- File `.js` cùng tên chỉ chứa API (backend) cho đúng trang đó.

Muốn sửa giao diện trang nào, mở file `.html` tương ứng trong `public/`. Muốn sửa
logic/API trang nào, mở file `.js` tương ứng trong `features/`. Sửa trang này không
đụng tới trang khác.

Lưu ý: một vài trang cần đọc dữ liệu do trang khác quản lý (VD: trang Sơ đồ bàn cần
đọc danh sách nhân viên/menu để hiển thị) — việc này luôn thực hiện qua gọi API
(`fetch('/api/...')`) từ trình duyệt, không import code giữa các file `.js`, nên
backend của các trang vẫn hoàn toàn độc lập với nhau.

## ⚠️ Đã có database từ trước? Cần nâng cấp trước khi dùng bản này

Bản này thêm 3 tính năng mới cần thay đổi cấu trúc CSDL. Nếu bạn **đã từng chạy
`db_schema.sql` rồi** (đã có dữ liệu nhân viên/menu/giao dịch...), chạy thêm lệnh
sau **1 lần** trước khi `npm start` (không chạy lại `db_schema.sql`, sẽ mất dữ liệu cũ):

```bash
mysql -u root -p billiard_coffee < migration_v2_features.sql
```
PowerShell:
```powershell
Get-Content migration_v2_features.sql | mysql -u root -p billiard_coffee
```

Nếu đây là lần đầu bạn cài đặt (chưa từng chạy `db_schema.sql`), **bỏ qua bước này** —
chỉ cần chạy `db_schema.sql` như hướng dẫn bên dưới là đã có đủ mọi thứ.

## 3 tính năng mới

**1. Sửa sơ đồ bàn** — ở trang Sơ đồ bàn, bấm nút **"🛠️ Sửa sơ đồ bàn"** ở góc trên
bên phải để bật chế độ sửa: bấm vào 1 bàn để đổi tên (VD "Bàn VIP 1", "Sân ngoài A2"),
bấm dấu **✕** trên bàn đang trống để xoá, hoặc bấm ô **"+ Thêm bàn"** ở cuối lưới để
thêm bàn mới. Bấm **"✅ Xong"** để thoát chế độ sửa. Không xoá được bàn đang phục vụ
khách — phải thanh toán hoặc huỷ bàn trước.

**2. Cắt bàn** — trong ngăn kéo của 1 bàn đang mở, bấm **"✂️ Cắt bàn"**: tiền giờ +
tiền đồ uống tính đến thời điểm đó được **chốt lại** thành "Lần 1", bàn vẫn tiếp tục
mở bình thường và bắt đầu tính lại từ đầu cho "Lần 2". Có thể cắt nhiều lần. Khi bấm
**Thanh toán**, màn hình sẽ liệt kê rõ từng lần (Lần 1: xxx đ, Lần 2: xxx đ...) cùng
tổng cộng, để khách tự chia nhau trả.

**3. Thêm giờ** — trong ngăn kéo bàn đang mở, bấm **"⏱️ Thêm giờ"**, nhập số phút cần
cộng thêm (VD nhân viên quên bấm mở bàn lúc khách mới vào, giờ mở trễ 15 phút thì
nhập 15). Hệ thống sẽ lùi đồng hồ tính tiền lại đúng số phút đó ngay lập tức.

## 4. Lịch sử hoạt động (quản lý lịch sử — chỉ xem, không sửa/xoá được trên web)

Mọi thao tác quan trọng trong app đều được ghi lại vào bảng `audit_logs`:
mở/đóng/huỷ bàn, cắt bàn, thêm giờ, gọi món, sửa ghi chú, đổi tên/thêm/xoá bàn
trong sơ đồ, thanh toán, xuất Excel, thêm/xoá nhân viên, sửa giá bàn, thêm/sửa/xoá
menu, đặt bàn/huỷ đặt bàn, đăng nhập (kể cả đăng nhập sai)/đăng xuất, và cấp tài
khoản bằng `create-user.js`.

Vào **Quản lý → 📜 Lịch sử** để xem — tab này **ai đăng nhập cũng thấy** (không
phân biệt admin/nhân viên), nhưng bấm vào sẽ phải **nhập đúng 1 mật khẩu riêng**
(khác hẳn mật khẩu đăng nhập của từng người) thì mới xem được nội dung bên trong.
Mật khẩu này do chủ quán tự cấp bằng lệnh chạy trên máy chủ (không có form nào
trên web để tự đổi):
```bash
node scripts/set-audit-password.js "MatKhauLichSuCuaQuan123"
```
Chạy lại lệnh này với mật khẩu mới bất cứ lúc nào để **đổi** mật khẩu (không cần
biết mật khẩu cũ). Sau khi 1 người nhập đúng, phiên đăng nhập đó xem được lịch
sử tới khi đăng xuất; người khác đăng nhập phiên riêng vẫn phải nhập lại.

Trong trang Lịch sử có thể lọc theo loại (Quản lý bàn / Giao dịch / Nhân viên /
Menu / Giá bàn / Đặt bàn / Đăng nhập), theo người thực hiện, theo khoảng ngày,
hoặc tìm theo nội dung. Bấm vào 1 dòng để xem chi tiết đầy đủ.

**Quan trọng:** trang này chỉ có thể xem (GET) — không có bất kỳ API nào để sửa
hoặc xoá bản ghi lịch sử từ giao diện web. Muốn sửa/xoá lịch sử cũ (VD dọn bớt
log quá hạn) thì phải thao tác trực tiếp trong MySQL, ví dụ:
```sql
DELETE FROM audit_logs WHERE created_at < '2026-01-01';
```

Nếu bạn **đã có database từ trước** (đã chạy `db_schema.sql` bản cũ), chạy thêm
theo đúng thứ tự — bỏ qua file nào bạn đã chạy rồi:
```bash
mysql -u root -p billiard_coffee < migration_v3_audit.sql
mysql -u root -p billiard_coffee < migration_v4_audit_password.sql
mysql -u root -p billiard_coffee < migration_v5_pause.sql   # nút Tạm dừng / Tiếp tục bàn
```
Sau đó nhớ cấp mật khẩu Lịch sử bằng lệnh `set-audit-password.js` ở trên — nếu
chưa cấp, ai bấm vào tab Lịch sử cũng sẽ thấy thông báo "Chưa thiết lập mật khẩu".

## Cài đặt (chạy trên máy tính của quán)

### 1. Cài Node.js và MySQL
- Cài **Node.js** (bản LTS): https://nodejs.org
- Cài **MySQL Server** (hoặc dùng XAMPP/Laragon nếu bạn quen dùng, chỉ cần có MySQL chạy trên máy).

### 2. Tạo database
Mở terminal/cmd tại thư mục `billiard-coffee-sql`, chạy:
```bash
mysql -u root -p < db_schema.sql
```
Lệnh này tự tạo database `billiard_coffee`, toàn bộ bảng và dữ liệu mẫu (menu, giá bàn, nhân viên mẫu, 20 bàn trống).

### 3. Cấu hình kết nối
```bash
copy .env.example .env      (Windows)
cp .env.example .env         (macOS/Linux)
```
Mở file `.env`, điền đúng `DB_USER`, `DB_PASSWORD` MySQL của bạn.

### 4. Cài thư viện Node
```bash
npm install
```

### 5. Cấp tài khoản đăng nhập đầu tiên (KHÔNG có form đăng ký trên web)
```bash
node scripts/create-user.js admin "MatKhauCuaBan123" "Chủ quán" admin
```
Muốn cấp thêm tài khoản cho nhân viên:
```bash
node scripts/create-user.js nga "MatKhauNhanVien1" "Đoàn Thủy Nga" staff
```
Chạy lại lệnh này với cùng username sẽ **đổi mật khẩu/quyền** cho tài khoản đó
(không tạo trùng). Đây chính là cách "cấp tài khoản trên SQL" bạn yêu cầu —
chỉ ai chạy được lệnh trên máy chủ (tức chủ quán) mới tạo được tài khoản.

### 6. Chạy web
```bash
npm start
```
Mở trình duyệt vào: **http://localhost:3000**
→ tự chuyển tới trang đăng nhập (`/login.html`) → đăng nhập bằng tài khoản vừa
cấp ở bước 5 → tự chuyển vào `/tables.html`.

## Cách hoạt động
- Mọi thao tác (mở bàn, gọi món, ghi chú, thanh toán, thêm/xoá nhân viên,
  sửa giá, sửa menu, đặt bàn...) đều gọi API (`/api/...`) và **ghi thẳng vào MySQL**.
  Không có dữ liệu nào lưu tạm trong JavaScript nữa — tắt trình duyệt, mở
  máy khác, dữ liệu vẫn còn nguyên vì nằm trong database.
- Mọi API (trừ `/api/login`, `/api/session`) đều yêu cầu đã đăng nhập
  (kiểm tra bằng session phía server) — chưa đăng nhập sẽ không đọc/ghi được gì.
- Ghi chú cho quản lý (📝) có thể sửa bất cứ lúc nào từ khi mở bàn tới lúc thanh toán.
- Trong Quản lý → Menu, phải bấm nút **"Sửa"** mới chỉnh được tên/giá món,
  bấm **"Lưu"** để ghi vào SQL hoặc **"Huỷ"** để bỏ qua.
- Trong Quản lý → Giá bàn: sửa giá ở đây chỉ áp dụng cho **bàn mở mới**;
  bàn đang mở giữ nguyên giá tại thời điểm mở (được lưu snapshot trong bảng
  `billiard_tables`), đúng như dòng ghi chú trên giao diện.
- Khi thanh toán, hệ thống lưu lại đúng tên/giá từng món đã bán vào bảng
  `transaction_items`, nên báo cáo doanh thu cũ không bị thay đổi dù sau này
  bạn sửa giá menu.
- Ở trang Quản lý → Giao dịch có nút **"⬇️ Xuất Excel"** — xuất đúng theo bộ lọc
  đang chọn (ngày / khoảng ngày / tháng / tất cả), file `.xlsx` được tạo ngay
  trên server từ dữ liệu SQL (không cần internet), gồm cả cột "Món đã gọi" của
  từng giao dịch và dòng tổng cộng ở cuối.

## Triển khai cho nhiều máy trong quán cùng dùng
Vì dữ liệu nằm trên MySQL của máy chạy `npm start`, các máy/điện thoại khác
trong cùng mạng Wi-Fi của quán có thể truy cập bằng địa chỉ IP của máy đó,
ví dụ `http://192.168.1.10:3000` (xem IP bằng `ipconfig`/`ifconfig`).
