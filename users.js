// users.js — ユーザー管理（JSONファイルベース）
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const USERS_FILE = path.join(__dirname, 'data', 'users.json');

// dataディレクトリがなければ作成
function ensureDataDir() {
  const dir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ユーザー一覧を読み込み
function loadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, '[]', 'utf-8');
    return [];
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

// ユーザー一覧を保存
function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// 初期管理者アカウント作成（起動時に1回だけ）
function ensureAdmin(defaultPassword) {
  const users = loadUsers();
  if (!users.find(u => u.role === 'admin')) {
    const hash = bcrypt.hashSync(defaultPassword, 10);
    users.push({
      id: 'admin',
      username: 'admin',
      displayName: '管理者',
      password: hash,
      role: 'admin',
      createdAt: new Date().toISOString(),
      lastLogin: null
    });
    saveUsers(users);
    console.log(`[AUTH] 管理者アカウント作成済み (admin / ${defaultPassword})`);
    return true;
  }
  return false;
}

// ユーザー認証
function authenticate(username, password) {
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password)) return null;

  // lastLogin 更新
  user.lastLogin = new Date().toISOString();
  saveUsers(users);

  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
}

// ユーザー追加（管理者用）
function addUser(username, displayName, password, role = 'user') {
  const users = loadUsers();
  if (users.find(u => u.username === username)) {
    return { error: 'このユーザー名は既に使用されています' };
  }
  const hash = bcrypt.hashSync(password, 10);
  const newUser = {
    id: `user_${Date.now()}`,
    username,
    displayName: displayName || username,
    password: hash,
    role,
    createdAt: new Date().toISOString(),
    lastLogin: null
  };
  users.push(newUser);
  saveUsers(users);
  return { success: true, user: { id: newUser.id, username, displayName: newUser.displayName, role } };
}

// ユーザー削除（管理者用）
function removeUser(username) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) return { error: 'ユーザーが見つかりません' };
  if (users[idx].role === 'admin') return { error: '管理者アカウントは削除できません' };
  users.splice(idx, 1);
  saveUsers(users);
  return { success: true };
}

// パスワード変更
function changePassword(username, newPassword) {
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) return { error: 'ユーザーが見つかりません' };
  user.password = bcrypt.hashSync(newPassword, 10);
  saveUsers(users);
  return { success: true };
}

// ユーザー一覧取得（パスワード除外）
function listUsers() {
  return loadUsers().map(u => ({
    id: u.id, username: u.username, displayName: u.displayName,
    role: u.role, createdAt: u.createdAt, lastLogin: u.lastLogin
  }));
}

module.exports = { ensureAdmin, authenticate, addUser, removeUser, changePassword, listUsers };
