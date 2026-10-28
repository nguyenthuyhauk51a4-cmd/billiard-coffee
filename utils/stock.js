// Các hàm nhỏ dùng chung để cập nhật tồn kho khi gọi món / huỷ bàn / xoá món.
// Quy ước: món trên menu CÓ liên kết với hàng trong kho (inventory_items.menu_item_id) thì mới bị trừ kho.
// Món không liên kết (VD: món pha chế không đếm tồn) thì vẫn gọi tự do như trước.

// Trừ kho khi gọi thêm `qty` món. Dùng UPDATE có điều kiện (qty >= cần trừ) nên 2 máy bấm cùng lúc cũng không trừ âm.
async function reserve(conn, menuItemId, qty) {
  const [[inv]] = await conn.query('SELECT id, name, qty FROM inventory_items WHERE menu_item_id=? AND active=1', [menuItemId]);
  if (!inv) return { ok: true, tracked: false, left: null };
  const [r] = await conn.query('UPDATE inventory_items SET qty = qty - ? WHERE id=? AND qty >= ?', [qty, inv.id, qty]);
  if (!r.affectedRows) {
    const [[cur]] = await conn.query('SELECT qty FROM inventory_items WHERE id=?', [inv.id]);
    return { ok: false, tracked: true, name: inv.name, left: cur ? cur.qty : 0 };
  }
  const [[after]] = await conn.query('SELECT qty FROM inventory_items WHERE id=?', [inv.id]);
  return { ok: true, tracked: true, left: after.qty };
}

// Hoàn kho khi bớt món
async function release(conn, menuItemId, qty) {
  const [[inv]] = await conn.query('SELECT id FROM inventory_items WHERE menu_item_id=? AND active=1', [menuItemId]);
  if (!inv) return { tracked: false, left: null };
  await conn.query('UPDATE inventory_items SET qty = qty + ? WHERE id=?', [qty, inv.id]);
  const [[after]] = await conn.query('SELECT qty FROM inventory_items WHERE id=?', [inv.id]);
  return { tracked: true, left: after.qty };
}

// Hoàn kho toàn bộ món đang gọi trên 1 bàn (dùng khi HUỶ bàn)
async function releaseTable(conn, tableId) {
  await conn.query(
    `UPDATE inventory_items i
     JOIN (SELECT menu_item_id, SUM(qty) AS q FROM table_orders WHERE table_id=? GROUP BY menu_item_id) o
       ON o.menu_item_id = i.menu_item_id
     SET i.qty = i.qty + o.q
     WHERE i.active=1`, [tableId]);
}

// Hoàn kho các món đang gọi trên MỌI bàn của 1 món menu (dùng khi XOÁ món khỏi menu)
async function releaseMenuItem(conn, menuItemId) {
  await conn.query(
    `UPDATE inventory_items i
     JOIN (SELECT menu_item_id, SUM(qty) AS q FROM table_orders WHERE menu_item_id=? GROUP BY menu_item_id) o
       ON o.menu_item_id = i.menu_item_id
     SET i.qty = i.qty + o.q
     WHERE i.active=1`, [menuItemId]);
}

// Ghi vào "Xuất kho" các món khách đã mua (gọi khi THANH TOÁN, trước khi xoá order của bàn)
async function recordSaleOut(conn, { tableId, tableName, transactionId, actorName }) {
  await conn.query(
    `INSERT INTO stock_out (item_id, item_name, qty, unit_price, reason, transaction_id, table_name, actor_name)
     SELECT i.id, i.name, SUM(o.qty), m.price, 'sale', ?, ?, ?
     FROM table_orders o
     JOIN menu_items m ON m.id = o.menu_item_id
     JOIN inventory_items i ON i.menu_item_id = m.id AND i.active = 1
     WHERE o.table_id = ?
     GROUP BY i.id, i.name, m.price`,
    [transactionId, tableName, actorName, tableId]);
}

module.exports = { reserve, release, releaseTable, releaseMenuItem, recordSaleOut };
