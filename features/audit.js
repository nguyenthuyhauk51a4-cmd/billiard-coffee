const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { requireAuthApi } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

/* ================= BACK-END: API xem lịch sử hoạt động =================
   Bất kỳ ai đã đăng nhập (không phân biệt admin/staff) đều XEM ĐƯỢC lịch sử,
   nhưng phải nhập đúng "mật khẩu Lịch sử" riêng (cấp bằng scripts/set-audit-password.js)
   thì mới mở khoá được — mật khẩu này khác mật khẩu đăng nhập của từng người.
   Sau khi mở khoá, giữ hiệu lực cho tới khi đăng xuất (lưu trong session).
   CHỈ CÓ GET để đọc dữ liệu + 1 route POST để mở khoá. Không có API nào sửa/xoá
   bản ghi lịch sử — muốn sửa/xoá phải thao tác trực tiếp trong MySQL. */
router.use('/api/audit', requireAuthApi);

async function getAuditPasswordHash() {
  const [[row]] = await pool.query("SELECT value FROM settings WHERE `key`='audit_password_hash'");
  return row ? row.value : null;
}

// Trạng thái mở khoá của phiên hiện tại + đã cấu hình mật khẩu chưa
router.get('/api/audit/status', async (req, res) => {
  const hash = await getAuditPasswordHash();
  res.json({ configured: !!hash, unlocked: !!req.session.auditUnlocked });
});

// Nhập mật khẩu Lịch sử để mở khoá cho phiên đăng nhập hiện tại
router.post('/api/audit/unlock', async (req, res) => {
  const { password } = req.body || {};
  const hash = await getAuditPasswordHash();
  if (!hash) return res.status(400).json({ error: 'Chưa thiết lập mật khẩu Lịch sử. Nhờ chủ quán chạy: node scripts/set-audit-password.js "MatKhau..."' });
  const ok = password && await bcrypt.compare(password, hash);
  if (!ok) {
    await logAudit(req, { category: 'auth', action: 'audit_unlock_failed', description: 'Nhập SAI mật khẩu Lịch sử' });
    return res.status(400).json({ error: 'Sai mật khẩu Lịch sử.' }); // 400, không dùng 401 để tránh bị front-end tự đá về trang đăng nhập
  }
  req.session.auditUnlocked = true;
  await logAudit(req, { category: 'auth', action: 'audit_unlock', description: 'Mở khoá xem Lịch sử' });
  res.json({ ok: true });
});

// Từ đây trở xuống bắt buộc đã mở khoá trong phiên này
function requireAuditUnlocked(req, res, next) {
  // 403 (không phải 401) để tránh front-end tự đá về trang đăng nhập — đây chỉ là "chưa mở khoá Lịch sử", không phải "chưa đăng nhập"
  if (!req.session.auditUnlocked) return res.status(403).json({ error: 'locked', locked: true });
  next();
}

const CATEGORIES = ['table', 'transaction', 'employee', 'menu', 'rate', 'reservation', 'auth'];

router.get('/api/audit', requireAuditUnlocked, async (req, res) => {
  const { category, actor, from, to, q } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const where = ['1=1'], params = [];
  if (category && CATEGORIES.includes(category)) { where.push('category=?'); params.push(category); }
  if (actor) { where.push('actor_name=?'); params.push(actor); }
  if (from) { where.push('DATE(created_at)>=?'); params.push(from); }
  if (to) { where.push('DATE(created_at)<=?'); params.push(to); }
  if (q) { where.push('(description LIKE ? OR entity_label LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
  const w = where.join(' AND ');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_logs WHERE ${w}`, params);
  const [rows] = await pool.query(
    `SELECT * FROM audit_logs WHERE ${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit]
  );
  res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
});

// Danh sách người thực hiện để đổ vào ô lọc
router.get('/api/audit/actors', requireAuditUnlocked, async (req, res) => {
  const [rows] = await pool.query(
    "SELECT DISTINCT actor_name FROM audit_logs WHERE actor_name IS NOT NULL AND actor_name<>'' ORDER BY actor_name");
  res.json(rows.map(r => r.actor_name));
});

module.exports = router;
