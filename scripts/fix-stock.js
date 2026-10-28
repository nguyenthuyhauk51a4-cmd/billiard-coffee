// Đối chiếu & sửa lệch tồn kho.
// Quy tắc đúng:  Tồn = Tổng nhập − Tổng xuất − Số đang gọi trên bàn (chưa thanh toán).
// Nếu có thao tác làm tồn đổi mà không ghi sổ (VD: web cũ chưa có tính năng kho cùng ghi vào 1 database),
// tồn sẽ lệch khỏi công thức trên.
//
// Cách dùng:
//   npm run fix-stock              -> chỉ XEM các món đang lệch (không đổi gì)
//   npm run fix-stock -- apply     -> sửa tồn của các món lệch cho khớp sổ + ghi vào Lịch sử
require('dotenv').config();
const mysql = require('mysql2/promise');
const { getDbConfig, TZ_OFFSET } = require('../dbConfig');

async function main() {
  const apply = process.argv.slice(2).includes('apply');
  const conn = await mysql.createConnection(getDbConfig());
  await conn.query(`SET time_zone = '${TZ_OFFSET}'`);
  const [rows] = await conn.query(
    `SELECT i.id, i.name, i.qty,
            COALESCE((SELECT SUM(qty) FROM stock_in  WHERE item_id = i.id), 0) AS total_in,
            COALESCE((SELECT SUM(qty) FROM stock_out WHERE item_id = i.id), 0) AS total_out,
            COALESCE((SELECT SUM(o.qty) FROM table_orders o WHERE i.menu_item_id IS NOT NULL AND o.menu_item_id = i.menu_item_id), 0) AS on_tables
     FROM inventory_items i WHERE i.active = 1 ORDER BY i.name`);
  let bad = 0;
  for (const r of rows) {
    const expected = Number(r.total_in) - Number(r.total_out) - Number(r.on_tables);
    const diff = Number(r.qty) - expected;
    if (diff === 0) { console.log(`✓ ${r.name}: tồn ${r.qty} (khớp)`); continue; }
    bad++;
    console.log(`⚠ ${r.name}: tồn đang là ${r.qty}, theo sổ phải là ${r.total_in} − ${r.total_out} − ${r.on_tables} = ${expected}  (lệch ${diff > 0 ? '+' : ''}${diff})`);
    if (apply) {
      await conn.query('UPDATE inventory_items SET qty=? WHERE id=?', [expected, r.id]);
      try {
        await conn.query(
          `INSERT INTO audit_logs (category, action, entity_id, entity_label, description, actor_name)
           VALUES ('inventory', 'fix_stock', ?, ?, ?, 'Hệ thống (script)')`,
          [r.id, r.name, `Cân lại tồn kho "${r.name}" theo sổ nhập/xuất: ${r.qty} → ${expected}`]);
      } catch (e) { /* bỏ qua nếu chưa có bảng lịch sử */ }
      console.log(`   → đã sửa tồn thành ${expected}`);
    }
  }
  if (!rows.length) console.log('Kho chưa có mặt hàng nào.');
  else if (!bad) console.log('\nTất cả khớp sổ.');
  else if (!apply) console.log(`\nCó ${bad} món lệch. Chạy:  npm run fix-stock -- apply  để sửa cho khớp.`);
  else console.log(`\nĐã sửa ${bad} món.`);
  await conn.end();
}
main().catch(e => { console.error('Lỗi:', e.message); process.exit(1); });
