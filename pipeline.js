// pipeline.js — 多段階分析パイプライン（Groq API版）
const Groq = require('groq-sdk');
const { buildExtractionPrompt, buildMappingPrompt, buildScoringPrompt, buildVerificationPrompt } = require('./prompts');

const ESC_COEFFICIENTS = [0.60, 0.60, 1.25, 1.25, 0.80, 0.80, 1.15, 1.35, 1.25, 1.60, 1.25, 1.50, 1.60, 1.00];
const ESC_TOTAL = 16.0;
const ITEM_NAMES = [
  'オープニングイメージ', 'セットアップ', 'インサイティング・インシデント',
  'ターニングポイント1', 'サブプロット', 'お楽しみ要素',
  'ピンチポイント1', 'ミッドポイント', 'ピンチポイント2',
  'すべてを失う', '再起のきっかけ', 'ターニングポイント2',
  'クライマックス', '結末'
];

function splitIntoChunks(text, chunksPerGroup = 8) {
  const tabPattern = /(?=タブ\s*\d+|＜第\d+話＞|スピンオフ)/g;
  const parts = text.split(tabPattern).filter(p => p.trim().length > 0);

  if (parts.length <= 1) {
    const chunks = [];
    const size = 15000;
    for (let i = 0; i < text.length; i += size) {
      chunks.push(text.slice(i, i + size));
    }
    return chunks.map((c, i) => ({ label: `パート${i + 1}`, text: c }));
  }

  const groups = [];
  for (let i = 0; i < parts.length; i += chunksPerGroup) {
    const group = parts.slice(i, i + chunksPerGroup);
    const firstPart = group[0].trim();
    const lastPart = group[group.length - 1].trim();
    const firstMatch = firstPart.match(/第(\d+)話|タブ\s*(\d+)|スピンオフ/);
    const lastMatch = lastPart.match(/第(\d+)話|タブ\s*(\d+)|スピンオフ/);
    let label = `パート${Math.floor(i / chunksPerGroup) + 1}`;
    if (firstMatch && lastMatch) {
      const f = firstMatch[1] || firstMatch[2] || 'SP';
      const l = lastMatch[1] || lastMatch[2] || 'SP';
      label = `第${f}話〜第${l}話`;
    }
    groups.push({ label, text: group.join('\n') });
  }
  return groups;
}

async function callGroq(client, prompt, modelName, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: modelName,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 8000,
        temperature: 0.3,
      });

      const text = response.choices[0]?.message?.content;
      if (!text || text.trim().length === 0) {
        throw new Error('空のレスポンスが返されました');
      }
      return text;
    } catch (err) {
      if (attempt === maxRetries) throw err;

      const isRateLimit = err.status === 429 || err.message?.includes('429') || err.message?.includes('rate_limit');
      const waitMs = isRateLimit ? 30000 * (attempt + 1) : 5000 * (attempt + 1);

      console.error(`Groq API呼出失敗 (${attempt + 1}/${maxRetries + 1}): ${err.message}`);
      console.error(`${waitMs / 1000}秒後にリトライ...`);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
}

function calculateESC(scores) {
  const w1 = scores.reduce((a, b) => a + b, 0) / scores.length;
  const weighted = scores.map((s, i) => s * ESC_COEFFICIENTS[i]);
  const w2 = weighted.reduce((a, b) => a + b, 0) / ESC_TOTAL;
  const final = w1 * 10 * 0.7 + w2 * 10 * 0.3;
  return {
    w1: (w1 * 10).toFixed(1),
    w2: (w2 * 10).toFixed(1),
    final: final.toFixed(1),
    weighted: weighted.map(w => w.toFixed(2)),
    scores
  };
}

function parseScores(scoringText) {
  const scores = [];
  for (let i = 1; i <= 14; i++) {
    const patterns = [
      new RegExp(`0?${i}[.．]\\s*${ITEM_NAMES[i-1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[：:]\\s*([0-9]+\\.?[0-9]*)`, 'i'),
      new RegExp(`\\|\\s*0?${i}\\s*\\|[^|]*\\|\\s*([0-9]+\\.?[0-9]*)\\s*\\|`),
      new RegExp(`${ITEM_NAMES[i-1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^0-9]*([0-9]+\\.[0-9])`)
    ];
    let found = false;
    for (const pattern of patterns) {
      const match = scoringText.match(pattern);
      if (match) {
        scores.push(parseFloat(match[1]));
        found = true;
        break;
      }
    }
    if (!found) scores.push(0);
  }
  return scores;
}

async function runPipeline(config, onProgress) {
  const { apiKey, model, protagonist, genre, theme, symbols, keyCharacters, storyText, skipVerification } = config;

  const client = new Groq({ apiKey });
  const results = { phases: {}, finalScore: null, errors: [] };

  // ===== Phase 1: 分割精読 =====
  onProgress({ phase: 1, status: 'start', message: 'Phase 1: テキスト分割・精読開始' });

  const chunks = splitIntoChunks(storyText);
  onProgress({ phase: 1, status: 'info', message: `${chunks.length}チャンクに分割完了` });

  const extractions = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress({
      phase: 1, status: 'progress',
      message: `精読中: ${chunks[i].label}（${i + 1}/${chunks.length}）`,
      progress: (i / chunks.length) * 100
    });

    try {
      const prompt = buildExtractionPrompt({
        protagonist, genre, theme, symbols, keyCharacters,
        chunkLabel: chunks[i].label,
        chunkText: chunks[i].text,
        totalChunks: chunks.length,
        chunkIndex: i + 1
      });

      const result = await callGroq(client, prompt, model);
      extractions.push({ label: chunks[i].label, result });

      // Groqレート制限対策
      if (i < chunks.length - 1) {
        onProgress({ phase: 1, status: 'info', message: 'レート制限回避のため少し待機...' });
        await new Promise(r => setTimeout(r, 5000));
      }
    } catch (err) {
      results.errors.push(`Phase 1 (${chunks[i].label}): ${err.message}`);
      onProgress({ phase: 1, status: 'error', message: `エラー: ${chunks[i].label} - ${err.message}` });
    }
  }

  results.phases.extraction = extractions;
  onProgress({ phase: 1, status: 'complete', message: `Phase 1 完了: ${extractions.length}チャンク処理済み` });

  // ===== Phase 2: 構造マッピング（分割対応）=====
  onProgress({ phase: 2, status: 'start', message: 'Phase 2: 構造マッピング開始' });
  onProgress({ phase: 2, status: 'info', message: 'トークン制限回避のため60秒待機...' });
  await new Promise(r => setTimeout(r, 60000));

  try {
    const halfIdx = Math.ceil(extractions.length / 2);
    const firstHalf = extractions.slice(0, halfIdx).map(e => `=== ${e.label} ===\n${e.result}`).join('\n\n');
    const secondHalf = extractions.slice(halfIdx).map(e => `=== ${e.label} ===\n${e.result}`).join('\n\n');

    onProgress({ phase: 2, status: 'progress', message: 'マッピング前半（1/2）処理中...' });
    const mappingPrompt1 = buildMappingPrompt({ protagonist, genre, theme, symbols, allExtractions: firstHalf });
    const mappingResult1 = await callGroq(client, mappingPrompt1, model);

    onProgress({ phase: 2, status: 'info', message: 'トークン制限回避のため60秒待機...' });
    await new Promise(r => setTimeout(r, 60000));

    onProgress({ phase: 2, status: 'progress', message: 'マッピング後半（2/2）処理中...' });
    const mappingPrompt2 = buildMappingPrompt({ protagonist, genre, theme, symbols, allExtractions: secondHalf });
    const mappingResult2 = await callGroq(client, mappingPrompt2, model);

    results.phases.mapping = `【前半分析】\n${mappingResult1}\n\n【後半分析】\n${mappingResult2}`;
    onProgress({ phase: 2, status: 'complete', message: 'Phase 2 完了: 構造マッピング完了' });
  } catch (err) {
    results.errors.push(`Phase 2: ${err.message}`);
    onProgress({ phase: 2, status: 'error', message: `Phase 2 エラー: ${err.message}` });
    return results;
  }

  // ===== Phase 3: 採点 =====
  onProgress({ phase: 3, status: 'start', message: 'Phase 3: 採点開始' });
  onProgress({ phase: 3, status: 'info', message: 'トークン制限回避のため60秒待機...' });
  await new Promise(r => setTimeout(r, 60000));

  try {
    const scoringPrompt = buildScoringPrompt({ protagonist, genre, theme, symbols, mappingResult: results.phases.mapping });
    const scoringResult = await callGroq(client, scoringPrompt, model);
    results.phases.scoring = scoringResult;

    const scores = parseScores(scoringResult);
    if (scores.some(s => s === 0)) {
      onProgress({ phase: 3, status: 'warning', message: '警告: 一部スコアの抽出に失敗。手動確認推奨' });
    }
    results.finalScore = calculateESC(scores);
    onProgress({ phase: 3, status: 'complete', message: `Phase 3 完了: 補正ESCスコア ${results.finalScore.final}点` });
  } catch (err) {
    results.errors.push(`Phase 3: ${err.message}`);
    onProgress({ phase: 3, status: 'error', message: `Phase 3 エラー: ${err.message}` });
    return results;
  }

  // ===== Phase 4: 逆方向検証（オプション）=====
  if (!skipVerification) {
    onProgress({ phase: 4, status: 'start', message: 'Phase 4: 逆方向検証開始（見落とし検出）' });
    onProgress({ phase: 4, status: 'info', message: 'トークン制限回避のため60秒待機...' });
    await new Promise(r => setTimeout(r, 60000));

    try {
      const verificationPrompt = buildVerificationPrompt({ protagonist, theme, symbols, scoringResult: results.phases.scoring });
      const verificationResult = await callGroq(client, verificationPrompt, model);
      results.phases.verification = verificationResult;
      onProgress({ phase: 4, status: 'complete', message: 'Phase 4 完了: 検証結果出力済み' });
    } catch (err) {
      results.errors.push(`Phase 4: ${err.message}`);
      onProgress({ phase: 4, status: 'error', message: `Phase 4 エラー: ${err.message}` });
    }
  }

  onProgress({ phase: 0, status: 'done', message: '全フェーズ完了' });
  return results;
}

module.exports = { runPipeline, splitIntoChunks, calculateESC, parseScores, ITEM_NAMES, ESC_COEFFICIENTS };
