const express = require('express');
const path = require('path');
const pool = require('../db');
const { requireAuthApi, requireAuthPage } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();

/* ================= FRONT-END: giao diện nằm ở public/resv.html ================= */
router.get('/resv.html', requireAuthPage, (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'resv.html')));

/* ================= BACK-END: API đặt bàn trước ================= */
router.use('/api/reservations', requireAuthApi);

router.get('/api/reservations', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM reservations ORDER BY reserve_time');
  res.json(rows);
});
router.post('/api/reservations', async (req, res) => {
  const { name, phone, reserve_time, guests, note, table_id } = req.body;
  if (!name || !reserve_time) return res.status(400).json({ error: 'Nhập tên khách và giờ đến.' });
  const [r] = await pool.query(
    'INSERT INTO reservations (name, phone, reserve_time, guests, note, table_id) VALUES (?,?,?,?,?,?)',
    [name, phone || null, new Date(reserve_time), guests || 1, note || null, table_id || null]
  );
  await logAudit(req, { category: 'reservation', action: 'add', entity_id: r.insertId, entity_label: name,
    description: `Đặt bàn cho ${name} lúc ${new Date(reserve_time).toLocaleString('vi-VN')}${table_id ? ' (bàn ' + table_id + ')' : ''}`,
    details: { 'Khách': name, 'SĐT': phone || '—', 'Giờ đến': new Date(reserve_time).toLocaleString('vi-VN'),
      'Số khách': guests || 1, 'Bàn': table_id || 'chưa chọn', 'Ghi chú': note || '—' } });
  res.json({ id: r.insertId });
});
router.delete('/api/reservations/:id', async (req, res) => {
  const [[old]] = await pool.query('SELECT * FROM reservations WHERE id=?', [req.params.id]);
  await pool.query('DELETE FROM reservations WHERE id=?', [req.params.id]);
  if (old) await logAudit(req, { category: 'reservation', action: 'cancel', entity_id: old.id, entity_label: old.name,
    description: `Huỷ/xoá lịch đặt bàn của ${old.name} (${new Date(old.reserve_time).toLocaleString('vi-VN')})`,
    details: { 'Khách': old.name, 'SĐT': old.phone || '—', 'Giờ đến': new Date(old.reserve_time).toLocaleString('vi-VN'),
      'Số khách': old.guests, 'Bàn': old.table_id || 'chưa chọn', 'Ghi chú': old.note || '—' } });
  res.json({ ok: true });
});

module.exports = router;
