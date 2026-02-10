// app.js — クライアントサイドロジック（認証対応版）

let analysisResults = null;
let timerInterval = null;
let startTime = null;
let currentUser = null;

// ページ読み込み時に認証チェック
(async function init() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.status === 401) { window.location.href = '/login'; return; }
    const data = await res.json();
    currentUser = data.user;
    document.getElementById('userDisplay').textContent = data.user.displayName;
    if (data.user.role === 'admin') {
      document.getElementById('btnAdmin').style.display = '';
    }
    if (!data.hasApiKey) {
      alert('⚠️ サーバーにGroq APIキーが設定されていません。管理者に連絡してください。');
    }
  } catch (e) {
    window.location.href = '/login';
  }
})();

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

// === 管理パネル ===
async function toggleAdmin() {
  const modal = document.getElementById('adminModal');
  if (modal.classList.contains('hidden')) {
    modal.classList.remove('hidden');
    await loadAdminData();
  } else {
    modal.classList.add('hidden');
  }
}

async function loadAdminData() {
  try {
    const [statusRes, usersRes] = await Promise.all([
      fetch('/api/admin/status'),
      fetch('/api/admin/users')
    ]);
    const status = await statusRes.json();
    const users = await usersRes.json();

    document.getElementById('adminStatus').innerHTML =
      `Groq APIキー: ${status.hasApiKey ? `✅ ${status.apiKeyPrefix}` : '❌ 未設定'}　|　登録ユーザー: ${status.userCount}人`;

    document.getElementById('userList').innerHTML = users.users.map(u => `
      <div class="user-row">
        <span class="name"><strong>${u.displayName}</strong> (${u.username})</span>
        <span class="role ${u.role}">${u.role}</span>
        <span class="meta">${u.lastLogin ? '最終: ' + new Date(u.lastLogin).toLocaleDateString('ja-JP') : '未ログイン'}</span>
        ${u.role !== 'admin' ? `<button class="btn btn-sm" onclick="deleteUser('${u.username}')">削除</button>` : ''}
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
  }
}

async function addNewUser() {
  const username = document.getElementById('newUsername').value.trim();
  const displayName = document.getElementById('newDisplayName').value.trim();
  const password = document.getElementById('newPassword').value;
  if (!username || !password) return alert('ユーザー名とパスワードは必須です');

  const res = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, displayName, password })
  });
  const data = await res.json();
  if (data.error) return alert(data.error);
  document.getElementById('newUsername').value = '';
  document.getElementById('newDisplayName').value = '';
  document.getElementById('newPassword').value = '';
  await loadAdminData();
}

async function deleteUser(username) {
  if (!confirm(`${username} を削除しますか？`)) return;
  const res = await fetch(`/api/admin/users/${username}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.error) return alert(data.error);
  await loadAdminData();
}

// 文字カウント
document.getElementById('storyText').addEventListener('input', (e) => {
  const count = e.target.value.length;
  document.getElementById('charCount').textContent =
    count >= 10000 ? `${(count / 10000).toFixed(1)}万文字` : `${count.toLocaleString()}文字`;
});

// 分割プレビュー
async function previewChunks() {
  const text = document.getElementById('storyText').value;
  if (!text) return alert('テキストを入力してください');

  const res = await fetch('/api/preview-chunks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storyText: text })
  });
  const data = await res.json();

  const container = document.getElementById('chunkPreview');
  container.classList.remove('hidden');
  container.innerHTML = `<p style="margin-bottom:8px;color:var(--accent);font-size:13px;">
    ${data.count}チャンクに分割されます（Phase 1で各チャンクを個別に精読）</p>` +
    data.chunks.map(c => `
      <div class="chunk-item">
        <span class="label">${c.label}</span>
        <span class="chars">${c.charCount.toLocaleString()}文字</span>
      </div>
    `).join('');
}

// タイマー
function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    document.getElementById('elapsedTime').textContent = `${m}:${s}`;
  }, 1000);
}
function stopTimer() { clearInterval(timerInterval); }

// ログ追加
function addLog(message, type = '') {
  const log = document.getElementById('logContent');
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  const time = new Date().toLocaleTimeString('ja-JP');
  line.textContent = `[${time}] ${message}`;
  log.appendChild(line);
  log.parentElement.scrollTop = log.parentElement.scrollHeight;
}

// 分析開始
async function startAnalysis() {
  const protagonist = document.getElementById('protagonist').value.trim();
  const storyText = document.getElementById('storyText').value.trim();

  if (!protagonist) return alert('主人公名を入力してください');
  if (!storyText) return alert('テキストを入力してください');

  const config = {
    model: document.getElementById('model').value,
    protagonist,
    genre: document.getElementById('genre').value.trim() || '未指定',
    theme: document.getElementById('theme').value.trim() || '（自動推定）',
    symbols: document.getElementById('symbols').value.trim() || '（自動検出）',
    keyCharacters: document.getElementById('keyCharacters').value.trim() || '（自動検出）',
    storyText,
    skipVerification: document.getElementById('skipVerification').checked
  };

  // UI更新
  document.getElementById('btnAnalyze').disabled = true;
  document.getElementById('panel-progress').classList.remove('hidden');
  document.getElementById('panel-results').classList.add('hidden');
  document.getElementById('logContent').innerHTML = '';
  resetPhases();
  startTimer();
  addLog('分析パイプラインを開始します', 'info');

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          handleSSEEvent(data);
        } catch (e) { /* skip parse errors */ }
      }
    }
  } catch (err) {
    addLog(`致命的エラー: ${err.message}`, 'error');
  } finally {
    stopTimer();
    document.getElementById('btnAnalyze').disabled = false;
  }
}

// SSEイベント処理
function handleSSEEvent(data) {
  if (data.type === 'progress') {
    const { phase, status, message, progress } = data;

    if (status === 'start') {
      setPhaseState(phase, 'active');
      addLog(message, 'info');
    } else if (status === 'complete') {
      setPhaseState(phase, 'complete');
      if (progress !== undefined) setProgress(phase, 100);
      addLog(message, 'success');
    } else if (status === 'error') {
      setPhaseState(phase, 'error');
      addLog(message, 'error');
    } else if (status === 'warning') {
      addLog(message, 'warning');
    } else if (status === 'progress') {
      if (progress !== undefined) setProgress(phase, progress);
      addLog(message);
    } else if (status === 'info') {
      addLog(message, 'info');
    } else if (status === 'done') {
      addLog(message, 'success');
    }
  } else if (data.type === 'result') {
    analysisResults = data.results;
    displayResults(data.results);
  } else if (data.type === 'done') {
    addLog('全処理完了', 'success');
  } else if (data.type === 'error') {
    addLog(`エラー: ${data.message}`, 'error');
  }
}

// Phase状態管理
function resetPhases() {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`phase-${i}`);
    el.className = 'phase-item';
    setProgress(i, 0);
  }
}
function setPhaseState(phase, state) {
  if (phase === 0) return;
  const el = document.getElementById(`phase-${phase}`);
  if (el) el.className = `phase-item ${state}`;
}
function setProgress(phase, pct) {
  const el = document.getElementById(`progress-${phase}`);
  if (el) el.style.width = `${pct}%`;
}

// 結果表示
function displayResults(results) {
  document.getElementById('panel-results').classList.remove('hidden');

  // スコアサマリー
  if (results.finalScore) {
    const fs = results.finalScore;
    document.getElementById('scoreSummary').innerHTML = `
      <div class="score-card primary">
        <div class="score-label">補正ESCスコア</div>
        <div class="score-value">${fs.final}</div>
        <div class="score-unit">/ 100</div>
      </div>
      <div class="score-card">
        <div class="score-label">構成点 (W1)</div>
        <div class="score-value">${fs.w1}</div>
        <div class="score-unit">/ 100</div>
      </div>
      <div class="score-card">
        <div class="score-label">ESCスコア (W2)</div>
        <div class="score-value">${fs.w2}</div>
        <div class="score-unit">/ 100</div>
      </div>
    `;
  }

  // デフォルトで採点結果タブ
  switchTab('scoring');

  // 結果パネルまでスクロール
  document.getElementById('panel-results').scrollIntoView({ behavior: 'smooth' });
}

// タブ切替
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');

  const content = document.getElementById('resultContent');
  if (!analysisResults) { content.textContent = '結果がありません'; return; }

  const phases = analysisResults.phases;
  switch (tab) {
    case 'scoring':
      content.textContent = phases.scoring || '採点結果がありません';
      break;
    case 'mapping':
      content.textContent = phases.mapping || '構造マッピングがありません';
      break;
    case 'extraction':
      if (phases.extraction) {
        content.textContent = phases.extraction.map(e =>
          `${'='.repeat(60)}\n${e.label}\n${'='.repeat(60)}\n\n${e.result}`
        ).join('\n\n');
      } else {
        content.textContent = '精読データがありません';
      }
      break;
    case 'verification':
      content.textContent = phases.verification || '検証結果がありません（Phase 4をスキップした場合）';
      break;
  }
}

// コピー
function copyResults() {
  if (!analysisResults?.phases?.scoring) return alert('結果がありません');
  navigator.clipboard.writeText(analysisResults.phases.scoring)
    .then(() => alert('コピーしました'))
    .catch(() => alert('コピーに失敗しました'));
}

// ダウンロード
function downloadResults() {
  if (!analysisResults) return alert('結果がありません');

  let md = `# SL Score 採点結果\n\n`;
  md += `**生成日時**: ${new Date().toLocaleString('ja-JP')}\n\n`;

  if (analysisResults.finalScore) {
    const fs = analysisResults.finalScore;
    md += `## スコアサマリー\n`;
    md += `- 補正ESCスコア: **${fs.final}点**\n`;
    md += `- 構成点(W1): ${fs.w1}点\n`;
    md += `- ESCスコア(W2): ${fs.w2}点\n\n`;
  }

  md += `---\n\n## 採点結果\n\n${analysisResults.phases.scoring || ''}\n\n`;
  md += `---\n\n## 構造マッピング\n\n${analysisResults.phases.mapping || ''}\n\n`;

  if (analysisResults.phases.verification) {
    md += `---\n\n## 逆方向検証\n\n${analysisResults.phases.verification}\n\n`;
  }

  if (analysisResults.errors?.length) {
    md += `---\n\n## エラーログ\n\n${analysisResults.errors.map(e => `- ${e}`).join('\n')}\n`;
  }

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `SL_Score_結果_${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
