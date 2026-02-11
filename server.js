// server.js — SL Score ハイブリッド版（API不要）
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const { ensureAdmin, authenticate, addUser, removeUser, changePassword, listUsers } = require('./users');
const { GUIDELINE_FULL } = require('./guideline');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_DEFAULT_PW = process.env.ADMIN_DEFAULT_PASSWORD || 'slscore2024';

const ESC_COEFFICIENTS = [0.60,0.60,1.25,1.25,0.80,0.80,1.15,1.35,1.25,1.60,1.25,1.50,1.60,1.00];
const ESC_TOTAL = 16.0;
const ITEM_NAMES = [
  'オープニングイメージ','セットアップ','インサイティング・インシデント',
  'ターニングポイント1','サブプロット','お楽しみ要素',
  'ピンチポイント1','ミッドポイント','ピンチポイント2',
  'すべてを失う','再起のきっかけ','ターニングポイント2',
  'クライマックス','結末'
];

app.set('trust proxy', 1);
app.use(express.json({ limit: '50mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 24*60*60*1000, httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}));

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
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '入力してください' });
  const user = authenticate(username, password);
  if (!user) return res.status(401).json({ error: 'ユーザー名またはパスワードが正しくありません' });
  req.session.user = user;
  res.json({ success: true, user: { username: user.username, displayName: user.displayName, role: user.role } });
});
app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });
app.get('/api/auth/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: '未ログイン' });
  res.json({ user: req.session.user });
});
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: '6文字以上' });
  res.json(changePassword(req.session.user.username, newPassword));
});

// === 管理者API ===
app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => res.json({ users: listUsers() }));
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
  res.json({ userCount: listUsers().length });
});

// === メインアプリ ===
app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public', 'app')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app', 'index.html')));

// ガイドライン取得
app.get('/api/guideline', (req, res) => res.json({ guideline: GUIDELINE_FULL }));

// プロンプト生成
app.post('/api/build-prompt', (req, res) => {
  const { phase, protagonist, genre, theme, symbols, keyCharacters, storyText, previousResult } = req.body;
  let prompt = '';

  if (phase === 1) {
    prompt = `あなたは物語構造分析の最高精度の専門家です。
以下の物語テキストを一行一行精読し、主人公「${protagonist}」の視点から構造要素を網羅的に抽出してください。

【重要な注意事項】
- 絶対に要約モードに入らないでください。個々のセリフや一文レベルの描写が構造的根拠になりえます。
- 「該当なし」と書く場合も、なぜ該当しないかの理由を必ず付記してください。
- 原文からの直接引用を各項目で最低1箇所は含めてください。

【作品メタ情報】
- 主人公／視点主：${protagonist}
- ジャンル：${genre || '未指定'}
- 主題の問い（仮説）：${theme || '未指定（抽出時に推定してください）'}
- 追跡すべき象徴・モチーフ：${symbols || '未指定（抽出時に発見してください）'}
- 主要キャラクター：${keyCharacters || '未指定'}

【各話について以下を必ず記入してください】

=== 第○話 ===
■ ${protagonist}の行動：（能動的か受動的かを明記）
■ ${protagonist}の内面変化：（心理描写・独白から読み取れる感情の動き）
■ ${protagonist}の選択（あれば）：（何を選び、何を選ばなかったか。不可逆性の有無）
■ 主要キャラとの関係性変化：（距離感の増減、信頼の変化）
■ 象徴・モチーフ出現：（出現箇所と文脈）
■ 構造ポイント候補：（SL Score 14項目のどれに該当しうるか。複数可）
  - 候補項目名：
  - 根拠となる原文引用：「」
  - 構造的理由：
■ 伏線の提示 or 回収：
■ サブプロットの進行：
■ 特記事項：

【物語テキスト】
${storyText}`;

  } else if (phase === 2) {
    prompt = `あなたはSL Score Ver.13.1Aに基づく構造評価の専門家です。
以下の全話構造抽出結果を精査し、14項目への対応付け（構造マッピング）を行ってください。

【重要な注意事項】
- 「派手なイベント」と「構造的転換点」を厳密に区別してください。
- TP1・TP2は必ず主人公の能動的選択でなければなりません。外的事件は不可。
- 候補が複数ある場合はすべて列挙した上で、最も構造的に強いものを選定してください。

【作品メタ情報】
- 主人公：${protagonist}
- ジャンル：${genre || '未指定'}
- 主題の問い：${theme || '未指定'}
- 象徴軸：${symbols || '未指定'}

【ガイドライン（14項目定義）】
${GUIDELINE_FULL}

【全話構造抽出結果（Phase 1の出力）】
${previousResult}

【出力形式】
各14項目について以下を記述：

=== [項目番号]. [項目名] ===
■ 該当話数：第○話
■ 該当場面の要約：（100字以内）
■ 根拠となる原文引用：「」
■ 構造的根拠：（なぜこの場面がこの項目に該当するか）
■ 前後の項目との因果接続：

=== 横断検証 ===
■ 因果チェーン検証
■ 象徴軸の一貫性
■ サブプロットの合流状況
■ 未回収の伏線
■ 構造上の特記事項`;

  } else if (phase === 3) {
    prompt = `あなたはSL Score Ver.13.1Aの公式採点官です。
以下の構造マッピング結果に基づき、14項目を厳密に採点してください。

【採点の鉄則】
1. 各項目の点数は、ガイドラインの「点数段階」に厳密に準拠すること
2. 採点理由には必ず原文引用を含めること（引用なき採点は無効）
3. 感情的印象ではなく、構造的機能のみを評価すること
4. 迷った場合は厳しい方の点数を採用すること

【作品メタ情報】
- 主人公：${protagonist}
- ジャンル：${genre || '未指定'}
- 主題の問い：${theme || '未指定'}
- 象徴軸：${symbols || '未指定'}

【ガイドライン】
${GUIDELINE_FULL}

【構造マッピング結果（Phase 2の出力）】
${previousResult}

【出力形式】
各14項目について以下のフォーマットで記述：

### [番号]. [項目名]：[点数（小数点第1位）]
**採点理由**：（200字以上。構造的根拠を明記）
**原文引用**：「」
**加点要素**：
**減点要素**：

---

### 型・ケース分類
**TP2型分類**：A型 / B型 / C型 / D型（理由を付記）
**Climax型分類**：A型 / B型 / C型 / D型（理由を付記）
**ケース分類**：Case A〜K（理由を付記）

### 構造上の強み（3点以上）
### 構造上の課題（1点以上）

### 三条件チェック表
| No. | 項目名 | 主題提示の成立 | 論理的因果構造 | 意味の責任実行・収束 |
|-----|--------|---------------|---------------|---------------------|
（14項目すべて記入）

### 採点一覧
| No. | 項目 | 点数 |
|-----|------|------|
| 01 | オープニングイメージ | |
| 02 | セットアップ | |
| 03 | インサイティング・インシデント | |
| 04 | ターニングポイント1 | |
| 05 | サブプロット | |
| 06 | お楽しみ要素 | |
| 07 | ピンチポイント1 | |
| 08 | ミッドポイント | |
| 09 | ピンチポイント2 | |
| 10 | すべてを失う | |
| 11 | 再起のきっかけ | |
| 12 | ターニングポイント2 | |
| 13 | クライマックス | |
| 14 | 結末 | |

**構成点（W1）平均：** /10`;

  } else if (phase === 4) {
    prompt = `あなたはSL Score Ver.13.1Aの品質監査官です。
以下の採点結果に対して、「見落とし」「誤認」「過大評価」「過小評価」の可能性を厳密に検証してください。

【検証の観点】
1. TP1と判定した箇所より前に、もっと構造的に強い選択場面がないか
2. Midpointと判定した箇所以外に、構造転換として機能している場面がないか
3. TP2と判定した箇所は本当に主人公の能動的選択か
4. Climaxにおけるデウス・エクス・マキナの見落としがないか
5. 点数が一律に高すぎる/低すぎる傾向がないか

【作品情報】
- 主人公：${protagonist}
- 主題の問い：${theme || '未指定'}
- 象徴軸：${symbols || '未指定'}

【現在の採点結果（Phase 3の出力）】
${previousResult}

【出力形式】
■ 見落としの可能性：
■ 誤認の可能性：
■ 過大評価の可能性：
■ 過小評価の可能性：
■ 修正提案：
■ 検証後の確信度：（各項目 A/B/C）`;
  }

  res.json({ prompt, charCount: prompt.length });
});

// スコア計算
app.post('/api/calculate-scores', (req, res) => {
  const { scoringText } = req.body;
  if (!scoringText) return res.status(400).json({ error: 'テキストが空です' });

  const scores = [];
  for (let i = 1; i <= 14; i++) {
    const patterns = [
      new RegExp(`0?${i}[.．]\\s*${ITEM_NAMES[i-1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[：:]\\s*([0-9]+\\.?[0-9]*)`, 'i'),
      new RegExp(`\\|\\s*0?${i}\\s*\\|[^|]*\\|\\s*([0-9]+\\.?[0-9]*)\\s*\\|`),
      new RegExp(`${ITEM_NAMES[i-1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^0-9]*([0-9]+\\.[0-9])`)
    ];
    let found = false;
    for (const p of patterns) {
      const m = scoringText.match(p);
      if (m) { scores.push(parseFloat(m[1])); found = true; break; }
    }
    if (!found) scores.push(0);
  }

  const w1 = scores.reduce((a,b) => a+b, 0) / scores.length;
  const weighted = scores.map((s,i) => s * ESC_COEFFICIENTS[i]);
  const w2 = weighted.reduce((a,b) => a+b, 0) / ESC_TOTAL;
  const final = w1 * 10 * 0.7 + w2 * 10 * 0.3;

  res.json({
    scores, itemNames: ITEM_NAMES,
    w1: (w1*10).toFixed(1), w2: (w2*10).toFixed(1), final: final.toFixed(1),
    weighted: weighted.map(w => w.toFixed(2)),
    coefficients: ESC_COEFFICIENTS,
    hasZero: scores.some(s => s === 0)
  });
});

// === 起動 ===
ensureAdmin(ADMIN_DEFAULT_PW);
app.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════════════════╗`);
  console.log(`║  SL Score 構造分析ツール v3.0（ハイブリッド版）    ║`);
  console.log(`║  http://localhost:${PORT}                           ║`);
  console.log(`║  API不要！各自のAIでプロンプト実行               ║`);
  console.log(`║  初期管理者: admin / ${ADMIN_DEFAULT_PW}                    ║`);
  console.log(`╚═══════════════════════════════════════════════════╝\n`);
});
