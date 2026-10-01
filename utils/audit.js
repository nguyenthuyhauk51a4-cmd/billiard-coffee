// Ghi lịch sử hoạt động vào bảng audit_logs.
// Chỉ có hàm THÊM — cố ý không có hàm sửa/xoá. Muốn dọn lịch sử phải làm trực tiếp trong MySQL.
const pool = require('../db');

// category: table | transaction | employee | menu | rate | reservation | auth
async function logAudit(req, { category, action, entity_id = null, entity_label = null, description, details = null, actor = null }) {
  try {
    const u = actor || (req && req.session && req.session.user) || null;
    const actorName = u ? (u.full_name || u.username || null) : null;
    const ip = req && (req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress)) || null;
    await pool.query(
      `INSERT INTO audit_logs (category, action, entity_id, entity_label, description, details, actor_id, actor_name, ip)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [category, action, entity_id, entity_label, String(description).slice(0, 500),
       details ? JSON.stringify(details) : null, u ? (u.id || null) : null, actorName, ip ? String(ip).slice(0, 64) : null]
    );
  } catch (e) {
    // Lỗi ghi lịch sử không được làm hỏng thao tác chính của quán
    console.error('[audit] Không ghi được lịch sử:', e.message);
  }
}

const vnd = (n) => Math.round(Number(n) || 0).toLocaleString('vi-VN') + 'đ';
const tableName = (t) => (t && t.label) ? t.label : 'Bàn ' + (t && t.id);

module.exports = { logAudit, vnd, tableName };
