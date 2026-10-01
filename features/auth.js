const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { logAudit } = require('../utils/audit');

const router = express.Router();

/* ================= FRONT-END: giao diện nằm ở public/login.html ================= */
router.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'login.html')));

/* ================= BACK-END: API đăng nhập/đăng xuất/phiên ================= */
// KHÔNG có route đăng ký. Tài khoản chỉ được tạo bằng scripts/create-user.js (ghi thẳng vào SQL).

router.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Thiếu tài khoản hoặc mật khẩu.' });
  const [rows] = await pool.query('SELECT * FROM users WHERE username=? AND active=1', [username]);
  const user = rows[0];
  const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !ok) {
    await logAudit(req, { category: 'auth', action: 'login_failed', entity_label: username, actor: { username },
      description: `Đăng nhập SAI với tài khoản "${username}"` });
    return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' });
  }
  req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
  await logAudit(req, { category: 'auth', action: 'login', entity_label: user.username, description: `Đăng nhập: ${user.full_name || user.username}` });
  res.json({ user: req.session.user });
});

router.post('/api/logout', async (req, res) => {
  if (req.session.user) await logAudit(req, { category: 'auth', action: 'logout', entity_label: req.session.user.username,
    description: `Đăng xuất: ${req.session.user.full_name || req.session.user.username}` });
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/api/session', (req, res) => { res.json({ user: req.session.user || null }); });

module.exports = router;
