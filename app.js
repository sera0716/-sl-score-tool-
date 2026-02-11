// app.js — SL Score v3.0 ハイブリッド版 クライアント

const ITEM_NAMES = [
  'オープニングイメージ','セットアップ','インサイティング・インシデント',
  'ターニングポイント1','サブプロット','お楽しみ要素',
  'ピンチポイント1','ミッドポイント','ピンチポイント2',
  'すべてを失う','再起のきっかけ','ターニングポイント2',
  'クライマックス','結末'
];
const ESC_COEFFICIENTS = [0.60,0.60,1.25,1.25,0.80,0.80,1.15,1.35,1.25,1.60,1.25,1.50,1.60,1.00];

let currentStep = 0;
let storyMeta = {};
let phaseResults = {};

// === Auth ===
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login'; return; }
    const data = await res.json();
    document.getElementById('userName').textContent = data.user.displayName || data.user.username;
  } catch { window.location.href = '/login'; }
}
async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

// === Step Navigation ===
function goStep(n) {
  if (n > currentStep + 1) return; // can't skip ahead
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.step-tab').forEach(t => t.classList.remove('active'));
  document.getElementById(`panel-${n}`).classList.add('active');
  document.querySelector(`.step-tab[data-step="${n}"]`).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function markDone(n) {
  const tab = document.querySelector(`.step-tab[data-step="${n}"]`);
  if (tab) tab.classList.add('done');
  if (n >= currentStep) currentStep = n + 1;
}

// === Utilities ===
function showToast(msg) {
  const t = document.getElementById('copyToast');
  t.textContent = msg || 'クリップボードにコピーしました';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

function copyPrompt(id) {
  const el = document.getElementById(id);
  navigator.clipboard.writeText(el.textContent).then(() => showToast());
}

function toggleCollapse(id) {
  document.getElementById(id).classList.toggle('collapsed');
}

// === Step 0: Start ===
function startAnalysis() {
  const protagonist = document.getElementById('protagonist').value.trim();
  const storyText = document.getElementById('storyText').value.trim();
  if (!protagonist) return alert('主人公名を入力してください');
  if (!storyText) return alert('物語テキストを入力してください');

  storyMeta = {
    protagonist,
    genre: document.getElementById('genre').value.trim(),
    theme: document.getElementById('theme').value.trim(),
    symbols: document.getElementById('symbols').value.trim(),
    keyCharacters: document.getElementById('keyCharacters').value.trim(),
    storyText
  };

  generatePrompt(1);
}

// === Prompt Generation ===
async function generatePrompt(phase, previousResult) {
  const body = { phase, ...storyMeta };
  if (previousResult) body.previousResult = previousResult;

  try {
    const res = await fetch('/api/build-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    const promptEl = document.getElementById(`p${phase}Prompt`);
    const countEl = document.getElementById(`p${phase}CharCount`);
    promptEl.textContent = data.prompt;
    countEl.textContent = data.charCount.toLocaleString();

    if (phase === 1) { markDone(0); goStep(1); }
    else if (phase === 2) { markDone(1); goStep(2); }
    else if (phase === 3) { markDone(2); goStep(3); }
    else if (phase === 4) {
      document.getElementById('phase4Section').style.display = 'block';
      document.getElementById('phase4Section').scrollIntoView({ behavior: 'smooth' });
    }
  } catch (e) {
    alert('プロンプト生成エラー: ' + e.message);
  }
}

// === Phase transitions ===
function nextPhase(currentPhase) {
  const response = document.getElementById(`p${currentPhase}Response`).value.trim();
  if (!response) return alert('AIの回答を貼り付けてください');
  if (response.length < 100) return alert('回答が短すぎます。AIの出力全文を貼り付けてください。');

  phaseResults[currentPhase] = response;
  generatePrompt(currentPhase + 1, response);
}

// === Score Calculation ===
async function calculateScores() {
  const scoringText = document.getElementById('p3Response').value.trim();
  if (!scoringText) return alert('Phase 3の回答を貼り付けてください');

  phaseResults[3] = scoringText;

  try {
    const res = await fetch('/api/calculate-scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scoringText })
    });
    const data = await res.json();

    renderScores(data);
    markDone(3);
    goStep(4);
  } catch (e) {
    alert('スコア算出エラー: ' + e.message);
  }
}

function renderScores(data) {
  const { scores, w1, w2, final: finalScore, weighted, coefficients, hasZero } = data;

  // Auto-parse message
  const msgEl = document.getElementById('autoParseMsg');
  if (hasZero) {
    msgEl.innerHTML = `<div class="instruction" style="border-left-color: var(--warn);">
      ⚠️ 一部の項目でスコアが自動検出できませんでした（0点の項目）。<br>
      下の表で手動修正して「再計算」ボタンを押してください。
    </div>`;
  } else {
    msgEl.innerHTML = `<div class="instruction" style="border-left-color: var(--success);">
      ✅ 14項目すべてのスコアを自動検出しました。
    </div>`;
  }

  // Score table
  const tbody = document.getElementById('scoreBody');
  tbody.innerHTML = '';
  scores.forEach((s, i) => {
    const cls = s >= 8.5 ? 'score-high' : s >= 7.0 ? 'score-mid' : 'score-low';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${String(i+1).padStart(2,'0')}</td>
      <td>${ITEM_NAMES[i]}</td>
      <td class="score-cell"><input type="number" class="score-input" min="0" max="10" step="0.1" value="${s}" data-idx="${i}"></td>
      <td style="text-align:center; color:var(--text2);">×${coefficients[i].toFixed(2)}</td>
      <td class="score-cell ${cls}">${weighted[i]}</td>
    `;
    tbody.appendChild(tr);
  });

  // Add recalculate row
  const recalcRow = document.createElement('tr');
  recalcRow.innerHTML = `<td colspan="5" style="text-align:center; padding-top:12px;">
    <button class="btn btn-secondary" onclick="recalculate()">🔄 手動修正後に再計算</button>
  </td>`;
  tbody.appendChild(recalcRow);

  // Final scores
  const color = parseFloat(finalScore) >= 85 ? 'var(--success)' : parseFloat(finalScore) >= 70 ? 'var(--warn)' : 'var(--danger)';
  document.getElementById('finalScore').textContent = finalScore + '点';
  document.getElementById('finalScore').style.color = color;
  document.getElementById('w1Score').textContent = w1 + '点';
  document.getElementById('w2Score').textContent = w2 + '点';
}

function recalculate() {
  const inputs = document.querySelectorAll('.score-input');
  const scores = [];
  inputs.forEach(inp => scores.push(parseFloat(inp.value) || 0));

  const w1 = scores.reduce((a,b) => a+b, 0) / 14;
  const weighted = scores.map((s,i) => s * ESC_COEFFICIENTS[i]);
  const escTotal = 16.0;
  const w2 = weighted.reduce((a,b) => a+b, 0) / escTotal;
  const final = w1 * 10 * 0.7 + w2 * 10 * 0.3;

  renderScores({
    scores, w1: (w1*10).toFixed(1), w2: (w2*10).toFixed(1),
    final: final.toFixed(1), weighted: weighted.map(w => w.toFixed(2)),
    coefficients: ESC_COEFFICIENTS, hasZero: scores.some(s => s === 0)
  });
  showToast('再計算しました');
}

// === Phase 4 ===
function generatePhase4() {
  if (!phaseResults[3]) return alert('Phase 3の結果がありません');
  generatePrompt(4, phaseResults[3]);
}

// === Export ===
function exportReport() {
  const scores = [];
  document.querySelectorAll('.score-input').forEach(inp => scores.push(parseFloat(inp.value) || 0));
  const w1val = scores.reduce((a,b) => a+b, 0) / 14;
  const weighted = scores.map((s,i) => s * ESC_COEFFICIENTS[i]);
  const w2val = weighted.reduce((a,b) => a+b, 0) / 16.0;
  const finalVal = w1val * 10 * 0.7 + w2val * 10 * 0.3;

  let md = `# Structural Logical Score（構造論理点）採点結果\n`;
  md += `## ガイドライン Ver.13.1A 準拠\n\n---\n\n`;
  md += `## 評価前提\n\n`;
  md += `- **主人公／視点主**：${storyMeta.protagonist}\n`;
  if (storyMeta.genre) md += `- **ジャンル**：${storyMeta.genre}\n`;
  if (storyMeta.theme) md += `- **主題の問い**：${storyMeta.theme}\n`;
  if (storyMeta.symbols) md += `- **構造の対比軸**：${storyMeta.symbols}\n`;
  md += `\n---\n\n`;

  md += `## 採点一覧\n\n`;
  md += `| No. | 項目 | 点数 |\n|-----|------|------|\n`;
  scores.forEach((s, i) => {
    md += `| ${String(i+1).padStart(2,'0')} | ${ITEM_NAMES[i]} | ${s.toFixed(1)} |\n`;
  });
  md += `\n**構成点（W1）平均：${(w1val*10).toFixed(1)}点 / 100**\n\n`;

  md += `---\n\n## ESCスコア算出\n\n`;
  md += `| No. | 素点 | ESC係数 | 加重点 |\n|-----|------|---------|--------|\n`;
  scores.forEach((s, i) => {
    md += `| ${String(i+1).padStart(2,'0')} | ${s.toFixed(1)} | ${ESC_COEFFICIENTS[i].toFixed(2)} | ${weighted[i].toFixed(2)} |\n`;
  });
  md += `\n**ESC加重合計：${weighted.reduce((a,b)=>a+b,0).toFixed(2)}**\n`;
  md += `**ESCスコア（W2）：${(w2val*10).toFixed(1)}点**\n\n`;

  md += `---\n\n## 補正ESCスコア（最終合成）\n\n`;
  md += `**W1 × 0.7 ＋ W2 × 0.3 = ${(w1val*10*0.7).toFixed(2)} ＋ ${(w2val*10*0.3).toFixed(2)} = ${finalVal.toFixed(1)}点**\n\n`;

  if (phaseResults[3]) {
    md += `---\n\n## AIによる採点詳細（Phase 3出力）\n\n${phaseResults[3]}\n`;
  }

  md += `\n---\n*採点日：${new Date().toLocaleDateString('ja-JP')}*\n`;
  md += `*ツール：SL Score 構造分析ツール v3.0（ハイブリッド版）*\n`;

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SLScore_${storyMeta.protagonist}_${new Date().toISOString().slice(0,10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('レポートをダウンロードしました');
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  const ta = document.getElementById('storyText');
  ta.addEventListener('input', () => {
    document.getElementById('charCount').textContent = ta.value.length.toLocaleString();
  });
});
