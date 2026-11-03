window.onerror = function(message, source, lineno) {
  const meta = document.getElementById('meta-info');
  if (meta) meta.innerHTML = `<span style="color: #ef4444;">Ошибка: ${message} (строка ${lineno})</span>`;
  console.error(message);
};

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

let statsData = null;
let currentStats = null;
let profChart = null;
let profRadarChart = null;
let selectedPlayers = [];
let currentMapSort = { key: 'matches', dir: 'desc' };

function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

const ALIAS_BY_ID = new Map([
  ['76561199109745015', 'q1nce_'],
]);
const PLAYER_ALIASES_BY_NAME = new Map([
  ['BB-00 (5015)', 'q1nce_'],
]);

function aliasText(str) {
  if (typeof str !== 'string' || str === '') return str;
  return PLAYER_ALIASES_BY_NAME.get(str) ?? str;
}

function displayName(p) {
  if (!p) return '';
  const id = p.id != null ? String(p.id) : '';
  if (id) {
    const alias = ALIAS_BY_ID.get(id);
    if (alias) return alias;
  }
  const raw = p.displayName || p.name || '';
  return aliasText(raw);
}

function matchesFilter(p, query) {
  const q = (query || '').toLowerCase();
  if (!q) return true;
  const raw = (p.displayName || p.name || '').toLowerCase();
  const shown = String(displayName(p)).toLowerCase();
  return raw.includes(q) || shown.includes(q);
}

function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${target}`).classList.add('active');
      if (window.lucide) lucide.createIcons();
    });
  });
}

async function loadData() {
  try {
    const res = await fetch('data/stats.json');
    if (!res.ok) throw new Error(`Файл stats.json не найден (HTTP ${res.status})`);
    const text = await res.text();
    if (!text) throw new Error('Файл пустой (запустите npm run build)');
    
    statsData = JSON.parse(text);
    if (!statsData.tournaments) throw new Error('Нет поля tournaments');

    const select = document.getElementById('tournament-select');
    select.innerHTML = Object.keys(statsData.tournaments).map(t => `<option value="${t}">${t}</option>`).join('');
    currentStats = statsData.tournaments["Все матчи"];

    select.addEventListener('change', (e) => {
      currentStats = statsData.tournaments[e.target.value];
      selectedPlayers = [];
      if (window.closeBalancer) window.closeBalancer(); // Закрываем балансировщик при смене турнира
      renderAll();
    });

    renderAll();
  } catch (err) {
    document.getElementById('meta-info').innerHTML = `<span style="color: #ef4444;">${err.message}</span>`;
    console.error(err);
  }
}

function renderAll() {
  try {
    document.getElementById('meta-info').innerHTML = `Матчей: <b>${currentStats.recentMatches ? currentStats.recentMatches.length : 0}</b>`;
    if (currentStats.funStats) {
      document.getElementById('stat-kills').innerText = currentStats.funStats.totalKills || 0;
      document.getElementById('stat-deaths').innerText = currentStats.funStats.totalDeaths || 0;
      document.getElementById('stat-hours').innerText = (currentStats.funStats.totalHours || 0) + " ч.";
    }
    renderPodium();
    renderRecentMatches();
    renderFunFacts();
    renderRecords();
    renderPlayersTable();
    renderMapStats();
    initDuel();
    initDraft();
  } catch (e) {
    document.getElementById('meta-info').innerHTML = `<span style="color: #ef4444;">Ошибка рендера: ${e.message}</span>`;
    console.error(e);
  }
}

// ============ ДРАФТ 4x С ГЕНЕРАЦИЕЙ КАРТИНКИ ============
function initDraft() {
  const c1 = document.getElementById('cap-1');
  const c2 = document.getElementById('cap-2');
  const c3 = document.getElementById('cap-3');
  const c4 = document.getElementById('cap-4');
  if (!c1) return;

  const opts = currentStats.players
    .slice()
    .sort((a, b) => (b.elo ?? 1000) - (a.elo ?? 1000))
    .map(p => `<option value="${p.id}">${displayName(p)} (${p.elo} ELO)</option>`)
    .join('');
  
  [c1, c2, c3, c4].forEach((sel, i) => {
    sel.innerHTML = `<option value="">— выберите —</option>` + opts;
    if (currentStats.players.length > i) sel.selectedIndex = i + 1;
  });

  const buildBtn = document.getElementById('build-teams-btn');
  const shuffleBtn = document.getElementById('shuffle-teams-btn');
  const resetBtn = document.getElementById('reset-teams-btn');
  const resultDiv = document.getElementById('draft-result');

  const executeDraft = (isShuffle = false) => {
    const capIds = [c1.value, c2.value, c3.value, c4.value].filter(Boolean);
    if (capIds.length !== 4) return showToast('Выберите 4 капитана', 'error');
    if (new Set(capIds).size !== 4) return showToast('Капитаны не должны повторяться', 'error');

    const weights = getBalancerWeights();
    const captains = capIds.map(id => currentStats.players.find(p => p.id === id)).filter(Boolean);
    const allPlayers = currentStats.players.filter(p => !capIds.includes(p.id));
    const scoredPool = allPlayers.map(p => ({ ...p, score: playerCompositeScore(p, weights) }));
    
    const sorted = scoredPool.slice().sort((a, b) => b.score - a.score);

    const buildTeamsLogic = (pool, caps) => {
      const teams = caps.map(c => {
        const capScore = playerCompositeScore(c, weights);
        return { captain: c, captainScore: capScore, players: [], sumScore: capScore };
      });

      let poolIdx = 0;
      while (poolIdx < pool.length) {
        let weakestIdx = -1;
        let minScore = Infinity;
        
        for (let i = 0; i < teams.length; i++) {
          if (teams[i].players.length < 4 && teams[i].sumScore < minScore) {
            minScore = teams[i].sumScore;
            weakestIdx = i;
          }
        }
        
        if (weakestIdx === -1) break;
        
        const player = pool[poolIdx++];
        teams[weakestIdx].players.push(player);
        teams[weakestIdx].sumScore += player.score;
      }
      return teams;
    };

    let finalTeams = [];
    let finalSpread = 0;

    if (isShuffle) {
      const largePool = sorted.slice(0, Math.min(24, sorted.length));
      let candidates = [];

      // 300 симуляций
      for (let i = 0; i < 300; i++) {
        const shuffled = [...largePool].sort(() => Math.random() - 0.5);
        const pool = shuffled.slice(0, 16).sort((a, b) => b.score - a.score);
        
        // Перемешиваем самих капитанов для уникальности
        const shuffledCaptains = [...captains].sort(() => Math.random() - 0.5);
        
        const teams = buildTeamsLogic(pool, shuffledCaptains);
        const sums = teams.map(t => t.sumScore);
        const spread = Math.max(...sums) - Math.min(...sums);
        
        candidates.push({ teams, spread });
      }

      candidates.sort((a, b) => a.spread - b.spread);
      const bestOptions = candidates.slice(0, 10);
      const selected = bestOptions[Math.floor(Math.random() * bestOptions.length)];
      
      finalTeams = selected.teams;
      finalSpread = selected.spread;

    } else {
      const pool = sorted.slice(0, 16);
      finalTeams = buildTeamsLogic(pool, captains);
      const sums = finalTeams.map(t => t.sumScore);
      finalSpread = Math.max(...sums) - Math.min(...sums);
    }

    const q = balanceQuality(finalSpread);

    resultDiv.style.display = 'grid';
    
    resultDiv.querySelectorAll('.balance-card-preview, .balance-share-actions').forEach(el => {
      if (el.dataset && el.dataset.url) URL.revokeObjectURL(el.dataset.url);
      el.remove();
    });

    resultDiv.innerHTML = `
      <div class="draft-quality-row">
        <span class="quality-badge ${q.key}">${q.label} · разброс Σ ${finalSpread.toFixed(2)}</span>
      </div>
      ${finalTeams.map((team, i) => {
        const capAva = team.captain.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(team.captain.name)}&background=ffd700&color=000`;
        return `
          <div class="draft-team-result">
            <h3>Команда ${i + 1} <span class="draft-team-avg">Σ ${team.sumScore.toFixed(2)}</span></h3>
            <ul>
              <li><img src="${capAva}"> <b>${displayName(team.captain)}</b> <span style="color:#ffd700;font-size:0.7rem;margin-left:auto;">К · ${team.captainScore.toFixed(2)}</span></li>
              ${team.players.map(p => {
                const ava = p.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff`;
                return `<li><img src="${ava}"> ${displayName(p)} <span style="margin-left:auto;color:var(--text-muted);font-size:0.75rem;">${p.score.toFixed(2)}</span></li>`;
              }).join('')}
            </ul>
          </div>
        `;
      }).join('')}
    `;

    resetBtn.style.display = 'block';
    resetBtn.onclick = () => {
      resultDiv.style.display = 'none';
      resultDiv.innerHTML = '';
      resetBtn.style.display = 'none';
    };

    const tournamentName = document.getElementById('tournament-select').value || 'Все матчи';
    const cardCanvas = drawDraftCard({ teams: finalTeams, spread: finalSpread, quality: q, tournamentName });

    cardCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);

      const preview = document.createElement('div');
      preview.className = 'balance-card-preview';
      preview.dataset.url = url;
      preview.style.gridColumn = '1 / -1';
      preview.innerHTML = `<img src="${url}" alt="Карточка драфта">`;
      resultDiv.appendChild(preview);

      const actions = document.createElement('div');
      actions.className = 'balance-share-actions';
      actions.style.gridColumn = '1 / -1';

      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn-outline';
      dlBtn.style.flex = '1';
      dlBtn.innerText = 'Скачать PNG';
      dlBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'draft-' + Date.now() + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
      actions.appendChild(dlBtn);

      const file = new File([blob], 'draft.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        const shareBtn2 = document.createElement('button');
        shareBtn2.className = 'btn-outline';
        shareBtn2.style.flex = '1';
        shareBtn2.innerText = 'Поделиться';
        shareBtn2.onclick = async () => {
          try { await navigator.share({ files: [file], title: 'Драфт команд', text: 'Драфт для CS2' }); } catch (e) {}
        };
        actions.appendChild(shareBtn2);
      }

      resultDiv.appendChild(actions);
    }, 'image/png');
  };

  buildBtn.onclick = () => executeDraft(false);
  if (shuffleBtn) shuffleBtn.onclick = () => executeDraft(true);
}

function drawDraftCard({ teams, spread, quality, tournamentName }) {
  const W = 1200, H = 1180;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const BG = '#0b0e14';
  const TEXT = '#f0f3f8';
  const MUTED = '#8b96a5';
  const BORDER = '#262f40';
  const PANEL = '#151a25';
  const ACCENT = '#4d6bfe';

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(77,107,254,0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  ctx.fillStyle = TEXT;
  ctx.font = '800 28px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('GEIMERI DRAFT', 60, 56);

  ctx.fillStyle = MUTED;
  ctx.font = '500 16px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(tournamentName || 'Все матчи', W - 60, 56);
  ctx.fillText('Сгенерировано ' + new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), W - 60, 80);
  
  ctx.strokeStyle = BORDER;
  ctx.beginPath(); ctx.moveTo(60, 130); ctx.lineTo(W - 60, 130); ctx.stroke();

  const qColor = quality.key === 'perfect' ? '#10b981' : quality.key === 'good' ? ACCENT : quality.key === 'ok' ? '#f59e0b' : '#ef4444';
  const badgeText = quality.label + ' · разброс Σ ' + spread.toFixed(2);
  ctx.font = '600 14px Inter, system-ui, sans-serif';
  const badgeW = ctx.measureText(badgeText).width + 28;
  const badgeX = 60, badgeY = 158;

  ctx.fillStyle = qColor + '26';
  roundRectPath(ctx, badgeX, badgeY, badgeW, 32, 6);
  ctx.fill();
  ctx.strokeStyle = qColor + '4d';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = qColor;
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, badgeX + 14, badgeY + 16);

  const colY = 230;
  const boxW = 520;
  const boxH = 420;
  const gapX = 40;
  const gapY = 30;
  const startX = 60;
  
  const colors = ['#4d6bfe', '#10b981', '#f59e0b', '#ef4444'];

  teams.forEach((team, i) => {
    const row = Math.floor(i / 2);
    const col = i % 2;
    const bx = startX + col * (boxW + gapX);
    const by = colY + row * (boxH + gapY);
    const accentColor = colors[i];

    ctx.fillStyle = PANEL;
    roundRectPath(ctx, bx, by, boxW, boxH, 12);
    ctx.fill();
    ctx.strokeStyle = BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textBaseline = 'top';
    ctx.fillStyle = TEXT;
    ctx.font = '700 20px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Команда ${i + 1}`, bx + 24, by + 24);

    ctx.fillStyle = accentColor;
    ctx.textAlign = 'right';
    ctx.fillText('Σ ' + team.sumScore.toFixed(2), bx + boxW - 24, by + 24);
    ctx.textAlign = 'left';

    ctx.strokeStyle = BORDER;
    ctx.beginPath();
    ctx.moveTo(bx + 24, by + 60);
    ctx.lineTo(bx + boxW - 24, by + 60);
    ctx.stroke();

    const allPlayers = [
      { ...team.captain, score: team.captainScore, isCap: true },
      ...team.players
    ].sort((a,b) => b.score - a.score);

    let py = by + 80;
    for (const p of allPlayers) {
      const nameStr = String(displayName(p) || '?');
      const initial = nameStr.slice(0, 1).toUpperCase();

      ctx.fillStyle = (p.isCap ? '#ffd700' : accentColor) + '33';
      ctx.beginPath();
      ctx.arc(bx + 44, py + 20, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.isCap ? '#ffd700' : accentColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = p.isCap ? '#ffd700' : accentColor;
      ctx.font = '700 18px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initial, bx + 44, py + 21);

      let name = nameStr;
      if (name.length > 26) name = name.slice(0, 24) + '…';
      ctx.fillStyle = TEXT;
      ctx.font = p.isCap ? '700 18px Inter, system-ui, sans-serif' : '600 18px Inter, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, bx + 80, py + 20);

      if (p.isCap) {
        ctx.fillStyle = '#ffd700';
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.fillText('CAPTAIN', bx + 80, py + 38);
      }

      ctx.fillStyle = MUTED;
      ctx.font = '600 16px Inter, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(p.score.toFixed(2), bx + boxW - 24, py + 20);
      ctx.textAlign = 'left';

      py += 64;
    }
  });

  ctx.fillStyle = MUTED;
  ctx.font = '500 14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('GEIMERI • CS2 STATS', W / 2, H - 40);
  ctx.textAlign = 'left';

  return canvas;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ============ ПЬЕДЕСТАЛ И РЕКОРДЫ ============
function renderPodium() {
  const container = document.getElementById('podium-container');
  if (!container || !currentStats.players) return;
  const top3 = currentStats.players.slice(0, 3);
  if (top3.length === 0) { container.innerHTML = '<p style="color:var(--text-muted);">Нет игроков</p>'; return; }
  const order = [1, 0, 2];
  const classes = ['podium-2', 'podium-1', 'podium-3'];
  const ranks = ['2 место', '1 место', '3 место'];
  container.innerHTML = order.map((idx, i) => {
    const p = top3[idx];
    if (!p) return '';
    return `<div class="podium-card ${classes[i]}" onclick="openProfile('${p.id}')">
      <div class="podium-rank">${ranks[i]}</div>
      <img src="${p.avatar}" class="podium-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">
      <div class="podium-name">${displayName(p)}</div>
      <div class="podium-rating" style="color: ${p.rankColor || 'var(--accent)'};">${p.elo || '—'} <span style="font-size: 0.7rem;">ELO</span></div>
    </div>`;
  }).join('');
}

function renderRecentMatches() {
  const container = document.getElementById('recent-matches-container');
  if (!container || !currentStats.recentMatches) return;
  if (currentStats.recentMatches.length === 0) { container.innerHTML = '<p style="color:var(--text-muted);">Матчей пока нет</p>'; return; }
  container.innerHTML = currentStats.recentMatches.map(m => {
    const date = new Date(m.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<a href="${m.url}" target="_blank" class="recent-match-item">
      <div class="recent-match-left"><span class="recent-match-date">${date}</span><span class="recent-match-maps">${m.maps.join(' · ')}</span></div>
      <div class="recent-match-right"><span>Открыть</span><span style="font-size: 1.2rem;">→</span></div>
    </a>`;
  }).join('');
}

function renderFunFacts() {
  const container = document.getElementById('fun-facts-container');
  if (!container) return;
  const ff = currentStats.funFacts;
  if (!ff || (!ff.mostStable && !ff.highestPeak && !ff.favoriteMap)) {
    container.innerHTML = '<p style="color:var(--text-muted);">Недостаточно данных</p>';
    return;
  }
  const items = [];
  if (ff.mostStable) items.push({ title: 'Самый стабильный', player: aliasText(ff.mostStable.player), playerId: ff.mostStable.playerId, desc: `Разброс рейтинга ±${ff.mostStable.stdDev}` });
  if (ff.highestPeak) items.push({ title: 'Пиковый рейтинг', player: aliasText(ff.highestPeak.player), playerId: ff.highestPeak.playerId, desc: `${ff.highestPeak.rating.toFixed(2)} на ${ff.highestPeak.map}` });
  if (ff.lowestRating) items.push({ title: 'Худший матч', player: aliasText(ff.lowestRating.player), playerId: ff.lowestRating.playerId, desc: `${ff.lowestRating.rating.toFixed(2)} на ${ff.lowestRating.map}` });
  if (ff.favoriteMap) items.push({ title: 'Любимая карта', player: ff.favoriteMap.map, playerId: null, desc: `${ff.favoriteMap.matches} игр` });
  
  container.innerHTML = items.map(i => `
    <div class="fun-fact-item" ${i.playerId ? `onclick="openProfile('${i.playerId}')" style="cursor:pointer;"` : ''}>
      <div class="fact-title">${i.title}</div>
      <div class="fact-player">${i.player}</div>
      <div class="fact-desc">${i.desc}</div>
    </div>
  `).join('');
}

function renderRecords() {
  if (!currentStats.records) return;
  const r = currentStats.records;
  const killRec = (r.maxKills && r.maxKills.value > 0) ? r.maxKills : null;
  const deathRec = (r.maxDeaths && r.maxDeaths.value > 0) ? r.maxDeaths : null;
  const adrRec = (r.maxAdr && r.maxAdr.value > 0) ? r.maxAdr : null;
  document.getElementById('rec-max-kills').innerText = killRec ? killRec.value : '—';
  document.getElementById('rec-max-kills-desc').innerHTML = killRec ? `<b>${aliasText(killRec.player)}</b><br><span>${killRec.map}</span>` : 'Нет данных';
  document.getElementById('rec-max-deaths').innerText = deathRec ? deathRec.value : '—';
  document.getElementById('rec-max-deaths-desc').innerHTML = deathRec ? `<b>${aliasText(deathRec.player)}</b><br><span>${deathRec.map}</span>` : 'Нет данных';
  document.getElementById('rec-max-adr').innerText = adrRec ? adrRec.value : '—';
  document.getElementById('rec-max-adr-desc').innerHTML = adrRec ? `<b>${aliasText(adrRec.player)}</b><br><span>${adrRec.map}</span>` : 'Нет данных';
  
  document.getElementById('card-rec-kills').onclick = killRec ? () => openRecordDetails('maxKills') : null;
  document.getElementById('card-rec-deaths').onclick = deathRec ? () => openRecordDetails('maxDeaths') : null;
  document.getElementById('card-rec-adr').onclick = adrRec ? () => openRecordDetails('maxAdr') : null;
}

function openRecordDetails(type) {
  const rec = currentStats.records[type];
  if (!rec || !rec.player) return;
  const player = currentStats.players.find(p => p.id === rec.playerId || p.name === rec.player);
  const titleText = type === 'maxKills' ? 'Рекорд: макс. убийств' : type === 'maxDeaths' ? 'Антирекорд: макс. смертей' : 'Рекорд: макс. ADR';
  document.getElementById('record-title').innerText = titleText;
  const avatar = player?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(rec.player)}&background=4d6bfe&color=fff`;
  const date = rec.date ? new Date(rec.date).toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit', year:'numeric'}) : '';
  const playerId = rec.playerId || player?.id;
  const matchUrl = rec.matchId ? `https://cybershoke.net/ru/match/${rec.matchId}` : '#';
  
  document.getElementById('record-content').innerHTML = `
    <div style="text-align:center; margin-bottom: 20px;">
      <img src="${avatar}" style="width: 80px; height: 80px; border-radius: 50%; margin-bottom: 10px; cursor: pointer;" onclick="openProfile('${playerId}')">
      <h3 style="cursor:pointer; color: var(--accent);" onclick="openProfile('${playerId}')">${aliasText(rec.player)}</h3>
      <p style="color: var(--text-muted); font-size: 0.85rem;">${rec.map} · ${date}</p>
    </div>
    <div style="background: var(--bg-main); border: 1px solid var(--border); border-radius: 8px; padding: 15px; text-align:center; margin-bottom: 15px;">
      <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 5px;">${type === 'maxDeaths' ? 'Смертей' : type === 'maxAdr' ? 'ADR' : 'Убийств'}</div>
      <div style="font-size: 2.5rem; font-weight: 800; color: var(--accent);">${rec.value}</div>
    </div>
    ${rec.matchId ? `<a href="${matchUrl}" target="_blank" class="btn-primary" style="display:block; text-align:center; text-decoration:none; padding: 12px;">Открыть матч на Cybershoke</a>` : ''}
  `;
  document.getElementById('record-modal').style.display = 'block';
}

function closeRecordDetails() {
  document.getElementById('record-modal').style.display = 'none';
}

function renderPlayersTable() {
  const tbody = document.querySelector('#players-table tbody');
  const filterInput = document.getElementById('filter-name');
  const sortSelect = document.getElementById('sort-by');
  function draw() {
    const filter = filterInput.value.toLowerCase();
    const sortKey = sortSelect.value;
    let players = [...currentStats.players].filter(p => matchesFilter(p, filter));
    players.sort((a, b) => {
      if (sortKey === 'deaths') return b.deaths - a.deaths;
      if (sortKey === 'kd') return b.kd - a.kd;
      if (sortKey === 'adr') return (b.avgAdr ?? 0) - (a.avgAdr ?? 0);
      if (sortKey === 'elo') return b.elo - a.elo;
      return b.elo - a.elo; 
    });
    tbody.innerHTML = players.map((p) => {
      let formText = '';
      if (p.form === 'hot') formText = '<span style="color: #10b981;">В форме</span>';
      else if (p.form === 'cold') formText = '<span style="color: #ef4444;">Спад</span>';
      else if (p.form === 'new') formText = '<span style="color: #f59e0b;">Мало данных</span>';
      else formText = '<span style="color: var(--text-muted);">Стабильно</span>';
      return `<tr>
        <td><div class="player-cell"><img src="${p.avatar}" class="player-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'"><div><strong class="player-link" onclick="openProfile('${p.id}')">${displayName(p)}</strong></div></div></td>
        <td><span style="color: ${p.rankColor}; font-weight: bold;">${p.elo}</span></td>
        <td>${formText}</td><td>${p.matches}</td><td><strong>${p.kd}</strong></td><td style="color: var(--accent); font-weight: 600;">${p.avgRating ?? '—'}</td>
      </tr>`;
    }).join('');
  }
  filterInput.oninput = draw;
  sortSelect.onchange = draw;
  draw();
}

function renderMapStats() {
  const tbody = document.querySelector('#maps-table tbody');
  if (!tbody || !currentStats.mapStats) return;
  function draw() {
    let data = [...currentStats.mapStats];
    const key = currentMapSort.key;
    const dir = currentMapSort.dir === 'asc' ? 1 : -1;
    data.sort((a, b) => key === 'map' ? a.map.localeCompare(b.map) * dir : (a[key] - b[key]) * dir);
    tbody.innerHTML = data.map(m => `<tr class="map-row" onclick="openMapDetails('${m.map}')"><td><strong>${m.map}</strong></td><td>${m.matches}</td><td>${m.avgKd}</td><td style="color: var(--accent); font-weight: 600;">${m.avgRating}</td></tr>`).join('');
  }
  document.querySelectorAll('#maps-table .sortable').forEach(th => {
    if (th.dataset.listenerAttached) return;
    th.dataset.listenerAttached = 'true';
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (currentMapSort.key === key) currentMapSort.dir = currentMapSort.dir === 'asc' ? 'desc' : 'asc';
      else { currentMapSort.key = key; currentMapSort.dir = 'desc'; }
      document.querySelectorAll('#maps-table .sortable').forEach(t => { t.classList.remove('asc', 'desc'); t.querySelector('.sort-arrow').textContent = '⬍'; });
      th.classList.add(currentMapSort.dir);
      th.querySelector('.sort-arrow').textContent = currentMapSort.dir === 'asc' ? '▲' : '▼';
      draw();
    });
  });
  draw();
}

function openMapDetails(mapName) {
  const mapData = currentStats.mapStats.find(m => m.map === mapName);
  if (!mapData) return;
  document.getElementById('map-modal-title').innerText = mapName;
  const tbody = document.getElementById('map-players-list');
  tbody.innerHTML = mapData.topPlayers.map((p) => `
    <tr>
      <td>
        <div class="player-cell" style="cursor:pointer;" onclick="openProfile('${p.id}')">
          <img src="${p.avatar}" class="player-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">
          <strong>${displayName(p)}</strong>
        </div>
      </td>
      <td>${p.matches}</td>
      <td>${p.kills}</td>
      <td>${p.deaths}</td>
      <td>${p.kd}</td>
      <td style="color: var(--accent); font-weight: 600;">${p.avgRating}</td>
    </tr>
  `).join('');
  document.getElementById('map-modal').style.display = 'block';
}
function closeMapDetails() { document.getElementById('map-modal').style.display = 'none'; }

// ============ ДЕТАЛИ МАТЧА ============
function openMatchDetails(matchId) {
  if (!matchId) return showToast('Нет ID матча. Пересоберите статистику (npm run build)', 'error');
  
  const match = statsData.allMatches ? statsData.allMatches.find(m => m.matchId === matchId) : null;
  if (!match) {
    return showToast('Данные матча не найдены (пересоберите stats.json)', 'error');
  }

  let contentHtml = '';
  for (const mapData of match.maps) {
    const players = [...mapData.players].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    
    contentHtml += `
      <div style="margin-bottom: 24px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--border); padding-bottom:8px;">
          <h3 style="margin:0; color:var(--accent); font-size:1.1rem;">${mapData.map}</h3>
          <a href="https://cybershoke.net/ru/match/${matchId}" target="_blank" class="btn-outline" style="font-size:0.75rem; padding:4px 8px;">На Cybershoke ↗</a>
        </div>
        <div class="table-container">
          <table class="stats-table">
            <thead><tr><th>Игрок</th><th>K</th><th>D</th><th>A</th><th>ADR</th><th>KAST</th><th>Rating</th></tr></thead>
            <tbody>
              ${players.map(p => {
                const playerObj = currentStats.players.find(sp => sp.id === p.id) || p;
                const ava = playerObj.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff`;
                return `<tr>
                  <td><div class="player-cell"><img src="${ava}" class="player-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'"><strong>${displayName(p)}</strong></div></td>
                  <td>${p.kills}</td><td>${p.deaths}</td><td>${p.assists}</td>
                  <td>${p.adr ?? '—'}</td><td>${p.kast ?? '—'}</td><td style="color:#10b981; font-weight:600;">${p.rating ?? '—'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  document.getElementById('match-modal-title').innerText = 'Детали матча';
  document.getElementById('match-modal-content').innerHTML = contentHtml;
  document.getElementById('match-modal').style.display = 'block';
}

function closeMatchDetails() { document.getElementById('match-modal').style.display = 'none'; }

function initDuel() {
  const p1Select = document.getElementById('duel-p1');
  const p2Select = document.getElementById('duel-p2');
  const btn = document.getElementById('duel-btn');
  const resultDiv = document.getElementById('duel-result');
  const options = currentStats.players.map(p => `<option value="${p.id}">${displayName(p)}</option>`).join('');
  p1Select.innerHTML = options;
  p2Select.innerHTML = options;
  btn.onclick = () => {
    const p1 = currentStats.players.find(p => p.id === p1Select.value);
    const p2 = currentStats.players.find(p => p.id === p2Select.value);
    if (!p1 || !p2) return;
    if (p1.id === p2.id) return showToast('Выберите двух разных игроков', 'error');
    const compare = (v1, v2) => v1 === v2 ? ['', ''] : (v1 > v2 ? ['duel-winner', 'duel-loser'] : ['duel-loser', 'duel-winner']);
    const [kd1, kd2] = compare(p1.kd, p2.kd);
    const [rat1, rat2] = compare(p1.avgRating ?? 0, p2.avgRating ?? 0);
    const [adr1, adr2] = compare(p1.avgAdr ?? 0, p2.avgAdr ?? 0);
    const [kast1, kast2] = compare(p1.avgKast ?? 0, p2.avgKast ?? 0);
    const winnerName = (p1.elo ?? 0) > (p2.elo ?? 0) ? displayName(p1) : displayName(p2);
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div class="duel-row"><span class="${kd1}">${p1.kd} K/D</span><span style="font-weight:bold;color:var(--text-muted);">K/D</span><span class="${kd2}">${p2.kd} K/D</span></div>
      <div class="duel-row"><span class="${rat1}">${p1.avgRating ?? '—'} Рейтинг</span><span style="font-weight:bold;color:var(--text-muted);">Рейтинг</span><span class="${rat2}">${p2.avgRating ?? '—'} Рейтинг</span></div>
      <div class="duel-row"><span class="${adr1}">${p1.avgAdr ?? '—'} ADR</span><span style="font-weight:bold;color:var(--text-muted);">ADR</span><span class="${adr2}">${p2.avgAdr ?? '—'} ADR</span></div>
      <div class="duel-row"><span class="${kast1}">${p1.avgKast ?? '—'} KAST</span><span style="font-weight:bold;color:var(--text-muted);">KAST</span><span class="${kast2}">${p2.avgKast ?? '—'} KAST</span></div>
      <div style="text-align:center; margin-top:15px; font-weight:bold; font-size:1rem; color:#fff;">Победитель: <span style="color:#10b981;">${winnerName}</span></div>
    `;
  };
}

// ============ ПРОФИЛЬ С РАДАРОМ ============
function openProfile(playerId) {
  const p = currentStats.players.find(pl => pl.id === playerId);
  if (!p) return;
  const img = document.getElementById('prof-avatar');
  img.src = p.avatar;
  img.onerror = function() { this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true&size=128`; };
  
  document.getElementById('prof-name').innerHTML = `${displayName(p)} <span style="font-size: 0.8rem; padding: 2px 6px; border-radius: 4px; background: ${p.rankColor}33; color: ${p.rankColor}; border: 1px solid ${p.rankColor}; margin-left: 8px; white-space: nowrap;">${p.elo} ELO</span>`;
  
  document.getElementById('prof-matches').innerText = p.matches;
  document.getElementById('prof-kd').innerText = p.kd;
  document.getElementById('prof-rating').innerText = p.avgRating ?? '—';
  document.getElementById('prof-adr').innerText = p.avgAdr ?? '—';
  document.getElementById('prof-kast').innerText = p.avgKast ?? '—';

  const faceitBtn = document.getElementById('faceit-btn');
  if (faceitBtn) {
    faceitBtn.onclick = async () => {
      const newTab = window.open('about:blank', '_blank');
      faceitBtn.innerText = 'Загрузка...';
      faceitBtn.disabled = true;
      try {
        const res = await fetch(`https://steamgpt.net/faceit/${p.id}.json`);
        if (!res.ok) throw new Error('Ошибка API');
        const json = await res.json();
        if (json.result === 'success' && json.data && json.data.faceit) {
          newTab.location.href = `https://www.faceit.com/en/players/${json.data.faceit.nickname}`;
        } else {
          newTab.close();
          showToast('У этого игрока нет аккаунта FACEIT', 'error');
        }
      } catch (err) {
        newTab.close();
        showToast('Не удалось найти профиль FACEIT', 'error');
      } finally {
        faceitBtn.innerText = 'FACEIT';
        faceitBtn.disabled = false;
      }
    };
  }
  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) shareBtn.onclick = () => {
    const text = encodeURIComponent(`Статистика: ${displayName(p)} (${p.elo} ELO)\nРейтинг: ${p.avgRating || 0}\nK/D: ${p.kd}\nADR: ${p.avgAdr || 0}\nПодробнее:`);
    window.open(`https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${text}`, '_blank');
  };
  const compareBtn = document.getElementById('compare-btn');
  if (compareBtn) compareBtn.onclick = () => {
    closeProfile();
    document.getElementById('duel-p1').value = p.id;
    const tabs = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');
    tabs.forEach(t => t.classList.remove('active'));
    contents.forEach(c => c.classList.remove('active'));
    document.querySelector('[data-tab="players"]').classList.add('active');
    document.getElementById('tab-players').classList.add('active');
    setTimeout(() => document.getElementById('duel-section').scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
  };

  const tbody = document.getElementById('prof-match-history');
  const history = [...(p.matchHistory || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  
  tbody.innerHTML = history.map(h => {
    const d = new Date(h.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    let eloHtml = '<span style="color:var(--text-muted);">0</span>';
    if (h.eloChange > 0) eloHtml = `<span style="color:#10b981; font-weight:bold;">+${h.eloChange}</span>`;
    if (h.eloChange < 0) eloHtml = `<span style="color:#ef4444; font-weight:bold;">${h.eloChange}</span>`;

    return `<tr class="match-history-row" style="cursor:pointer;" onclick="openMatchDetails('${h.matchId}')">
      <td>${d}</td><td>${h.map}</td><td>${h.kills}</td><td>${h.deaths}</td><td>${h.assists}</td><td>${h.adr ?? '—'}</td><td>${h.kast ?? '—'}</td><td style="color: var(--accent); font-weight: 600;">${h.rating ?? '—'}</td><td>${eloHtml}</td>
    </tr>`;
  }).join('');

  const canvas = document.getElementById('prof-chart');
  if (profChart) profChart.destroy();
  if (p.history && p.history.length > 1) {
    const sortedHist = [...p.history].sort((a,b) => new Date(a.date) - new Date(b.date));
    profChart = new Chart(canvas, {
      type: 'line',
      data: { 
        labels: sortedHist.map(h => new Date(h.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })), 
        datasets: [{ label: 'Рейтинг', data: sortedHist.map(h => h.rating), borderColor: '#4d6bfe', backgroundColor: 'rgba(77, 107, 254, 0.1)', fill: true, tension: 0.3 }] 
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: '#8b96a5', maxRotation: 45, minRotation: 45 } }, y: { grid: { color: '#262f40' }, ticks: { color: '#8b96a5' } } } }
    });
  }

  const radarCanvas = document.getElementById('prof-radar-chart');
  if (radarCanvas) {
    if (profRadarChart) profRadarChart.destroy();
    
    const serverAvg = currentStats.players.reduce((acc, curr) => {
      acc.kd += curr.kd || 0;
      acc.adr += curr.avgAdr || 0;
      acc.kast += curr.avgKast || 0;
      acc.rating += curr.avgRating || 0;
      return acc;
    }, { kd: 0, adr: 0, kast: 0, rating: 0 });
    const count = currentStats.players.length || 1;
    serverAvg.kd /= count; serverAvg.adr /= count; serverAvg.kast /= count; serverAvg.rating /= count;

    const maxKd = 2.0, maxAdr = 120, maxKast = 100, maxRating = 2.0;
    const normalize = (val, max) => Math.min(100, (val / max) * 100);

    const playerData = [
      normalize(p.kd || 0, maxKd),
      normalize(p.avgAdr || 0, maxAdr),
      normalize(p.avgKast || 0, maxKast),
      normalize(p.avgRating || 0, maxRating)
    ];
    
    const serverData = [
      normalize(serverAvg.kd, maxKd),
      normalize(serverAvg.adr, maxAdr),
      normalize(serverAvg.kast, maxKast),
      normalize(serverAvg.rating, maxRating)
    ];

    profRadarChart = new Chart(radarCanvas, {
      type: 'radar',
      data: {
        labels: ['K/D', 'ADR', 'KAST', 'Rating'],
        datasets: [
          {
            label: 'Игрок',
            data: playerData,
            borderColor: '#4d6bfe',
            backgroundColor: 'rgba(77, 107, 254, 0.3)',
            pointBackgroundColor: '#4d6bfe',
            borderWidth: 2,
          },
          {
            label: 'Среднее по серверу',
            data: serverData,
            borderColor: '#8b96a5',
            backgroundColor: 'rgba(139, 150, 165, 0.1)',
            pointBackgroundColor: '#8b96a5',
            borderDash: [5, 5],
            borderWidth: 1,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { 
          legend: { labels: { color: '#8b96a5', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function(context) {
                const isPlayer = context.datasetIndex === 0;
                const idx = context.dataIndex;
                let realVal = 0;
                if (idx === 0) realVal = isPlayer ? (p.kd || 0) : serverAvg.kd;
                if (idx === 1) realVal = isPlayer ? (p.avgAdr || 0) : serverAvg.adr;
                if (idx === 2) realVal = isPlayer ? (p.avgKast || 0) : serverAvg.kast;
                if (idx === 3) realVal = isPlayer ? (p.avgRating || 0) : serverAvg.rating;
                return `${context.dataset.label}: ${realVal.toFixed(2)}`;
              }
            }
          }
        },
        scales: {
          r: {
            angleLines: { color: '#262f40' },
            grid: { color: '#262f40' },
            pointLabels: { color: '#f0f3f8', font: { size: 12, weight: 'bold' } },
            ticks: { display: false, min: 0, max: 100 }
          }
        }
      }
    });
  }

  document.getElementById('profile-modal').style.display = 'block';
}
function closeProfile() { document.getElementById('profile-modal').style.display = 'none'; }
window.onclick = function(event) {
  if (event.target == document.getElementById('profile-modal')) closeProfile();
  if (event.target == document.getElementById('map-modal')) closeMapDetails();
  if (event.target == document.getElementById('match-modal')) closeMatchDetails();
  if (event.target == document.getElementById('record-modal')) closeRecordDetails();
  if (event.target == document.getElementById('balancer-modal')) closeBalancer();
  if (event.target == document.getElementById('feedback-modal')) closeFeedback();
}

function getSavedKey() { return `savedTeams_${document.getElementById('tournament-select').value}`; }

// ============ БАЛАНСИРОВЩИК ============
const BALANCER_DEFAULTS = { rating: 0.5, kd: 0.2, adr: 0.2, kast: 0.1 };
const BALANCER_WEIGHTS_KEY = 'balancerWeights';

function normalizeWeights(w) {
  const r = Math.max(0, Number(w?.rating) || 0);
  const k = Math.max(0, Number(w?.kd) || 0);
  const a = Math.max(0, Number(w?.adr) || 0);
  const s = Math.max(0, Number(w?.kast) || 0);
  const sum = r + k + a + s;
  if (sum <= 0) return { ...BALANCER_DEFAULTS };
  return { rating: r / sum, kd: k / sum, adr: a / sum, kast: s / sum };
}

function getBalancerWeights() {
  try {
    const raw = localStorage.getItem(BALANCER_WEIGHTS_KEY);
    if (raw) return normalizeWeights(JSON.parse(raw));
  } catch (e) {}
  return { ...BALANCER_DEFAULTS };
}

function saveBalancerWeights(w) {
  try { localStorage.setItem(BALANCER_WEIGHTS_KEY, JSON.stringify(w)); } catch (e) {}
}

function playerCompositeScore(p, w) {
  const n = normalizeWeights(w);
  const rNorm = p && p.avgRating != null ? p.avgRating : 1.0;
  const kNorm = p && p.kd != null ? p.kd : 1.0;
  const aNorm = p && p.avgAdr != null ? p.avgAdr / 75 : 1.0;
  const sNorm = p && p.avgKast != null ? p.avgKast / 70 : 1.0;
  return rNorm * n.rating + kNorm * n.kd + aNorm * n.adr + sNorm * n.kast;
}

function mapPlayerCompositeScore(player, mapEntry, w) {
  const n = normalizeWeights(w);
  const rVal = mapEntry && mapEntry.avgRating != null ? mapEntry.avgRating : (player.avgRating ?? 1.0);
  const kVal = mapEntry && mapEntry.kd != null ? mapEntry.kd : (player.kd ?? 1.0);
  const aVal = player.avgAdr != null ? player.avgAdr / 75 : 1.0;
  const sVal = player.avgKast != null ? player.avgKast / 70 : 1.0;
  return rVal * n.rating + kVal * n.kd + aVal * n.adr + sVal * n.kast;
}

// НОВАЯ ЛОГИКА ПЛЕЙСТАЙЛОВ
function getPlaystyle(p) {
  if (!p || p.matches < 3) return 'Универсал';
  const adr = p.avgAdr || 0;
  const kd = p.kd || 0;
  const kast = p.avgKast || 0;

  if (kd >= 1.3 && adr >= 75 && kast < 72) return 'Снайпер';
  if (adr >= 80 && kd >= 1.05) return 'Фраггер';
  if (kast >= 70 && adr <= 70) return 'Саппорт';
  return 'Универсал';
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst = combinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function findBestTeams(playersWithScores) {
  const n = playersWithScores.length;
  if (n !== 10) return null;
  const half = 5;
  const EPS = 0.02;
  let best = null;

  const playersWithRoles = playersWithScores.map(p => ({ ...p, role: getPlaystyle(p) }));

  for (const teamA of combinations(playersWithRoles, half)) {
    const setA = new Set(teamA.map(p => p.id));
    const teamB = playersWithRoles.filter(p => !setA.has(p.id));
    
    const sumA = teamA.reduce((s, p) => s + p.score, 0);
    const sumB = teamB.reduce((s, p) => s + p.score, 0);
    const diff = Math.abs(sumA - sumB);

    let rolePenalty = 0;
    const roles = ['Фраггер', 'Снайпер', 'Саппорт'];
    roles.forEach(role => {
      const countA = teamA.filter(p => p.role === role).length;
      const countB = teamB.filter(p => p.role === role).length;
      if (countA !== countB) rolePenalty += Math.abs(countA - countB) * 0.15; 
    });

    const effectiveDiff = diff + rolePenalty;
    const maxGap = Math.abs(Math.max(...teamA.map(p=>p.score)) - Math.max(...teamB.map(p=>p.score)));
    const minGap = Math.abs(Math.min(...teamA.map(p=>p.score)) - Math.min(...teamB.map(p=>p.score)));
    
    const kdA = teamA.reduce((s, p) => s + (p.kd ?? 0), 0);
    const kdB = teamB.reduce((s, p) => s + (p.kd ?? 0), 0);
    const adrA = teamA.reduce((s, p) => s + (p.avgAdr ?? 0), 0);
    const adrB = teamB.reduce((s, p) => s + (p.avgAdr ?? 0), 0);

    const candidate = { teamA, teamB, sumA, sumB, diff: effectiveDiff, realDiff: diff, maxGap, minGap, kdA, kdB, adrA, adrB, rolePenalty };
    
    if (!best) { best = candidate; continue; }
    if (effectiveDiff < best.diff - EPS) { best = candidate; continue; }
    if (Math.abs(effectiveDiff - best.diff) <= EPS) {
      if (maxGap < best.maxGap - EPS) { best = candidate; continue; }
      if (Math.abs(maxGap - best.maxGap) <= EPS && minGap < best.minGap) {
        best = candidate;
      }
    }
  }
  return best;
}

function balanceQuality(diff) {
  if (diff <= 0.05) return { key: 'perfect', label: 'Идеально' };
  if (diff <= 0.15) return { key: 'good', label: 'Отлично' };
  if (diff <= 0.30) return { key: 'ok', label: 'Приемлемо' };
  return { key: 'bad', label: 'Слабо' };
}

function drawTeamColumn(ctx, title, players, sumScore, x, y, w, accentColor) {
  const TEXT = '#f0f3f8';
  const MUTED = '#8b96a5';
  const BORDER = '#262f40';
  const PANEL = '#151a25';

  ctx.fillStyle = PANEL;
  roundRectPath(ctx, x, y, w, 480, 12);
  ctx.fill();
  ctx.strokeStyle = BORDER;
  ctx.lineWidth = 1;
  ctx.stroke();

  const innerX = x + 24;
  const innerY = y + 24;

  ctx.textBaseline = 'top';
  ctx.fillStyle = TEXT;
  ctx.font = '700 22px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, innerX, innerY);

  ctx.fillStyle = accentColor;
  ctx.font = '700 22px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Σ ' + sumScore.toFixed(2), x + w - 24, innerY);
  ctx.textAlign = 'left';

  ctx.strokeStyle = BORDER;
  ctx.beginPath();
  ctx.moveTo(innerX, innerY + 44);
  ctx.lineTo(x + w - 24, innerY + 44);
  ctx.stroke();

  const sorted = [...players].sort((a, b) => b.score - a.score);
  let py = innerY + 72;
  for (const p of sorted) {
    const nameStr = String(displayName(p) || '?');
    const initial = nameStr.slice(0, 1).toUpperCase();

    ctx.fillStyle = accentColor + '33';
    ctx.beginPath();
    ctx.arc(innerX + 24, py + 16, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = accentColor;
    ctx.font = '700 18px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initial, innerX + 24, py + 17);

    let name = nameStr;
    if (name.length > 26) name = name.slice(0, 24) + '…';
    ctx.fillStyle = TEXT;
    ctx.font = '600 16px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, innerX + 60, py + 16);

    ctx.fillStyle = MUTED;
    ctx.font = '600 16px Inter, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(p.score.toFixed(2), x + w - 24, py + 16);
    ctx.textAlign = 'left';

    py += 64;
  }
}

function drawBalanceCard({ teamA, teamB, sumA, sumB, diff, quality, deltaKd, deltaAdr, tournamentName }) {
  const W = 1200, H = 800;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const BG = '#0b0e14';
  const TEXT = '#f0f3f8';
  const MUTED = '#8b96a5';
  const BORDER = '#262f40';
  const ACCENT = '#4d6bfe';

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(77,107,254,0.06)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  ctx.fillStyle = TEXT;
  ctx.font = '800 28px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('GEIMERI BALANCE', 60, 56);

  ctx.fillStyle = MUTED;
  ctx.font = '500 16px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(tournamentName || 'Все матчи', W - 60, 56);
  ctx.fillText('Состав сгенерирован ' + new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), W - 60, 80);
  ctx.textAlign = 'left';

  ctx.strokeStyle = BORDER;
  ctx.beginPath(); ctx.moveTo(60, 130); ctx.lineTo(W - 60, 130); ctx.stroke();

  const qColor = quality.key === 'perfect' ? '#10b981' : quality.key === 'good' ? ACCENT : quality.key === 'ok' ? '#f59e0b' : '#ef4444';
  const badgeText = quality.label + ' · Δscore ' + diff.toFixed(2);
  ctx.font = '600 14px Inter, system-ui, sans-serif';
  const badgeW = ctx.measureText(badgeText).width + 28;
  const badgeH = 32;
  const badgeX = 60, badgeY = 158;

  ctx.fillStyle = qColor + '26';
  roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 6);
  ctx.fill();
  ctx.strokeStyle = qColor + '4d';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = qColor;
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, badgeX + 14, badgeY + badgeH / 2);

  ctx.fillStyle = MUTED;
  ctx.font = '500 14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('Δ K/D ' + deltaKd.toFixed(2) + '   ·   Δ ADR ' + deltaAdr.toFixed(1), W - 60, badgeY + badgeH / 2);
  ctx.textAlign = 'left';

  const colY = 230;
  drawTeamColumn(ctx, 'Команда А', teamA, sumA, 60,  colY, 520, ACCENT);
  drawTeamColumn(ctx, 'Команда Б', teamB, sumB, 620, colY, 520, '#10b981');

  ctx.fillStyle = MUTED;
  ctx.font = '500 14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('GEIMERI • CS2 STATS', W / 2, H - 50);
  ctx.textAlign = 'left';

  return canvas;
}

function buildShareText(best, quality, deltaKd, deltaAdr, tournamentName, weights) {
  const lines = [];
  lines.push('Состав CS2 · ' + tournamentName);
  lines.push(quality.label + ' · Δscore ' + best.diff.toFixed(2) + ' · Δ K/D ' + deltaKd.toFixed(2) + ' · Δ ADR ' + deltaAdr.toFixed(1));
  if (best.rolePenalty > 0) lines.push('Учтены плейстайлы (фраггеры/саппорты разведены)');
  lines.push('');
  lines.push('Команда А (Σ ' + best.sumA.toFixed(2) + '):');
  for (const p of [...best.teamA].sort((a, b) => b.score - a.score)) {
    lines.push('  · ' + displayName(p) + ' — ' + p.score.toFixed(2) + ` [${p.role}]`);
  }
  lines.push('');
  lines.push('Команда Б (Σ ' + best.sumB.toFixed(2) + '):');
  for (const p of [...best.teamB].sort((a, b) => b.score - a.score)) {
    lines.push('  · ' + displayName(p) + ' — ' + p.score.toFixed(2) + ` [${p.role}]`);
  }
  lines.push('');
  const w = normalizeWeights(weights);
  lines.push('Веса: R ' + Math.round(w.rating * 100) + '% / K/D ' + Math.round(w.kd * 100) + '% / ADR ' + Math.round(w.adr * 100) + '% / KAST ' + Math.round(w.kast * 100) + '%');
  return lines.join('\n');
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) { return false; }
}

function initBalancer() {
  const openBtn = document.getElementById('open-balancer-btn');
  const modal = document.getElementById('balancer-modal');
  const searchInput = document.getElementById('player-search');
  const grid = document.getElementById('players-grid');
  const countLabel = document.getElementById('selected-count');
  const balanceBtn = document.getElementById('balance-btn');
  const randomBtn = document.getElementById('random-btn');
  const clearBtn = document.getElementById('clear-btn');
  const resultDiv = document.getElementById('balance-result');
  const mapActions = document.getElementById('map-actions');
  const mapResult = document.getElementById('map-result');
  const savedSection = document.getElementById('saved-teams-section');
  const savedContent = document.getElementById('saved-teams-content');
  if (!openBtn) return;

  const sliderRating = document.getElementById('weight-rating');
  const sliderKd = document.getElementById('weight-kd');
  const sliderAdr = document.getElementById('weight-adr');
  const sliderKast = document.getElementById('weight-kast'); 
  const valRating = document.getElementById('weight-rating-val');
  const valKd = document.getElementById('weight-kd-val');
  const valAdr = document.getElementById('weight-adr-val');
  const valKast = document.getElementById('weight-kast-val'); 
  const resetWeightsBtn = document.getElementById('reset-weights-btn');

  let currentWeights = getBalancerWeights();

  function syncSliderUI() {
    if (sliderRating) sliderRating.value = currentWeights.rating;
    if (sliderKd) sliderKd.value = currentWeights.kd;
    if (sliderAdr) sliderAdr.value = currentWeights.adr;
    if (sliderKast) sliderKast.value = currentWeights.kast;
    const n = normalizeWeights(currentWeights);
    if (valRating) valRating.innerText = Math.round(n.rating * 100) + '%';
    if (valKd) valKd.innerText = Math.round(n.kd * 100) + '%';
    if (valAdr) valAdr.innerText = Math.round(n.adr * 100) + '%';
    if (valKast) valKast.innerText = Math.round(n.kast * 100) + '%';
  }

  function applySliders() {
    currentWeights = {
      rating: parseFloat(sliderRating?.value ?? BALANCER_DEFAULTS.rating),
      kd: parseFloat(sliderKd?.value ?? BALANCER_DEFAULTS.kd),
      adr: parseFloat(sliderAdr?.value ?? BALANCER_DEFAULTS.adr),
      kast: parseFloat(sliderKast?.value ?? BALANCER_DEFAULTS.kast)
    };
    saveBalancerWeights(currentWeights);
    syncSliderUI();
  }

  if (sliderRating) sliderRating.addEventListener('input', applySliders);
  if (sliderKd) sliderKd.addEventListener('input', applySliders);
  if (sliderAdr) sliderAdr.addEventListener('input', applySliders);
  if (sliderKast) sliderKast.addEventListener('input', applySliders);
  
  if (resetWeightsBtn) resetWeightsBtn.onclick = () => {
    currentWeights = { ...BALANCER_DEFAULTS };
    saveBalancerWeights(currentWeights);
    syncSliderUI();
  };
  syncSliderUI();

  openBtn.onclick = () => {
    modal.style.display = 'block';
    selectedPlayers = [];
    searchInput.value = '';
    resultDiv.classList.remove('show');
    resultDiv.innerHTML = '';
    mapActions.classList.remove('show');
    mapResult.innerHTML = '';
    currentWeights = getBalancerWeights();
    syncSliderUI();
    updateUI();
    drawGrid();
    loadSaved();
  };
  window.closeBalancer = () => { modal.style.display = 'none'; };

  function drawGrid() {
    if (!grid) return;
    const q = searchInput.value;
    grid.innerHTML = currentStats.players.filter(p => matchesFilter(p, q)).map(p => {
      const sel = selectedPlayers.find(sp => sp.id === p.id);
      const role = getPlaystyle(p);
      let roleColor = 'var(--text-muted)';
      if (role === 'Фраггер') roleColor = '#ef4444';
      if (role === 'Снайпер') roleColor = '#f59e0b';
      if (role === 'Саппорт') roleColor = '#10b981';

      return `<div class="player-card ${sel ? 'selected' : ''}" onclick="togglePlayer('${p.id}')">
        <img src="${p.avatar}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">
        <div class="card-name">${displayName(p)}</div>
        <div class="card-rating" style="color:${p.rankColor || 'var(--text-muted)'};">${p.elo || '—'} ELO</div>
        <div style="font-size: 0.65rem; font-weight: bold; color: ${roleColor}">${role}</div>
      </div>`;
    }).join('');
  }

  window.togglePlayer = (id) => {
    const idx = selectedPlayers.findIndex(p => p.id === id);
    if (idx > -1) selectedPlayers.splice(idx, 1);
    else {
      if (selectedPlayers.length >= 10) { 
        countLabel.style.color = '#ef4444'; 
        showToast('Максимум 10 игроков', 'error');
        setTimeout(() => { countLabel.style.color = 'var(--accent)'; }, 500); 
        return; 
      }
      const p = currentStats.players.find(p => p.id === id);
      if (p) selectedPlayers.push(p);
    }
    updateUI();
    drawGrid();
  };

  function updateUI() {
    countLabel.innerText = `Выбрано: ${selectedPlayers.length} / 10`;
    balanceBtn.disabled = selectedPlayers.length !== 10;
    if (selectedPlayers.length === 10) mapActions.classList.add('show');
    else { mapActions.classList.remove('show'); mapResult.innerHTML = ''; }
    if (selectedPlayers.length !== 10) resultDiv.classList.remove('show');
  }

  searchInput.addEventListener('input', drawGrid);

  randomBtn.onclick = () => {
    const sh = [...currentStats.players].sort(() => Math.random() - 0.5);
    selectedPlayers = sh.slice(0, Math.min(10, sh.length));
    updateUI(); drawGrid();
  };
  clearBtn.onclick = () => { selectedPlayers = []; mapResult.innerHTML = ''; updateUI(); drawGrid(); };

  balanceBtn.onclick = () => {
    if (selectedPlayers.length !== 10) return;
    const pool = selectedPlayers.map(p => ({
      ...p,
      score: playerCompositeScore(p, currentWeights)
    }));
    const best = findBestTeams(pool);
    if (!best) return;
    
    const q = balanceQuality(best.realDiff); 
    const deltaKd = Math.abs((best.kdA - best.kdB) / 5);
    const deltaAdr = Math.abs((best.adrA - best.adrB) / 5);

    resultDiv.querySelectorAll('.balance-card-preview, .balance-share-actions').forEach(el => {
      if (el.dataset && el.dataset.url) URL.revokeObjectURL(el.dataset.url);
      el.remove();
    });

    const renderTeamBox = (name, team, sum) => `
      <div class="team-box"><h3>${name} <span>Σ ${sum.toFixed(2)}</span></h3>
      <ul>${[...team].sort((a,b)=>b.score-a.score).map(p => `
        <li>
          <div class="t-player">
            <img src="${p.avatar}">
            <div>
              <div>${displayName(p)}</div>
              <div style="font-size:0.65rem; color:var(--text-muted);">${p.role}</div>
            </div>
          </div>
          <span>${p.score.toFixed(2)}</span>
        </li>`).join('')}</ul></div>
    `;

    resultDiv.innerHTML = `
      <div class="balance-header-row">
        <span class="quality-badge ${q.key}">${q.label} · Δscore ${best.realDiff.toFixed(2)}</span>
        <span class="delta-row-inline">
          <span>Δ K/D <b>${deltaKd.toFixed(2)}</b></span>
          <span>Δ ADR <b>${deltaAdr.toFixed(1)}</b></span>
        </span>
      </div>
      ${renderTeamBox('Команда А', best.teamA, best.sumA)}
      ${renderTeamBox('Команда Б', best.teamB, best.sumB)}
    `;
    resultDiv.classList.add('show');
    savedSection.classList.remove('show');

    try {
      localStorage.setItem(getSavedKey(), JSON.stringify({
        teamA: best.teamA.map(p => ({ name: p.displayName || p.name, rating: p.score, avatar: p.avatar })),
        teamB: best.teamB.map(p => ({ name: p.displayName || p.name, rating: p.score, avatar: p.avatar })),
        savedAt: new Date().toISOString(),
        weights: currentWeights
      }));
    } catch (e) {}

    const tournamentName = document.getElementById('tournament-select').value || 'Все матчи';
    const cardCanvas = drawBalanceCard({
      teamA: best.teamA, teamB: best.teamB,
      sumA: best.sumA, sumB: best.sumB,
      diff: best.realDiff, quality: q,
      deltaKd, deltaAdr,
      tournamentName
    });

    cardCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const preview = document.createElement('div');
      preview.className = 'balance-card-preview';
      preview.dataset.url = url;
      preview.innerHTML = `<img src="${url}" alt="Карточка состава">`;
      resultDiv.appendChild(preview);

      const actions = document.createElement('div');
      actions.className = 'balance-share-actions';

      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn-outline';
      dlBtn.style.flex = '1';
      dlBtn.innerText = 'Скачать PNG';
      dlBtn.onclick = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'balance-' + (tournamentName.replace(/[^\wа-я-]+/gi, '_')) + '-' + Date.now() + '.png';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      };
      actions.appendChild(dlBtn);

      const file = new File([blob], 'balance.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        const shareBtn2 = document.createElement('button');
        shareBtn2.className = 'btn-outline';
        shareBtn2.style.flex = '1';
        shareBtn2.innerText = 'Поделиться';
        shareBtn2.onclick = async () => {
          try { await navigator.share({ files: [file], title: 'Состав команд', text: 'Состав для CS2' }); } catch (e) {}
        };
        actions.appendChild(shareBtn2);
      }

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-outline';
      copyBtn.style.flex = '1';
      copyBtn.innerText = 'Скопировать текст';
      copyBtn.onclick = async () => {
        const text = buildShareText(best, q, deltaKd, deltaAdr, tournamentName, currentWeights);
        const ok = await copyTextToClipboard(text);
        copyBtn.innerText = ok ? '✓ Скопировано' : 'Не удалось';
        setTimeout(() => { copyBtn.innerText = 'Скопировать текст'; }, 1800);
      };
      actions.appendChild(copyBtn);

      resultDiv.appendChild(actions);
    }, 'image/png');
  };

  document.getElementById('random-map-btn').onclick = () => {
    const names = currentStats.mapStats.map(m => m.map);
    if (!names.length) return;
    mapResult.innerHTML = `<div class="team-box" style="text-align:center;"><p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 6px;">Случайная карта:</p><h2 style="color: #4d6bfe; font-size: 1.5rem; margin: 0;">${names[Math.floor(Math.random() * names.length)]}</h2></div>`;
  };

  document.getElementById('balanced-map-btn').onclick = () => {
    let best = null;
    for (const ms of currentStats.mapStats) {
      const pool = [];
      let ok = true;
      for (const p of selectedPlayers) {
        const tp = ms.topPlayers.find(t => t.id === p.id);
        if (!tp) { ok = false; break; }
        pool.push({ ...p, score: mapPlayerCompositeScore(p, tp, currentWeights) });
      }
      if (!ok || pool.length !== 10) continue;
      const split = findBestTeams(pool);
      if (!split) continue;
      const candidate = { map: ms.map, matches: ms.matches, diff: split.diff, realDiff: split.realDiff, sumA: split.sumA, sumB: split.sumB };
      if (!best) { best = candidate; continue; }
      const EPS = 0.02;
      if (split.diff < best.diff - EPS ||
          (Math.abs(split.diff - best.diff) <= EPS && ms.matches > best.matches)) {
        best = candidate;
      }
    }
    if (!best) {
      mapResult.innerHTML = `<div class="team-box" style="text-align:center; border-color:#ef4444;"><p style="color:#ef4444; font-size:0.85rem;">Нет карты, где играли все 10 игроков</p></div>`;
      return;
    }
    mapResult.innerHTML = `<div class="team-box" style="text-align:center; border-color: #10b981;"><p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 6px;">Оптимальная карта:</p><h2 style="color: #10b981; font-size: 1.5rem; margin: 0 0 8px 0;">${best.map}</h2><p style="font-size: 0.8rem; color: var(--text-muted);">Δscore: <b style="color:#10b981;">${best.realDiff.toFixed(2)}</b> (${best.sumA.toFixed(2)} vs ${best.sumB.toFixed(2)}) · матчей на карте: ${best.matches}</p></div>`;
  };

  document.getElementById('clear-saved-btn').onclick = () => { localStorage.removeItem(getSavedKey()); savedSection.classList.remove('show'); savedContent.innerHTML = ''; };

  function loadSaved() {
    try {
      const raw = localStorage.getItem(getSavedKey());
      if (!raw) { savedSection.classList.remove('show'); return; }
      const d = JSON.parse(raw);
      const sA = d.teamA.reduce((s, p) => s + (p.rating || 0), 0);
      const sB = d.teamB.reduce((s, p) => s + (p.rating || 0), 0);
      savedContent.innerHTML = `<div class="balance-result-modal show" style="margin-top: 0;"><div class="team-box"><h3>Сохранено: Команда А <span>Σ ${sA.toFixed(2)}</span></h3><ul>${d.teamA.map(p => `<li><div class="t-player"><img src="${p.avatar}">${aliasText(p.name)}</div><span>${p.rating.toFixed(2)}</span></li>`).join('')}</ul></div><div class="team-box"><h3>Сохранено: Команда Б <span>Σ ${sB.toFixed(2)}</span></h3><ul>${d.teamB.map(p => `<li><div class="t-player"><img src="${p.avatar}">${aliasText(p.name)}</div><span>${p.rating.toFixed(2)}</span></li>`).join('')}</ul></div></div>`;
      savedSection.classList.add('show');
    } catch (e) {}
  }
}

// ============ ОБРАТНАЯ СВЯЗЬ ============
document.getElementById('feedback-btn').onclick = () => {
  document.getElementById('feedback-modal').style.display = 'block';
};
window.closeFeedback = () => {
  document.getElementById('feedback-modal').style.display = 'none';
};
document.getElementById('send-feedback-btn').onclick = () => {
  const text = document.getElementById('feedback-text').value.trim();
  if (!text) return showToast('Введите текст', 'error');
  
  try {
    const feedbacks = JSON.parse(localStorage.getItem('feedbacks') || '[]');
    feedbacks.push({ text, date: new Date().toISOString() });
    localStorage.setItem('feedbacks', JSON.stringify(feedbacks));
    showToast('Спасибо! Отзыв сохранен.', 'success');
    document.getElementById('feedback-text').value = '';
    closeFeedback();
  } catch (e) {
    showToast('Ошибка при сохранении', 'error');
  }
};

// ============ РЕЖИМ НОВИЧКА ============
function initBeginnerMode() {
  const btn = document.getElementById('beginner-toggle');
  if (!btn) return;
  const isActive = localStorage.getItem('beginnerMode') === '1';
  if (isActive) { document.body.classList.add('beginner-mode'); btn.classList.add('active'); }
  btn.onclick = () => {
    const active = document.body.classList.toggle('beginner-mode');
    localStorage.setItem('beginnerMode', active ? '1' : '0');
    btn.classList.toggle('active', active);
  };
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.AOS) AOS.init({ duration: 600, once: true });
  if (window.lucide) lucide.createIcons();
  
  initTabs();
  loadData();
  initBalancer();
  initBeginnerMode();
});