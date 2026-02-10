// server.js — Express サーバー（認証・セッション対応版）
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { runPipeline, splitIntoChunks, ITEM_NAMES, ESC_COEFFICIENTS } = require('./pipeline');
const { ensureAdmin, authenticate, addUser, removeUser, changePassword, listUsers } = require('./users');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_DEFAULT_PW = process.env.ADMIN_DEFAULT_PASSWORD || 'slscore2024';

function getApiKey() {
  return process.env.GROQ_API_KEY || null;
}

app.set('trust proxy', 1); // Render等のリバースプロキシ対応
app.use(express.json({ limit: '50mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' // HTTPS時のみsecure
  }
}));

// ログインページは認証不要
app.use('/login', express.static(path.join(__dirname, 'public', 'login')));

function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'ログインが必要です' });
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  return res.status(403).json({ error: '管理者権限が必要です' });
}

// === 認証API ===
app.get('/login', (req, res) => {
  if (req.session?.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login', 'index.html'));
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '入力してください' });
  const user = authenticate(username, password);
  if (!user) return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
  req.session.user = user;
  res.json({ success: true, user: { username: user.username, displayName: user.displayName, role: user.role } });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: '未ログイン' });
  res.json({ user: req.session.user, hasApiKey: !!getApiKey() });
});

app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '6文字以上' });
  res.json(changePassword(req.session.user.username, newPassword));
});

// === 管理者API ===
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ users: listUsers() });
});

app.post('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { username, displayName, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: '必須項目です' });
  if (password.length < 6) return res.status(400).json({ error: '6文字以上' });
  const result = addUser(username, displayName, password, role || 'user');
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/admin/users/:username', requireAuth, requireAdmin, (req, res) => {
  const result = removeUser(req.params.username);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/admin/users/:username/reset-password', requireAuth, requireAdmin, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '6文字以上' });
  res.json(changePassword(req.params.username, newPassword));
});

app.get('/api/admin/status', requireAuth, requireAdmin, (req, res) => {
  res.json({
    hasApiKey: !!getApiKey(),
    apiKeyPrefix: getApiKey() ? getApiKey().substring(0, 10) + '...' : null,
    userCount: listUsers().length
  });
});

// === メインアプリ（認証必須）===
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public', 'app')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'));
});

app.post('/api/preview-chunks', (req, res) => {
  const { storyText } = req.body;
  if (!storyText) return res.status(400).json({ error: 'テキストが空です' });
  const chunks = splitIntoChunks(storyText);
  res.json({ count: chunks.length, chunks: chunks.map(c => ({ label: c.label, charCount: c.text.length, preview: c.text.substring(0, 200) + '...' })) });
});

app.post('/api/analyze', (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) return res.status(500).json({ error: 'Groq APIキー未設定。管理者に連絡してください。' });

  const { model, protagonist, genre, theme, symbols, keyCharacters, storyText, skipVerification } = req.body;
  if (!storyText) return res.status(400).json({ error: 'テキストが空です' });
  if (!protagonist) return res.status(400).json({ error: '主人公名が必要です' });

  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  const sendEvent = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const user = req.session.user;
  console.log(`[ANALYZE] ${user.displayName}(${user.username}) 分析開始 主人公:${protagonist}`);

  runPipeline(
    { apiKey, model: model || 'llama-3.3-70b-versatile', protagonist, genre, theme, symbols, keyCharacters, storyText, skipVerification },
    (progress) => sendEvent({ type: 'progress', ...progress })
  ).then(results => {
    sendEvent({ type: 'result', results });
    sendEvent({ type: 'done' });
    res.end();
  }).catch(err => {
    sendEvent({ type: 'error', message: err.message });
    res.end();
  });
});

app.get('/api/meta', (req, res) => {
  res.json({ itemNames: ITEM_NAMES, escCoefficients: ESC_COEFFICIENTS });
});

// === 起動 ===
ensureAdmin(ADMIN_DEFAULT_PW);

app.listen(PORT, () => {
  const hasKey = !!getApiKey();
  console.log(`\n╔═══════════════════════════════════════════════════╗`);
  console.log(`║  SL Score 構造分析ツール v2.2（Groq API版）         ║`);
  console.log(`║  http://localhost:${PORT}                           ║`);
  console.log(`║                                                   ║`);
  console.log(`║  Groq APIキー: ${hasKey ? '✅ 設定済み' : '❌ 未設定（.envに追加）'}                   ║`);
  console.log(`║  初期管理者   : admin / ${ADMIN_DEFAULT_PW}                    ║`);
  console.log(`╚═══════════════════════════════════════════════════╝\n`);
});
