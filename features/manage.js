const express = require('express');
const path = require('path');
const ExcelJS = require('exceljs');
const pool = require('../db');
const { requireAuthApi, requireAuthPage } = require('../middleware/auth');
const { logAudit, vnd } = require('../utils/audit');

const router = express.Router();

/* ================= FRONT-END: giao diện nằm ở public/manage.html ================= */
router.get('/manage.html', requireAuthPage, (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'manage.html')));

/* ================= BACK-END: API nhân viên / giá bàn / menu / giao dịch ================= */
router.use(['/api/employees', '/api/rates', '/api/menu', '/api/transactions'], requireAuthApi);

// Nhân viên
router.get('/api/employees', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM employees WHERE active=1 ORDER BY id');
  res.json(rows);
});
router.post('/api/employees', async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nhập tên nhân viên.' });
  const [r] = await pool.query('INSERT INTO employees (name) VALUES (?)', [name]);
  await logAudit(req, { category: 'employee', action: 'add', entity_id: r.insertId, entity_label: name,
    description: `Thêm nhân viên: ${name}` });
  res.json({ id: r.insertId, name, active: 1 });
});
router.delete('/api/employees/:id', async (req, res) => {
  const [[emp]] = await pool.query('SELECT id, name FROM employees WHERE id=?', [req.params.id]);
  await pool.query('UPDATE employees SET active=0 WHERE id=?', [req.params.id]);
  if (emp) await logAudit(req, { category: 'employee', action: 'delete', entity_id: emp.id, entity_label: emp.name,
    description: `Xoá nhân viên: ${emp.name}` });
  res.json({ ok: true });
});

// Giá bàn
router.get('/api/rates', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM rates ORDER BY id');
  res.json(rows);
});
router.put('/api/rates/:id', async (req, res) => {
  const { name, per_hour } = req.body;
  const [[old]] = await pool.query('SELECT * FROM rates WHERE id=?', [req.params.id]);
  await pool.query('UPDATE rates SET name=?, per_hour=? WHERE id=?', [name, per_hour || 0, req.params.id]);
  if (old && (old.name !== name || Number(old.per_hour) !== Number(per_hour || 0))) {
    await logAudit(req, { category: 'rate', action: 'edit', entity_id: old.id, entity_label: old.name,
      description: `Sửa giá bàn "${old.name}": ${vnd(old.per_hour)}/giờ → ${vnd(per_hour || 0)}/giờ${old.name !== name ? ` (đổi tên thành "${name}")` : ''}`,
      details: { 'Tên cũ': old.name, 'Tên mới': name, 'Giá cũ': vnd(old.per_hour) + '/giờ', 'Giá mới': vnd(per_hour || 0) + '/giờ' } });
  }
  res.json({ ok: true });
});

// Menu
router.get('/api/menu', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM menu_items ORDER BY id');
  res.json(rows);
});
router.post('/api/menu', async (req, res) => {
  const name = (req.body.name || '').trim();
  const price = parseInt(req.body.price) || 0;
  if (!name) return res.status(400).json({ error: 'Nhập tên món.' });
  const [r] = await pool.query('INSERT INTO menu_items (name, price) VALUES (?,?)', [name, price]);
  await logAudit(req, { category: 'menu', action: 'add', entity_id: r.insertId, entity_label: name,
    description: `Thêm món vào menu: ${name} — ${vnd(price)}` });
  res.json({ id: r.insertId, name, price });
});
router.put('/api/menu/:id', async (req, res) => {
  const name = (req.body.name || '').trim();
  const price = parseInt(req.body.price) || 0;
  if (!name) return res.status(400).json({ error: 'Nhập tên món.' });
  const [[old]] = await pool.query('SELECT * FROM menu_items WHERE id=?', [req.params.id]);
  await pool.query('UPDATE menu_items SET name=?, price=? WHERE id=?', [name, price, req.params.id]);
  if (old && (old.name !== name || Number(old.price) !== price)) {
    await logAudit(req, { category: 'menu', action: 'edit', entity_id: old.id, entity_label: old.name,
      description: `Sửa món "${old.name}": ${vnd(old.price)} → ${vnd(price)}${old.name !== name ? ` (đổi tên thành "${name}")` : ''}`,
      details: { 'Tên cũ': old.name, 'Tên mới': name, 'Giá cũ': vnd(old.price), 'Giá mới': vnd(price) } });
  }
  res.json({ ok: true });
});
router.delete('/api/menu/:id', async (req, res) => {
  const [[old]] = await pool.query('SELECT * FROM menu_items WHERE id=?', [req.params.id]);
  await pool.query('DELETE FROM menu_items WHERE id=?', [req.params.id]); // table_orders liên quan tự xoá theo CASCADE
  if (old) await logAudit(req, { category: 'menu', action: 'delete', entity_id: old.id, entity_label: old.name,
    description: `Xoá món khỏi menu: ${old.name} (${vnd(old.price)})` });
  res.json({ ok: true });
});

// Giao dịch
function buildTransactionFilter(query) {
  const { mode, day, from, to, month } = query;
  let where = '1=1', params = [];
  if (mode === 'day' && day) { where = 'DATE(t.created_at)=?'; params = [day]; }
  else if (mode === 'range') {
    const clauses = [];
    if (from) { clauses.push('DATE(t.created_at)>=?'); params.push(from); }
    if (to) { clauses.push('DATE(t.created_at)<=?'); params.push(to); }
    if (clauses.length) where = clauses.join(' AND ');
  } else if (mode === 'month' && month) { where = "DATE_FORMAT(t.created_at,'%Y-%m')=?"; params = [month]; }
  return { where, params };
}

router.get('/api/transactions', async (req, res) => {
  const { where, params } = buildTransactionFilter(req.query);
  const [rows] = await pool.query(
    `SELECT t.* FROM transactions t WHERE ${where} ORDER BY t.created_at DESC`, params
  );
  res.json(rows);
});

// Xuất Excel — theo đúng bộ lọc đang chọn trên giao diện (ngày / khoảng ngày / tháng / tất cả)
router.get('/api/transactions/export', async (req, res) => {
  const { where, params } = buildTransactionFilter(req.query);
  const [rows] = await pool.query(
    `SELECT t.*,
       GROUP_CONCAT(CONCAT(ti.item_name,' x',ti.qty) SEPARATOR ', ') AS items
     FROM transactions t
     LEFT JOIN transaction_items ti ON ti.transaction_id = t.id
     WHERE ${where}
     GROUP BY t.id
     ORDER BY t.created_at DESC`, params
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Billiard Coffee';
  wb.created = new Date();
  const sheet = wb.addWorksheet('Giao dịch');

  sheet.columns = [
    { header: 'Thời gian', key: 'time', width: 20 },
    { header: 'Bàn', key: 'table', width: 8 },
    { header: 'Nhân viên', key: 'employee', width: 20 },
    { header: 'Phương thức', key: 'method', width: 16 },
    { header: 'Món đã gọi', key: 'items', width: 40 },
    { header: 'Ghi chú', key: 'note', width: 24 },
    { header: 'Số tiền (đ)', key: 'amount', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9E3D3' } };
  sheet.autoFilter = { from: 'A1', to: 'G1' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  const methodLabel = (m) => (m === 'cash' ? 'Tiền mặt' : m === 'transfer' ? 'Chuyển khoản' : m);
  let total = 0;
  rows.forEach(r => {
    total += Number(r.amount);
    sheet.addRow({
      time: new Date(r.created_at).toLocaleString('vi-VN'),
      table: r.table_id,
      employee: r.employee_name || '—',
      method: methodLabel(r.method),
      items: r.items || '',
      note: r.note || '',
      amount: Number(r.amount),
    });
  });
  sheet.getColumn('amount').numFmt = '#,##0';

  const totalRow = sheet.addRow({ time: '', table: '', employee: '', method: '', items: '', note: 'TỔNG CỘNG', amount: total });
  totalRow.font = { bold: true };
  totalRow.getCell('amount').numFmt = '#,##0';

  await logAudit(req, { category: 'transaction', action: 'export', entity_label: 'Xuất Excel',
    description: `Xuất Excel giao dịch: ${rows.length} dòng, tổng ${vnd(total)}`,
    details: { 'Bộ lọc': JSON.stringify(req.query) } });
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="giao-dich-${stamp}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

module.exports = router;
