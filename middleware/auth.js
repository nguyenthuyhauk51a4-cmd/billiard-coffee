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

module.exports = { requireAuthApi, requireAuthPage };
