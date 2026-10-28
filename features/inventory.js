// KHO: trang "Nhập kho" (nhapkho.html) + API nhập / xuất / tồn kho cho tab "Quản lý kho" trong trang Quản lý.
const express = require('express');
const path = require('path');
const pool = require('../db');
const bcrypt = require('bcryptjs');
const { requireAuthApi, requireAuthPage, requireAuditUnlocked, requireStockUnlocked } = require('../middleware/auth');
const { logAudit, vnd } = require('../utils/audit');

const router = express.Router();

/* ================= FRONT-END: giao diện nằm ở public/nhapkho.html ================= */
router.get('/nhapkho.html', requireAuthPage, (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'nhapkho.html')));

/* ================= BACK-END ================= */
/* ---- Mật khẩu trang Nhập kho: do chủ quán cấp bằng lệnh trên máy chủ (npm run set-stock-password), không có form tự đổi trên web ---- */
router.use('/api/stockpw', requireAuthApi);
async function getStockPasswordHash() {
  const [[row]] = await pool.query("SELECT value FROM settings WHERE `key`='stock_password_hash'");
  return row ? row.value : null;
}
router.get('/api/stockpw/status', async (req, res) => {
  res.json({ configured: !!(await getStockPasswordHash()), unlocked: !!req.session.stockUnlocked });
});
router.post('/api/stockpw/unlock', async (req, res) => {
  const { password } = req.body || {};
  const hash = await getStockPasswordHash();
  if (!hash) return res.status(400).json({ error: 'Chưa thiết lập mật khẩu Nhập kho. Nhờ chủ quán chạy: npm run set-stock-password -- "MatKhau..."' });
  const ok = password && await bcrypt.compare(String(password), hash);
  if (!ok) {
    await logAudit(req, { category: 'auth', action: 'stock_unlock_failed', description: 'Nhập SAI mật khẩu Nhập kho' });
    return res.status(400).json({ error: 'Sai mật khẩu Nhập kho.' });
  }
  req.session.stockUnlocked = true;
  await logAudit(req, { category: 'auth', action: 'stock_unlock', description: 'Mở khoá trang Nhập kho' });
  res.json({ ok: true });
});
router.post('/api/stockpw/lock', (req, res) => { req.session.stockUnlocked = false; res.json({ ok: true }); });

router.use('/api/stock', requireAuthApi);

const toInt = (v) => { const n = parseInt(v); return Number.isFinite(n) ? n : 0; };
const actorOf = (req) => { const u = req.session.user; return u ? (u.full_name || u.username || null) : null; };

// Dùng cho trang Nhập kho (cần mật khẩu Nhập kho): chỉ tên đồ + tồn + trạng thái menu, KHÔNG có giá vốn/tổng nhập xuất
router.get('/api/stock/names', requireStockUnlocked, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT i.id, i.name, i.qty, i.menu_item_id, m.price AS sell_price
     FROM inventory_items i LEFT JOIN menu_items m ON m.id = i.menu_item_id
     WHERE i.active = 1 ORDER BY i.name`);
  res.json(rows.map(r => ({ ...r, qty: Number(r.qty), sell_price: r.sell_price == null ? null : Number(r.sell_price) })));
});

// Các lần nhập gần đây (hiện ở trang Nhập kho, cần mật khẩu Nhập kho, không có giá)
router.get('/api/stock/recent', requireStockUnlocked, async (req, res) => {
  const [rows] = await pool.query('SELECT id, item_name, qty, note, actor_name, created_at FROM stock_in ORDER BY created_at DESC, id DESC LIMIT 30');
  res.json(rows);
});

// ---- Từ đây là phần "Quản lý kho" nằm trong Lịch sử: phải nhập mật khẩu Lịch sử mới dùng được ----
// Tồn kho: mỗi mặt hàng kèm tổng nhập / tổng xuất / số đang nằm trên bàn (chưa thanh toán)
router.get('/api/stock/items', requireAuditUnlocked, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT i.id, i.name, i.category, i.cost_price, i.qty, i.menu_item_id, i.created_at,
            m.name AS menu_name, m.price AS sell_price,
            COALESCE((SELECT SUM(qty) FROM stock_in  WHERE item_id = i.id), 0) AS total_in,
            COALESCE((SELECT SUM(qty) FROM stock_out WHERE item_id = i.id), 0) AS total_out,
            COALESCE((SELECT SUM(o.qty) FROM table_orders o WHERE i.menu_item_id IS NOT NULL AND o.menu_item_id = i.menu_item_id), 0) AS on_tables
     FROM inventory_items i LEFT JOIN menu_items m ON m.id = i.menu_item_id
     WHERE i.active = 1 ORDER BY i.category, i.name`);
  res.json(rows.map(r => ({
    ...r, cost_price: Number(r.cost_price), sell_price: r.sell_price == null ? null : Number(r.sell_price),
    qty: Number(r.qty), total_in: Number(r.total_in), total_out: Number(r.total_out), on_tables: Number(r.on_tables),
  })));
});

// Nhập kho: đồ đã có (trùng tên) thì cộng thêm; đồ mới thì tạo mới
router.post('/api/stock/in', requireStockUnlocked, async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 100);
  const category = String(req.body.category || '').trim().slice(0, 80);
  const qty = toInt(req.body.qty);
  const costGiven = req.body.cost_price !== undefined && req.body.cost_price !== null && req.body.cost_price !== '';
  let cost = Math.max(0, toInt(req.body.cost_price)); // không điền giá nhập -> giữ giá cũ của món (đồ mới = 0)
  const sell = Math.max(0, toInt(req.body.sell_price));
  const note = String(req.body.note || '').trim().slice(0, 255);
  if (!name) return res.status(400).json({ error: 'Nhập tên đồ.' });
  if (qty < 1 || qty > 1000000) return res.status(400).json({ error: 'Số lượng nhập phải từ 1 trở lên.' });

  const conn = await pool.getConnection();
  let inv, created = false, menuNote = '', stockInId;
  try {
    await conn.beginTransaction();
    [[inv]] = await conn.query('SELECT * FROM inventory_items WHERE LOWER(name)=LOWER(?) AND active=1 LIMIT 1', [name]);
    // Tìm/tạo món menu để liên kết: trùng tên mà chưa gắn kho -> tự liên kết; chưa có mà có điền giá bán -> tạo món menu mới
    const resolveMenu = async () => {
      const [[mi]] = await conn.query(
        `SELECT m.id, m.name FROM menu_items m LEFT JOIN inventory_items i ON i.menu_item_id = m.id AND i.active = 1
         WHERE LOWER(m.name) = LOWER(?) AND i.id IS NULL LIMIT 1`, [name]);
      if (mi) return { id: mi.id, name: mi.name, note: 'tự liên kết với món menu trùng tên' };
      if (sell > 0) {
        const [mr] = await conn.query('INSERT INTO menu_items (name, price) VALUES (?,?)', [name, sell]);
        return { id: mr.insertId, note: `đã tạo món mới trên menu giá ${vnd(sell)}` };
      }
      return { id: null, note: 'chưa lên menu' };
    };
    if (inv) {
      if (!costGiven) cost = Number(inv.cost_price) || 0;
      let menuId = inv.menu_item_id;
      if (menuId) menuNote = 'đã liên kết menu';
      else { const m = await resolveMenu(); menuId = m.id; menuNote = m.note; }
      await conn.query(
        `UPDATE inventory_items SET qty = qty + ?, cost_price = ?, category = IF(? <> '', ?, category), menu_item_id = ? WHERE id=?`,
        [qty, cost, category, category, menuId, inv.id]);
    } else {
      const m = await resolveMenu(); menuNote = m.note;
      const invName = m.name || name; // liên kết với món menu có sẵn thì dùng đúng tên món đó
      const [ir] = await conn.query(
        'INSERT INTO inventory_items (name, category, cost_price, qty, menu_item_id) VALUES (?,?,?,?,?)',
        [invName, category, cost, qty, m.id]);
      inv = { id: ir.insertId, name: invName, category, menu_item_id: m.id };
      created = true;
    }
    const [sr] = await conn.query(
      `INSERT INTO stock_in (item_id, item_name, category, qty, unit_cost, total_cost, note, actor_name)
       VALUES (?,?,?,?,?,?,?,?)`,
      [inv.id, inv.name, category || inv.category || '', qty, cost, qty * cost, note, actorOf(req)]);
    stockInId = sr.insertId;
    await conn.commit();
  } catch (e) {
    await conn.rollback(); throw e;
  } finally { conn.release(); }

  const [[after]] = await pool.query('SELECT id, name, category, qty, menu_item_id FROM inventory_items WHERE id=?', [inv.id]);
  await logAudit(req, { category: 'inventory', action: 'stock_in', entity_id: inv.id, entity_label: after.name,
    description: `Nhập kho: ${after.name} x${qty} → tồn ${after.qty}`,
    details: { 'Tên đồ': after.name, 'Số lượng nhập': qty, 'Tồn sau khi nhập': after.qty, 'Đồ mới': created ? 'có' : 'không', 'Menu': menuNote,
      'Ghi chú': note || '—', 'Mã phiếu nhập': stockInId } });
  res.json({ ok: true, created, menu: menuNote, item: after });
});

function dateFilter(query, params, where) {
  if (query.from) { where.push('DATE(created_at)>=?'); params.push(query.from); }
  if (query.to) { where.push('DATE(created_at)<=?'); params.push(query.to); }
  if (query.q) { where.push('(item_name LIKE ?)'); params.push('%' + String(query.q).trim() + '%'); }
}

// Lịch sử nhập kho
router.get('/api/stock/in', requireAuditUnlocked, async (req, res) => {
  const where = ['1=1'], params = [];
  dateFilter(req.query, params, where);
  const limit = Math.min(1000, Math.max(1, toInt(req.query.limit) || 500));
  const [rows] = await pool.query(
    `SELECT * FROM stock_in WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ${limit}`, params);
  res.json(rows.map(r => ({ ...r, unit_cost: Number(r.unit_cost), total_cost: Number(r.total_cost) })));
});

// Lịch sử xuất kho (reason: sale = khách mua, manual = xuất tay)
router.get('/api/stock/out', requireAuditUnlocked, async (req, res) => {
  const where = ['1=1'], params = [];
  dateFilter(req.query, params, where);
  if (['sale', 'manual'].includes(req.query.reason)) { where.push('reason=?'); params.push(req.query.reason); }
  const limit = Math.min(1000, Math.max(1, toInt(req.query.limit) || 500));
  const [rows] = await pool.query(
    `SELECT * FROM stock_out WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ${limit}`, params);
  res.json(rows.map(r => ({ ...r, unit_price: Number(r.unit_price) })));
});

// SỬA / XOÁ phiếu nhập: chỉ làm được ở trang Nhập kho (cần mật khẩu Nhập kho). Quản lý kho trong Lịch sử chỉ để XEM.
// SỬA 1 lần nhập kho đã ghi: đổi tên đồ (gõ nhầm), số lượng, ghi chú.
// Tồn kho tự cộng/trừ phần chênh lệch số lượng; không cho sửa nếu làm tồn kho bị âm.
router.put('/api/stock/in/:id', requireStockUnlocked, async (req, res) => {
  const id = toInt(req.params.id);
  const qty = toInt(req.body.qty);
  const note = String(req.body.note || '').trim().slice(0, 255);
  const newName = String(req.body.name || '').trim().slice(0, 100);
  if (qty < 1 || qty > 1000000) return res.status(400).json({ error: 'Số lượng nhập phải từ 1 trở lên.' });
  const conn = await pool.getConnection();
  let row, delta = 0, after = null, renamed = false;
  try {
    await conn.beginTransaction();
    [[row]] = await conn.query('SELECT * FROM stock_in WHERE id=? FOR UPDATE', [id]);
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Không tìm thấy phiếu nhập.' }); }
    const name = newName || row.item_name;
    delta = qty - Number(row.qty);
    let liveItem = null;
    if (row.item_id) [[liveItem]] = await conn.query('SELECT id FROM inventory_items WHERE id=? AND active=1 FOR UPDATE', [row.item_id]);
    if (name !== row.item_name) {
      if (liveItem) {
        const [[dup]] = await conn.query('SELECT id FROM inventory_items WHERE LOWER(name)=LOWER(?) AND active=1 AND id<>?', [name, row.item_id]);
        if (dup) { await conn.rollback(); return res.status(400).json({ error: `Đã có đồ tên "${name}" trong kho.` }); }
        await conn.query('UPDATE inventory_items SET name=? WHERE id=?', [name, row.item_id]);
        await conn.query('UPDATE stock_in SET item_name=? WHERE item_id=?', [name, row.item_id]);
        await conn.query('UPDATE stock_out SET item_name=? WHERE item_id=?', [name, row.item_id]);
      } else {
        await conn.query('UPDATE stock_in SET item_name=? WHERE id=?', [name, id]);
      }
      renamed = true;
    }
    if (delta !== 0 && liveItem) {
      const [r] = await conn.query('UPDATE inventory_items SET qty = qty + ? WHERE id=? AND qty + ? >= 0', [delta, row.item_id, delta]);
      if (!r.affectedRows) {
        await conn.rollback();
        return res.status(400).json({ error: 'Không sửa được: số đã nhập này đã bán/xuất bớt, sửa xuống sẽ làm tồn kho bị âm.' });
      }
    }
    if (liveItem) [[after]] = await conn.query('SELECT qty FROM inventory_items WHERE id=?', [row.item_id]);
    await conn.query('UPDATE stock_in SET qty=?, total_cost=?, note=? WHERE id=?', [qty, qty * Number(row.unit_cost), note, id]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  if (delta !== 0 || renamed || note !== (row.note || '')) {
    const name = newName || row.item_name;
    await logAudit(req, { category: 'inventory', action: 'edit_stock_in', entity_id: row.item_id, entity_label: name,
      description: `Sửa phiếu nhập #${id}: ${renamed ? `"${row.item_name}" → "${name}", ` : ''}${name} SL ${row.qty} → ${qty}${after ? ` (tồn kho còn ${after.qty})` : ''}`,
      details: { 'Mã phiếu nhập': id, 'Tên cũ': row.item_name, 'Tên mới': name, 'SL cũ': row.qty, 'SL mới': qty, 'Ghi chú cũ': row.note || '—', 'Ghi chú mới': note || '—', ...(after ? { 'Tồn sau khi sửa': after.qty } : {}) } });
  }
  res.json({ ok: true });
});

// XOÁ 1 phiếu nhập (nhập nhầm): tồn kho bị trừ lại đúng số đã nhập; không cho xoá nếu làm tồn kho âm.
// Nếu đó là phiếu nhập duy nhất của món (chưa bán/xuất lần nào, không nằm trên bàn) thì món cũng được gỡ khỏi danh sách kho.
router.delete('/api/stock/in/:id', requireStockUnlocked, async (req, res) => {
  const id = toInt(req.params.id);
  const conn = await pool.getConnection();
  let row, removedItem = false, after = null;
  try {
    await conn.beginTransaction();
    [[row]] = await conn.query('SELECT * FROM stock_in WHERE id=? FOR UPDATE', [id]);
    if (!row) { await conn.rollback(); return res.status(404).json({ error: 'Không tìm thấy phiếu nhập.' }); }
    let inv = null;
    if (row.item_id) [[inv]] = await conn.query('SELECT * FROM inventory_items WHERE id=? AND active=1 FOR UPDATE', [row.item_id]);
    if (inv) {
      const [r] = await conn.query('UPDATE inventory_items SET qty = qty - ? WHERE id=? AND qty - ? >= 0', [row.qty, inv.id, row.qty]);
      if (!r.affectedRows) {
        await conn.rollback();
        return res.status(400).json({ error: `Không xoá được: số hàng này đã bán/xuất bớt (kho chỉ còn ${inv.qty}, phiếu nhập ${row.qty}).` });
      }
    }
    await conn.query('DELETE FROM stock_in WHERE id=?', [id]);
    if (inv) {
      const [[c]] = await conn.query(
        `SELECT (SELECT COUNT(*) FROM stock_in WHERE item_id=?) AS ins, (SELECT COUNT(*) FROM stock_out WHERE item_id=?) AS outs,
                (SELECT COALESCE(SUM(qty),0) FROM table_orders WHERE menu_item_id=?) AS ord`, [inv.id, inv.id, inv.menu_item_id || 0]);
      [[after]] = await conn.query('SELECT qty FROM inventory_items WHERE id=?', [inv.id]);
      if (Number(c.ins) === 0 && Number(c.outs) === 0 && Number(c.ord) === 0 && Number(after.qty) === 0) {
        await conn.query('UPDATE inventory_items SET active=0, menu_item_id=NULL WHERE id=?', [inv.id]);
        removedItem = true;
      }
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  await logAudit(req, { category: 'inventory', action: 'delete_stock_in', entity_id: row.item_id, entity_label: row.item_name,
    description: `Xoá phiếu nhập #${id}: ${row.item_name} x${row.qty}${after ? ` → tồn ${after.qty}` : ''}${removedItem ? ' (món cũng được gỡ khỏi kho)' : ''}`,
    details: { 'Mã phiếu nhập': id, 'Tên đồ': row.item_name, 'Số lượng đã nhập': row.qty, 'Ghi chú': row.note || '—',
      'Tồn sau khi xoá': after ? after.qty : '—', 'Gỡ món khỏi kho': removedItem ? 'có' : 'không' } });
  res.json({ ok: true, removedItem });
});

module.exports = router;
