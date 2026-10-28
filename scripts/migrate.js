// Tự cập nhật database (Tạm dừng bàn + Kho) mỗi lần chạy `npm start`.
// An toàn khi chạy lại nhiều lần: lỗi "đã có cột/bảng" được bỏ qua.
// Không bao giờ làm dừng việc khởi động web, dù kết nối lỗi.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { getDbConfig } = require('../dbConfig');

const IGNORE = ['ER_DUP_FIELDNAME', 'ER_TABLE_EXISTS_ERROR', 'ER_DUP_KEYNAME'];

function splitSql(text) {
  const noComments = text.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  return noComments.split(';').map(s => s.trim()).filter(Boolean);
}

async function main() {
  const file = path.join(__dirname, '..', 'CHAY_TREN_TIDB.sql');
  const statements = splitSql(fs.readFileSync(file, 'utf8'));
  const conn = await mysql.createConnection(getDbConfig());
  let done = 0, skipped = 0;
  try {
    for (const sql of statements) {
      try { await conn.query(sql); done++; }
      catch (e) {
        if (IGNORE.includes(e.code)) skipped++;
        else console.log('[migrate] Lỗi câu lệnh:', e.code, e.message, '\n   ', sql.slice(0, 80).replace(/\s+/g, ' '));
      }
    }
  } finally { await conn.end(); }
  console.log(`[migrate] Database đã cập nhật (mới: ${done}, đã có sẵn: ${skipped}).`);
}

main().catch(e => console.log('[migrate] Bỏ qua cập nhật database:', e.message));
