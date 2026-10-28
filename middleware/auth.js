// Dùng chung cho tất cả các trang/API — chỉ có 2 hàm nhỏ, hầu như không bao giờ phải sửa,
// nên để riêng ở đây không tính là "logic của một trang cụ thể".

function requireAuthApi(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Chưa đăng nhập.' });
  next();
}

function requireAuthPage(req, res, next) {
  if (!req.session.user) return res.redirect('/login.html');
  next();
}

// Phần có mật khẩu riêng (Lịch sử + Quản lý kho): phải mở khoá trong phiên đăng nhập này.
// 403 (không phải 401) để front-end không tự đá về trang đăng nhập.
function requireAuditUnlocked(req, res, next) {
  if (!req.session.auditUnlocked) return res.status(403).json({ error: 'locked', locked: true });
  next();
}

// Trang Nhập kho có mật khẩu riêng (do chủ quán cấp bằng scripts/set-stock-password.js)
function requireStockUnlocked(req, res, next) {
  if (!req.session.stockUnlocked) return res.status(403).json({ error: 'locked', locked: true });
  next();
}

// Cho phép nếu đã mở khoá trang Nhập kho HOẶC đã mở khoá Lịch sử (dùng cho thao tác sửa phiếu nhập)
function requireStockOrAuditUnlocked(req, res, next) {
  if (!req.session.stockUnlocked && !req.session.auditUnlocked) return res.status(403).json({ error: 'locked', locked: true });
  next();
}

module.exports = { requireAuthApi, requireAuthPage, requireAuditUnlocked, requireStockUnlocked, requireStockOrAuditUnlocked };
