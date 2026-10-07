const express = require('express');
const path = require('path');
const pool = require('../db');
const { requireAuthApi, requireAuthPage } = require('../middleware/auth');
const { logAudit, vnd, tableName } = require('../utils/audit');

const router = express.Router();

/* ================= FRONT-END: giao diện nằm ở public/tables.html ================= */
router.get('/tables.html', requireAuthPage, (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'tables.html')));

/* ================= BACK-END: API cho bàn ================= */
router.use('/api/tables', requireAuthApi);

/* ---- Helper dùng chung ---- */

// Lấy đầy đủ thông tin 1 bàn: món đang gọi của LẦN CHƠI HIỆN TẠI + các lần đã cắt trước đó
async function fetchTable(id) {
  const [[t]] = await pool.query('SELECT * FROM billiard_tables WHERE id=?', [id]);
  if (!t) return null;
  const [orders] = await pool.query(
    `SELECT o.menu_item_id, m.name, m.price, o.qty
     FROM table_orders o JOIN menu_items m ON m.id=o.menu_item_id
     WHERE o.table_id=? AND o.segment=?`, [id, t.current_segment]
  );
  const [segments] = await pool.query(
    'SELECT segment_no, start_time, end_time, time_amount, drinks_amount, items FROM table_segments WHERE table_id=? ORDER BY segment_no',
    [id]
  );
  return { ...t, orders, segments };
}

// Thời điểm "hiện tại" dùng để tính giờ: nếu bàn đang tạm dừng thì đồng hồ đứng yên tại paused_at
function effectiveNowMs(t) {
  return (t.paused && t.paused_at) ? new Date(t.paused_at).getTime() : Date.now();
}
// Tổng số giây đã tạm dừng của lượt mở bàn (gồm cả đợt đang tạm dừng dở nếu có)
function totalPausedSec(t) {
  const running = (t.paused && t.paused_at) ? Math.max(0, Math.round((Date.now() - new Date(t.paused_at).getTime()) / 1000)) : 0;
  return (t.paused_total_sec || 0) + running;
}
function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h > 0) return `${h} giờ ${m} phút`;
  if (m > 0) return `${m} phút ${s} giây`;
  return `${s} giây`;
}

async function resetTable(id) {
  await pool.query('DELETE FROM table_orders WHERE table_id=?', [id]);
  await pool.query('DELETE FROM table_segments WHERE table_id=?', [id]);
  await pool.query(
    `UPDATE billiard_tables SET busy=0, start_time=NULL, rate_id=NULL, rate_name=NULL,
     rate_per_hour=NULL, guests=0, note='', expected_end=NULL, current_segment=1, segment_start_time=NULL,
     paused=0, paused_at=NULL, paused_total_sec=0
     WHERE id=?`, [id]
  );
}

// Tính tiền giờ + tiền đồ uống của LẦN CHƠI HIỆN TẠI (chưa chốt), tính tới thời điểm gọi hàm này
async function computeCurrentSegmentAmounts(t) {
  const [orders] = await pool.query(
    `SELECT o.qty, m.price FROM table_orders o JOIN menu_items m ON m.id=o.menu_item_id
     WHERE o.table_id=? AND o.segment=?`, [t.id, t.current_segment]
  );
  const drinksAmount = orders.reduce((s, o) => s + o.price * o.qty, 0);
  const hours = (effectiveNowMs(t) - new Date(t.segment_start_time).getTime()) / 3600000; // bàn tạm dừng → dừng tại paused_at
  const timeAmount = t.rate_per_hour ? Math.round(hours * t.rate_per_hour) : 0;
  return { timeAmount, drinksAmount };
}
async function currentSegmentItemsLabel(tableId, segment) {
  const [rows] = await pool.query(
    `SELECT m.name, o.qty FROM table_orders o JOIN menu_items m ON m.id=o.menu_item_id
     WHERE o.table_id=? AND o.segment=?`, [tableId, segment]
  );
  return rows.map(r => `${r.name} x${r.qty}`).join(', ');
}

// Tạm tính toàn bộ hoá đơn của bàn đang mở (các lần đã cắt + lần hiện tại) — dùng để ghi lịch sử huỷ bàn
async function billSnapshot(t) {
  const [past] = await pool.query(
    'SELECT segment_no, time_amount, drinks_amount FROM table_segments WHERE table_id=? ORDER BY segment_no', [t.id]);
  const cur = await computeCurrentSegmentAmounts(t);
  const total = past.reduce((s, x) => s + Number(x.time_amount) + Number(x.drinks_amount), 0) + cur.timeAmount + cur.drinksAmount;
  const [items] = await pool.query(
    `SELECT m.name, SUM(o.qty) AS qty FROM table_orders o JOIN menu_items m ON m.id=o.menu_item_id
     WHERE o.table_id=? GROUP BY m.id, m.name`, [t.id]);
  return { total, cuts: past.length, items: items.map(i => `${i.name} x${i.qty}`).join(', ') };
}

/* ---- Đọc danh sách / chi tiết bàn ---- */
router.get('/api/tables', async (req, res) => {
  const [ids] = await pool.query('SELECT id FROM billiard_tables ORDER BY id');
  const out = [];
  for (const row of ids) out.push(await fetchTable(row.id));
  res.json(out);
});
router.get('/api/tables/:id', async (req, res) => {
  const t = await fetchTable(req.params.id);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy bàn.' });
  res.json(t);
});

/* ---- Sửa sơ đồ bàn: thêm / đổi tên / xoá bàn theo deco quán ---- */
router.post('/api/tables', async (req, res) => {
  const label = (req.body.label || '').trim() || null;
  const [r] = await pool.query('INSERT INTO billiard_tables (label) VALUES (?)', [label]);
  const created = await fetchTable(r.insertId);
  await logAudit(req, { category: 'table', action: 'add_table', entity_id: r.insertId, entity_label: tableName(created),
    description: `Thêm bàn mới: ${tableName(created)}` });
  res.json(created);
});
router.put('/api/tables/:id/label', async (req, res) => {
  const label = (req.body.label || '').trim() || null;
  const [[old]] = await pool.query('SELECT id, label FROM billiard_tables WHERE id=?', [req.params.id]);
  await pool.query('UPDATE billiard_tables SET label=? WHERE id=?', [label, req.params.id]);
  if (old) await logAudit(req, { category: 'table', action: 'rename_table', entity_id: old.id, entity_label: tableName(old),
    description: `Đổi tên ${tableName(old)} → ${label || 'Bàn ' + old.id}`,
    details: { 'Tên cũ': tableName(old), 'Tên mới': label || 'Bàn ' + old.id } });
  res.json({ ok: true, label });
});
router.delete('/api/tables/:id', async (req, res) => {
  const [[t]] = await pool.query('SELECT id, label, busy FROM billiard_tables WHERE id=?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Không tìm thấy bàn.' });
  if (t.busy) return res.status(400).json({ error: 'Bàn đang phục vụ — thanh toán hoặc huỷ bàn trước khi xoá.' });
  await pool.query('DELETE FROM billiard_tables WHERE id=?', [req.params.id]);
  await logAudit(req, { category: 'table', action: 'delete_table', entity_id: t.id, entity_label: tableName(t),
    description: `Xoá bàn khỏi sơ đồ: ${tableName(t)}` });
  res.json({ ok: true });
});

/* ---- Mở bàn / ghi chú / gọi món / huỷ bàn ---- */
router.post('/api/tables/:id/open', async (req, res) => {
  const id = req.params.id;
  const { rate_id, guests, duration_min, note } = req.body;
  const [[rate]] = await pool.query('SELECT * FROM rates WHERE id=?', [rate_id]);
  if (!rate) return res.status(400).json({ error: 'Hạng giá không hợp lệ.' });
  const expectedEnd = duration_min > 0 ? new Date(Date.now() + duration_min * 60000) : null;
  await pool.query(
    `UPDATE billiard_tables
     SET busy=1, start_time=NOW(), segment_start_time=NOW(), current_segment=1,
         paused=0, paused_at=NULL, paused_total_sec=0,
         rate_id=?, rate_name=?, rate_per_hour=?, guests=?, note=?, expected_end=?
     WHERE id=?`,
    [rate.id, rate.name, rate.per_hour, guests || 1, (note || '').trim(), expectedEnd, id]
  );
  const opened = await fetchTable(id);
  await logAudit(req, { category: 'table', action: 'open', entity_id: opened.id, entity_label: tableName(opened),
    description: `Mở ${tableName(opened)} — ${rate.name} (${vnd(rate.per_hour)}/giờ), ${guests || 1} khách`,
    details: { 'Hạng giá': `${rate.name} (${vnd(rate.per_hour)}/giờ)`, 'Số khách': guests || 1,
      'Hẹn giờ (phút)': duration_min > 0 ? duration_min : 'không', 'Ghi chú': (note || '').trim() || '—' } });
  res.json(opened);
});
router.put('/api/tables/:id/note', async (req, res) => {
  const note = (req.body.note || '').trim();
  const [[old]] = await pool.query('SELECT id, label, note FROM billiard_tables WHERE id=?', [req.params.id]);
  await pool.query('UPDATE billiard_tables SET note=? WHERE id=?', [note, req.params.id]);
  if (old && old.note !== note) await logAudit(req, { category: 'table', action: 'edit_note', entity_id: old.id, entity_label: tableName(old),
    description: `Sửa ghi chú ${tableName(old)}`,
    details: { 'Ghi chú cũ': old.note || '—', 'Ghi chú mới': note || '—' } });
  res.json({ ok: true, note });
});
router.post('/api/tables/:id/order', async (req, res) => {
  const id = req.params.id;
  const { menu_item_id, delta } = req.body;
  const [[tbl]] = await pool.query('SELECT current_segment FROM billiard_tables WHERE id=?', [id]);
  if (!tbl) return res.status(404).json({ error: 'Không tìm thấy bàn.' });
  const segment = tbl.current_segment;
  const [[existing]] = await pool.query(
    'SELECT * FROM table_orders WHERE table_id=? AND menu_item_id=? AND segment=?', [id, menu_item_id, segment]
  );
  const before = existing ? existing.qty : 0;
  const next = Math.max(0, before + delta);
  if (next === 0) {
    if (existing) await pool.query('DELETE FROM table_orders WHERE id=?', [existing.id]);
  } else if (existing) {
    await pool.query('UPDATE table_orders SET qty=? WHERE id=?', [next, existing.id]);
  } else {
    await pool.query('INSERT INTO table_orders (table_id, menu_item_id, segment, qty) VALUES (?,?,?,?)', [id, menu_item_id, segment, next]);
  }
  if (next !== before) {
    const [[mi]] = await pool.query('SELECT name, price FROM menu_items WHERE id=?', [menu_item_id]);
    const [[tinfo]] = await pool.query('SELECT id, label FROM billiard_tables WHERE id=?', [id]);
    await logAudit(req, { category: 'table', action: next > before ? 'order_add' : 'order_remove', entity_id: tinfo.id, entity_label: tableName(tinfo),
      description: `${tableName(tinfo)}: ${next > before ? 'gọi thêm' : 'bớt'} ${mi ? mi.name : 'món #' + menu_item_id} (${before} → ${next})`,
      details: { 'Món': mi ? mi.name : menu_item_id, 'Đơn giá': mi ? vnd(mi.price) : '—', 'Số lượng trước': before, 'Số lượng sau': next, 'Lần chơi': segment } });
  }
  res.json(await fetchTable(id));
});
router.post('/api/tables/:id/close', async (req, res) => {
  const [[t]] = await pool.query('SELECT * FROM billiard_tables WHERE id=?', [req.params.id]);
  // Chụp lại toàn bộ tình trạng bàn TRƯỚC khi xoá để lịch sử huỷ bàn còn đầy đủ (ai huỷ, đang có bao nhiêu tiền, món gì)
  if (t && t.busy) {
    const snap = await billSnapshot(t);
    await logAudit(req, { category: 'table', action: 'cancel', entity_id: t.id, entity_label: tableName(t),
      description: `HUỶ ${tableName(t)} (không thanh toán) — tạm tính ${vnd(snap.total)}`,
      details: { 'Mở lúc': new Date(t.start_time).toLocaleString('vi-VN'), 'Hạng giá': `${t.rate_name} (${vnd(t.rate_per_hour)}/giờ)`,
        'Số khách': t.guests, 'Số lần đã cắt': snap.cuts, 'Món đã gọi': snap.items || '—',
        'Ghi chú bàn': t.note || '—', 'Tạm tính bị huỷ': vnd(snap.total),
        'Tổng thời gian tạm dừng': totalPausedSec(t) > 0 ? fmtDuration(totalPausedSec(t)) : '—',
        'Đang tạm dừng lúc huỷ': t.paused ? 'Có' : 'Không' } });
  }
  await resetTable(req.params.id);
  res.json(await fetchTable(req.params.id));
});

/* ---- Cắt bàn: chốt lần chơi hiện tại, bắt đầu tính lại từ đầu, bàn vẫn tiếp tục mở ---- */
router.post('/api/tables/:id/cut', async (req, res) => {
  const id = req.params.id;
  const [[t]] = await pool.query('SELECT * FROM billiard_tables WHERE id=?', [id]);
  if (!t || !t.busy) return res.status(400).json({ error: 'Bàn không ở trạng thái đang phục vụ.' });

  const { timeAmount, drinksAmount } = await computeCurrentSegmentAmounts(t);
  const items = await currentSegmentItemsLabel(id, t.current_segment);

  await pool.query(
    `INSERT INTO table_segments (table_id, segment_no, start_time, end_time, time_amount, drinks_amount, items)
     VALUES (?,?,?,COALESCE(?, NOW()),?,?,?)`,
    [id, t.current_segment, t.segment_start_time, t.paused ? t.paused_at : null, timeAmount, drinksAmount, items]
  );
  // Nếu đang tạm dừng thì lần chơi mới cũng "đứng" tại paused_at (đồng hồ = 0), tiếp tục sẽ chạy từ đó
  await pool.query(
    'UPDATE billiard_tables SET current_segment = current_segment + 1, segment_start_time = COALESCE(paused_at, NOW()) WHERE id=?',
    [id]
  );
  await logAudit(req, { category: 'table', action: 'cut', entity_id: t.id, entity_label: tableName(t),
    description: `Cắt ${tableName(t)} — chốt Lần ${t.current_segment}: ${vnd(timeAmount + drinksAmount)}`,
    details: { 'Lần chốt': t.current_segment, 'Tiền giờ': vnd(timeAmount), 'Tiền đồ uống': vnd(drinksAmount), 'Món': items || '—',
      'Bàn đang tạm dừng': t.paused ? 'Có' : 'Không' } });
  res.json(await fetchTable(id));
});

/* ---- Thêm giờ: cộng thêm thời gian cho lần chơi hiện tại (VD nhân viên quên bấm mở bàn) ---- */
router.put('/api/tables/:id/extra-time', async (req, res) => {
  const minutes = parseInt(req.body.minutes) || 0;
  if (minutes <= 0) return res.status(400).json({ error: 'Nhập số phút hợp lệ (lớn hơn 0).' });
  const [[t]] = await pool.query('SELECT id, label, busy, segment_start_time FROM billiard_tables WHERE id=?', [req.params.id]);
  if (!t || !t.busy) return res.status(400).json({ error: 'Bàn không ở trạng thái đang phục vụ.' });
  await pool.query(
    `UPDATE billiard_tables
     SET start_time = DATE_SUB(start_time, INTERVAL ? MINUTE),
         segment_start_time = DATE_SUB(segment_start_time, INTERVAL ? MINUTE)
     WHERE id=?`,
    [minutes, minutes, req.params.id]
  );
  await logAudit(req, { category: 'table', action: 'extra_time', entity_id: t.id, entity_label: tableName(t),
    description: `Thêm giờ ${tableName(t)}: +${minutes} phút (lùi đồng hồ tính tiền)`,
    details: { 'Số phút cộng thêm': minutes, 'Giờ bắt đầu lần chơi (trước)': new Date(t.segment_start_time).toLocaleString('vi-VN'),
      'Giờ bắt đầu lần chơi (sau)': new Date(new Date(t.segment_start_time).getTime() - minutes * 60000).toLocaleString('vi-VN') } });
  res.json(await fetchTable(req.params.id));
});

/* ---- Tạm dừng / Tiếp tục: dừng đồng hồ + dừng cộng tiền giờ; khoảng tạm dừng KHÔNG bị tính tiền ---- */
router.post('/api/tables/:id/pause', async (req, res) => {
  const id = req.params.id;
  const [[t]] = await pool.query('SELECT * FROM billiard_tables WHERE id=?', [id]);
  if (!t || !t.busy) return res.status(400).json({ error: 'Bàn không ở trạng thái đang phục vụ.' });
  if (t.paused) return res.status(400).json({ error: 'Bàn này đã đang tạm dừng rồi.' });

  // Điều kiện paused=0 trong WHERE để bấm 2 lần liên tiếp không ghi trùng
  const [r] = await pool.query('UPDATE billiard_tables SET paused=1, paused_at=NOW() WHERE id=? AND busy=1 AND paused=0', [id]);
  if (!r.affectedRows) return res.status(400).json({ error: 'Bàn này đã đang tạm dừng rồi.' });

  const [[after]] = await pool.query('SELECT * FROM billiard_tables WHERE id=?', [id]);
  const snap = await billSnapshot(after); // tính tại paused_at → số tiền đúng lúc dừng
  const playedSec = (new Date(after.paused_at).getTime() - new Date(after.segment_start_time).getTime()) / 1000;
  await logAudit(req, { category: 'table', action: 'pause', entity_id: t.id, entity_label: tableName(t),
    description: `TẠM DỪNG ${tableName(t)} — tạm tính ${vnd(snap.total)}, đã dừng đồng hồ + tiền giờ`,
    details: { 'Tạm dừng lúc': new Date(after.paused_at).toLocaleString('vi-VN'),
      'Thời gian lần chơi hiện tại (đã chơi)': fmtDuration(playedSec), 'Lần chơi': t.current_segment,
      'Tạm tính lúc dừng': vnd(snap.total), 'Đã tạm dừng từ trước (cộng dồn)': fmtDuration(t.paused_total_sec || 0) } });
  res.json(await fetchTable(id));
});
router.post('/api/tables/:id/resume', async (req, res) => {
  const id = req.params.id;
  const [[t]] = await pool.query('SELECT * FROM billiard_tables WHERE id=?', [id]);
  if (!t || !t.busy) return res.status(400).json({ error: 'Bàn không ở trạng thái đang phục vụ.' });
  if (!t.paused || !t.paused_at) return res.status(400).json({ error: 'Bàn này không ở trạng thái tạm dừng.' });

  const [[{ sec }]] = await pool.query('SELECT TIMESTAMPDIFF(SECOND, paused_at, NOW()) AS sec FROM billiard_tables WHERE id=?', [id]);
  const pausedSec = Math.max(0, Number(sec) || 0);
  // Dời lùi các mốc giờ ĐÚNG bằng thời gian đã dừng → đồng hồ chạy tiếp từ chỗ đã dừng, bỏ qua thời gian tạm dừng
  const [r] = await pool.query(
    `UPDATE billiard_tables
     SET start_time = DATE_ADD(start_time, INTERVAL ? SECOND),
         segment_start_time = DATE_ADD(segment_start_time, INTERVAL ? SECOND),
         expected_end = IF(expected_end IS NULL, NULL, DATE_ADD(expected_end, INTERVAL ? SECOND)),
         paused_total_sec = paused_total_sec + ?,
         paused = 0, paused_at = NULL
     WHERE id=? AND busy=1 AND paused=1`,
    [pausedSec, pausedSec, pausedSec, pausedSec, id]
  );
  if (!r.affectedRows) return res.status(400).json({ error: 'Bàn này không ở trạng thái tạm dừng.' });

  const total = (t.paused_total_sec || 0) + pausedSec;
  await logAudit(req, { category: 'table', action: 'resume', entity_id: t.id, entity_label: tableName(t),
    description: `TIẾP TỤC ${tableName(t)} — đã tạm dừng ${fmtDuration(pausedSec)} (không tính tiền)`,
    details: { 'Tạm dừng lúc': new Date(t.paused_at).toLocaleString('vi-VN'), 'Tiếp tục lúc': new Date().toLocaleString('vi-VN'),
      'Thời gian đợt tạm dừng này (bỏ qua, không tính tiền)': fmtDuration(pausedSec),
      'Tổng thời gian đã tạm dừng của lượt chơi': fmtDuration(total), 'Lần chơi': t.current_segment } });
  res.json(await fetchTable(id));
});

/* ---- Thanh toán: chốt lần chơi cuối, gộp với các lần đã cắt trước đó thành hoá đơn ---- */
router.post('/api/tables/:id/pay', async (req, res) => {
  const id = req.params.id;
  const { method, employee_id } = req.body;
  if (!['cash', 'transfer'].includes(method)) return res.status(400).json({ error: 'Phương thức thanh toán không hợp lệ.' });
  const [[t]] = await pool.query('SELECT * FROM billiard_tables WHERE id=?', [id]);
  if (!t || !t.busy) return res.status(400).json({ error: 'Bàn không ở trạng thái đang phục vụ.' });

  const [pastSegments] = await pool.query(
    'SELECT segment_no, time_amount, drinks_amount, items FROM table_segments WHERE table_id=? ORDER BY segment_no', [id]
  );
  const { timeAmount: curTime, drinksAmount: curDrinks } = await computeCurrentSegmentAmounts(t);
  const curItems = await currentSegmentItemsLabel(id, t.current_segment);

  const segments = [
    ...pastSegments.map(s => ({
      segment_no: s.segment_no, time_amount: Number(s.time_amount), drinks_amount: Number(s.drinks_amount), items: s.items || ''
    })),
    { segment_no: t.current_segment, time_amount: curTime, drinks_amount: curDrinks, items: curItems },
  ];
  const amount = segments.reduce((s, seg) => s + seg.time_amount + seg.drinks_amount, 0);

  const [[emp]] = employee_id ? await pool.query('SELECT * FROM employees WHERE id=?', [employee_id]) : [[null]];

  const [r] = await pool.query(
    'INSERT INTO transactions (table_id, employee_id, employee_name, amount, method, note, segments_json) VALUES (?,?,?,?,?,?,?)',
    [id, emp ? emp.id : null, emp ? emp.name : null, amount, method, t.note || '', JSON.stringify(segments)]
  );

  // Gộp toàn bộ món đã gọi ở TẤT CẢ các lần chơi (mọi segment) để lưu vào transaction_items
  const [allOrders] = await pool.query(
    `SELECT m.name, m.price, SUM(o.qty) AS qty
     FROM table_orders o JOIN menu_items m ON m.id = o.menu_item_id
     WHERE o.table_id=? GROUP BY m.id, m.name, m.price`, [id]
  );
  for (const o of allOrders) {
    await pool.query('INSERT INTO transaction_items (transaction_id, item_name, price, qty) VALUES (?,?,?,?)',
      [r.insertId, o.name, o.price, o.qty]);
  }

  await logAudit(req, { category: 'transaction', action: 'pay', entity_id: r.insertId, entity_label: tableName(t),
    description: `Thanh toán ${tableName(t)}: ${vnd(amount)} (${method === 'cash' ? 'tiền mặt' : 'chuyển khoản'})${emp ? ' — NV ' + emp.name : ''}`,
    details: { 'Mã giao dịch': r.insertId, 'Số tiền': vnd(amount), 'Phương thức': method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản',
      'Nhân viên thu': emp ? emp.name : '—', 'Số lần chơi': segments.length,
      'Món đã bán': allOrders.map(o => `${o.name} x${o.qty}`).join(', ') || '—', 'Ghi chú bàn': t.note || '—',
      'Tổng thời gian tạm dừng (không tính tiền)': totalPausedSec(t) > 0 ? fmtDuration(totalPausedSec(t)) : '—' } });
  await resetTable(id);
  res.json({ transaction_id: r.insertId, amount, segments });
});

module.exports = router;
