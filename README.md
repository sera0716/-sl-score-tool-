# SL Score 構造分析ツール v2.1

**Structural Logical Score Ver.13.1A** 準拠の物語構造自動採点ツール。  
Google Gemini API（無料・クレカ不要）で動作。ログイン機能付きでチームで共有可能。

## クイックスタート（3ステップ）

```bash
# 1. 依存パッケージをインストール
npm install

# 2. 設定ファイルを作成してAPIキーを貼り付け
cp .env.example .env
# .env を開いて GEMINI_API_KEY= の行にキーを貼り付け
# キーは https://aistudio.google.com/apikey で無料取得

# 3. 起動
npm start
```

ブラウザで `http://localhost:3000` → 初期管理者 **admin / slscore2024** でログイン

## 運用の流れ

### 管理者（あなた）
1. `.env` に Gemini APIキーを設定して起動
2. `admin / slscore2024` でログイン → 右上「管理」からパスワード変更
3. 「管理」画面でメンバーのアカウントを作成

### 利用者（メンバー）
1. URLとアカウント情報を受け取る
2. ログインして「作品情報」「テキスト」を入力 →「分析開始」
3. 結果をMarkdownでダウンロードまたはコピー

## 機能一覧

| 機能 | 説明 |
|------|------|
| ログイン認証 | セッションベース。APIキー入力不要 |
| ユーザー管理 | 管理者が作成・削除。パスワードリセット可 |
| 4段階パイプライン | 分割精読 → 構造マッピング → 採点 → 逆方向検証 |
| ガイドライン内蔵 | Ver.13.1A 全文がプロンプトに自動組み込み |
| リアルタイム進行表示 | SSEで各フェーズの進捗をライブ表示 |
| 結果エクスポート | Markdown保存・クリップボードコピー |

## ファイル構成

```
sl-score-tool/
├── server.js          # Expressサーバー（認証・SSE）
├── pipeline.js        # 4段階分析パイプライン
├── prompts.js         # 全フェーズのプロンプトテンプレート
├── guideline.js       # ガイドライン全文（内蔵）
├── users.js           # ユーザー管理（JSONファイルベース）
├── .env.example       # 設定テンプレート
├── data/
│   └── users.json     # ユーザーデータ（自動生成）
└── public/
    ├── login/         # ログインページ（認証不要）
    └── app/           # メインアプリ（認証必須）
```

## 外部公開する場合

ローカルネットワーク外に公開する場合は以下を推奨：

1. **HTTPS化**：nginxやcaddyでリバースプロキシ＋SSL
2. **SESSION_SECRET固定**：`.env` に固定値を設定（再起動でログアウトしなくなる）
3. **ADMIN_DEFAULT_PASSWORD変更**：初回起動前に `.env` で変更
4. **レート制限**：express-rate-limit 等の導入を検討

## API コスト

**Gemini APIは無料枠で利用可能**（クレジットカード不要）

| モデル | 特徴 | 無料枠 |
|--------|------|--------|
| Gemini 2.0 Flash | 高速・推奨 | 15 RPM / 100万トークン/分 |
| Gemini 2.5 Flash Preview | 高精度 | 10 RPM |
| Gemini 1.5 Pro | 大容量コンテキスト | 2 RPM |

※ レート制限対策のため、チャンク間に自動で待機時間を入れています

## カスタマイズ

- プロンプト調整 → `prompts.js`（特にPhase 1の抽出テンプレートが精度の要）
- ガイドライン更新 → `guideline.js`
- UI変更 → `public/app/` 配下のHTML/CSS/JS
