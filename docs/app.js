// app.js — точка входа, рендер, обработчики
window.onerror = function (message, source, lineno) {
  const meta = document.getElementById('meta-info');
  if (meta) meta.innerHTML = `<span style="color:#ef4444;">Ошибка: ${escapeHtml(message)} (строка ${lineno})</span>`;
  console.error(message);
};

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}

// ===== ГЛОБАЛЬНОЕ СОСТОЯНИЕ =====
let statsData = null;
let currentStats = null;
let profChart = null;
let profRadarChart = null;
let selectedPlayers = [];
let currentMapSort = { key: 'matches', dir: 'desc' };
let draftParticipants = [];

// ===== УТИЛИТЫ =====
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

// ===== АЛИАСЫ =====
const ALIAS_BY_ID = new Map([['76561199109745015', 'q1nce_']]);
const PLAYER_ALIASES_BY_NAME = new Map([
  ['BB-00 (5015)', 'q1nce_'],
  ['Unknown', 'St1gmat'],
  ['unknown', 'St1gmat']
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

// ===== PERSIST ФИЛЬТРОВ =====
const LS_KEYS = {
  tournament: 'geimeri:lastTournament',
  filter: 'geimeri:filterName',
  sort: 'geimeri:sortBy',
  tab: 'geimeri:lastTab'
};

function saveFilter(key, val) {
  try { localStorage.setItem(LS_KEYS[key], val); } catch (e) {}
}
function getFilter(key) {
  try { return localStorage.getItem(LS_KEYS[key]); } catch (e) { return null; }
}

// ===== TABS =====
function initTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const el = document.getElementById(`tab-${target}`);
      if (el) el.classList.add('active');
      saveFilter('tab', target);
      if (window.lucide) lucide.createIcons();
    });
  });

  const savedTab = getFilter('tab');
  if (savedTab) {
    const savedBtn = document.querySelector(`.tab-btn[data-tab="${savedTab}"]`);
    if (savedBtn) savedBtn.click();
  }
}

// ===== ЗАГРУЗКА =====
async function loadData(retry = 2) {
  try {
    const res = await fetch('data/stats.json');
    if (!res.ok) throw new Error(`stats.json не найден (HTTP ${res.status})`);
    const text = await res.text();
    if (!text) throw new Error('stats.json пустой (запустите npm run build)');

    statsData = JSON.parse(text);
    if (!statsData.tournaments) throw new Error('Нет поля tournaments');

    const select = document.getElementById('tournament-select');
    const keys = Object.keys(statsData.tournaments);
    select.innerHTML = keys.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');

    const savedT = getFilter('tournament');
    if (savedT && statsData.tournaments[savedT]) {
      select.value = savedT;
      currentStats = statsData.tournaments[savedT];
    } else {
      currentStats = statsData.tournaments['Все матчи'];
    }

    select.addEventListener('change', (e) => {
      currentStats = statsData.tournaments[e.target.value];
      selectedPlayers = [];
      saveFilter('tournament', e.target.value);
      renderAll();
    });

    const fInput = document.getElementById('filter-name');
    const sInput = document.getElementById('sort-by');
    const savedF = getFilter('filter');
    const savedS = getFilter('sort');
    if (savedF && fInput) fInput.value = savedF;
    if (savedS && sInput) sInput.value = savedS;

    renderAll();
  } catch (err) {
    if (retry > 0) {
      console.warn(`Загрузка не удалась, повтор через 2с (осталось попыток: ${retry})`);
      setTimeout(() => loadData(retry - 1), 2000);
      return;
    }
    document.getElementById('meta-info').innerHTML =
      `<span style="color:#ef4444;">${escapeHtml(err.message)}</span>`;
    console.error(err);
  }
}

function renderAll() {
  try {
    document.getElementById('meta-info').innerHTML =
      `Матчей: <b>${currentStats.recentMatches ? currentStats.recentMatches.length : 0}</b>`;
    if (currentStats.funStats) {
      document.getElementById('stat-kills').innerText = currentStats.funStats.totalKills || 0;
      document.getElementById('stat-deaths').innerText = currentStats.funStats.totalDeaths || 0;
      document.getElementById('stat-hours').innerText = (currentStats.funStats.totalHours || 0) + ' ч.';
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
    document.getElementById('meta-info').innerHTML =
      `<span style="color:#ef4444;">Ошибка рендера: ${escapeHtml(e.message)}</span>`;
    console.error(e);
  }
}

// ===== ПЬЕДЕСТАЛ =====
function renderPodium() {
  const container = document.getElementById('podium-container');
  if (!container || !currentStats.players) return;
  const top3 = currentStats.players.slice(0, 3);
  if (top3.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);">Нет игроков</p>';
    return;
  }
  const order = [1, 0, 2];
  const classes = ['podium-2', 'podium-1', 'podium-3'];
  const ranks = ['2 место', '1 место', '3 место'];
  container.innerHTML = order.map((idx, i) => {
    const p = top3[idx];
    if (!p) return '';
    const avatar = escapeHtml(p.avatar || '');
    const safeName = escapeHtml(displayName(p));
    return `<div class="podium-card ${classes[i]}" onclick="openProfile('${escapeHtml(p.id)}')">
      <div class="podium-rank">${ranks[i]}</div>
      <img src="${avatar}" class="podium-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">
      <div class="podium-name">${safeName}</div>
      <div class="podium-rating" style="color:${escapeHtml(p.rankColor || 'var(--accent)')};">${p.elo ?? 1000} <span style="font-size:0.7rem;">ELO</span></div>
    </div>`;
  }).join('');
}

// ===== ПОСЛЕДНИЕ МАТЧИ (модалка) =====
function renderRecentMatches() {
  const container = document.getElementById('recent-matches-container');
  if (!container || !currentStats.recentMatches) return;
  if (currentStats.recentMatches.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);">Матчей пока нет</p>';
    return;
  }
  container.innerHTML = currentStats.recentMatches.map(m => {
    const date = new Date(m.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const maps = (m.maps || []).map(mm => escapeHtml(mm)).join(' · ');
    return `<div class="recent-match-item" onclick="openMatchDetails('${escapeHtml(m.matchId)}')" style="cursor:pointer;">
      <div class="recent-match-left">
        <span class="recent-match-date">${escapeHtml(date)}</span>
        <span class="recent-match-maps">${maps}</span>
      </div>
      <div class="recent-match-right"><span>Подробнее</span><span style="font-size:1.2rem;">→</span></div>
    </div>`;
  }).join('');
}

// ===== ФАКТЫ =====
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
    <div class="fun-fact-item" ${i.playerId ? `onclick="openProfile('${escapeHtml(i.playerId)}')" style="cursor:pointer;"` : ''}>
      <div class="fact-title">${escapeHtml(i.title)}</div>
      <div class="fact-player">${escapeHtml(i.player)}</div>
      <div class="fact-desc">${escapeHtml(i.desc)}</div>
    </div>
  `).join('');
}

// ===== РЕКОРДЫ =====
function renderRecords() {
  if (!currentStats.records) return;
  const r = currentStats.records;
  const killRec = (r.maxKills && r.maxKills.value > 0) ? r.maxKills : null;
  const deathRec = (r.maxDeaths && r.maxDeaths.value > 0) ? r.maxDeaths : null;
  const adrRec = (r.maxAdr && r.maxAdr.value > 0) ? r.maxAdr : null;

  document.getElementById('rec-max-kills').innerText = killRec ? killRec.value : '—';
  document.getElementById('rec-max-kills-desc').innerHTML = killRec ? `<b>${escapeHtml(aliasText(killRec.player))}</b><br><span>${escapeHtml(killRec.map)}</span>` : 'Нет данных';
  document.getElementById('rec-max-deaths').innerText = deathRec ? deathRec.value : '—';
  document.getElementById('rec-max-deaths-desc').innerHTML = deathRec ? `<b>${escapeHtml(aliasText(deathRec.player))}</b><br><span>${escapeHtml(deathRec.map)}</span>` : 'Нет данных';
  document.getElementById('rec-max-adr').innerText = adrRec ? adrRec.value : '—';
  document.getElementById('rec-max-adr-desc').innerHTML = adrRec ? `<b>${escapeHtml(aliasText(adrRec.player))}</b><br><span>${escapeHtml(adrRec.map)}</span>` : 'Нет данных';

  document.getElementById('card-rec-kills').onclick = killRec ? () => openRecordDetails('maxKills') : null;
  document.getElementById('card-rec-deaths').onclick = deathRec ? () => openRecordDetails('maxDeaths') : null;
  document.getElementById('card-rec-adr').onclick = adrRec ? () => openRecordDetails('maxAdr') : null;
}

function openRecordDetails(type) {
  const rec = currentStats.records[type];
  if (!rec || !rec.player) return;
  const player = currentStats.players.find(p => p.id === rec.playerId || p.name === rec.player);
  const titleText = type === 'maxKills' ? 'Рекорд: макс. убийств'
    : type === 'maxDeaths' ? 'Антирекорд: макс. смертей'
    : 'Рекорд: макс. ADR';
  document.getElementById('record-title').innerText = titleText;
  const avatar = player?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(rec.player)}&background=4d6bfe&color=fff`;
  const date = rec.date ? new Date(rec.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const playerId = rec.playerId || player?.id;
  const matchUrl = rec.matchId ? `https://cybershoke.net/ru/match/${rec.matchId}` : '#';

  document.getElementById('record-content').innerHTML = `
    <div style="text-align:center; margin-bottom:20px;">
      <img src="${escapeHtml(avatar)}" style="width:80px; height:80px; border-radius:50%; margin-bottom:10px; cursor:pointer;" onclick="openProfile('${escapeHtml(playerId)}')">
      <h3 style="cursor:pointer; color:var(--accent);" onclick="openProfile('${escapeHtml(playerId)}')">${escapeHtml(aliasText(rec.player))}</h3>
      <p style="color:var(--text-muted); font-size:0.85rem;">${escapeHtml(rec.map)} · ${escapeHtml(date)}</p>
    </div>
    <div style="background:var(--bg-main); border:1px solid var(--border); border-radius:8px; padding:15px; text-align:center; margin-bottom:15px;">
      <div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; margin-bottom:5px;">${type === 'maxDeaths' ? 'Смертей' : type === 'maxAdr' ? 'ADR' : 'Убийств'}</div>
      <div style="font-size:2.5rem; font-weight:800; color:var(--accent);">${escapeHtml(rec.value)}</div>
    </div>
    ${rec.matchId ? `<a href="${escapeHtml(matchUrl)}" target="_blank" class="btn-primary" style="display:block; text-align:center; text-decoration:none; padding:12px;">Открыть матч на Cybershoke</a>` : ''}
  `;
  document.getElementById('record-modal').style.display = 'block';
}
function closeRecordDetails() {
  document.getElementById('record-modal').style.display = 'none';
}

// ===== ТАБЛИЦА ИГРОКОВ =====
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
      if (sortKey === 'rating') return (b.avgRating ?? 0) - (a.avgRating ?? 0);
      return (b.elo ?? 1000) - (a.elo ?? 1000);
    });
    tbody.innerHTML = players.map((p) => {
      let formText = '';
      if (p.form === 'hot') formText = '<span style="color:#10b981;">В форме</span>';
      else if (p.form === 'cold') formText = '<span style="color:#ef4444;">Спад</span>';
      else if (p.form === 'new') formText = '<span style="color:#f59e0b;">Мало данных</span>';
      else formText = '<span style="color:var(--text-muted);">Стабильно</span>';

      return `<tr>
        <td><div class="player-cell">
          <img src="${escapeHtml(p.avatar)}" class="player-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">
          <div><strong class="player-link" onclick="openProfile('${escapeHtml(p.id)}')">${escapeHtml(displayName(p))}</strong></div>
        </div></td>
        <td><span style="color:${escapeHtml(p.rankColor || 'var(--accent)')}; font-weight:bold;">${p.elo ?? 1000}</span></td>
        <td>${formText}</td>
        <td>${p.matches}</td>
        <td><strong>${escapeHtml(p.kd)}</strong></td>
        <td style="color:var(--accent); font-weight:600;">${escapeHtml(p.avgRating ?? '—')}</td>
      </tr>`;
    }).join('');
  }

  filterInput.oninput = () => { saveFilter('filter', filterInput.value); draw(); };
  sortSelect.onchange = () => { saveFilter('sort', sortSelect.value); draw(); };
  draw();
}

// ===== КАРТЫ =====
function renderMapStats() {
  const tbody = document.querySelector('#maps-table tbody');
  if (!tbody || !currentStats.mapStats) return;
  function draw() {
    let data = [...currentStats.mapStats];
    const key = currentMapSort.key;
    const dir = currentMapSort.dir === 'asc' ? 1 : -1;
    data.sort((a, b) => key === 'map' ? a.map.localeCompare(b.map) * dir : (a[key] - b[key]) * dir);
    tbody.innerHTML = data.map(m => `<tr class="map-row" onclick="openMapDetails('${escapeHtml(m.map)}')"><td><strong>${escapeHtml(m.map)}</strong></td><td>${m.matches}</td><td>${escapeHtml(m.avgKd)}</td><td style="color:var(--accent); font-weight:600;">${escapeHtml(m.avgRating)}</td></tr>`).join('');
  }
  document.querySelectorAll('#maps-table .sortable').forEach(th => {
    if (th.dataset.listenerAttached) return;
    th.dataset.listenerAttached = 'true';
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (currentMapSort.key === key) currentMapSort.dir = currentMapSort.dir === 'asc' ? 'desc' : 'asc';
      else { currentMapSort.key = key; currentMapSort.dir = 'desc'; }
      document.querySelectorAll('#maps-table .sortable').forEach(t => {
        t.classList.remove('asc', 'desc');
        const arrow = t.querySelector('.sort-arrow');
        if (arrow) arrow.textContent = '⬍';
      });
      th.classList.add(currentMapSort.dir);
      const arrow = th.querySelector('.sort-arrow');
      if (arrow) arrow.textContent = currentMapSort.dir === 'asc' ? '▲' : '▼';
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
      <td><div class="player-cell" style="cursor:pointer;" onclick="openProfile('${escapeHtml(p.id)}')">
        <img src="${escapeHtml(p.avatar)}" class="player-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">
        <strong>${escapeHtml(displayName(p))}</strong>
      </div></td>
      <td>${p.matches}</td>
      <td>${p.kills}</td>
      <td>${p.deaths}</td>
      <td>${escapeHtml(p.kd)}</td>
      <td style="color:var(--accent); font-weight:600;">${escapeHtml(p.avgRating)}</td>
    </tr>
  `).join('');
  document.getElementById('map-modal').style.display = 'block';
}
function closeMapDetails() {
  document.getElementById('map-modal').style.display = 'none';
}

// ===== МАТЧ =====
function openMatchDetails(matchId) {
  if (!matchId) return showToast('Нет ID матча', 'error');
  const match = statsData.allMatches ? statsData.allMatches.find(m => m.matchId === matchId) : null;
  if (!match) return showToast('Данные матча не найдены', 'error');

  let contentHtml = '';
  for (const mapData of match.maps) {
    const players = [...mapData.players].sort((a, b) => (b.rating || 0) - (a.rating || 0));
    contentHtml += `
      <div style="margin-bottom:24px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--border); padding-bottom:8px;">
          <h3 style="margin:0; color:var(--accent); font-size:1.1rem;">${escapeHtml(mapData.map)}</h3>
          <a href="https://cybershoke.net/ru/match/${escapeHtml(matchId)}" target="_blank" class="btn-outline" style="font-size:0.75rem; padding:4px 8px;">На Cybershoke ↗</a>
        </div>
        <div class="table-container">
          <table class="stats-table">
            <thead><tr><th>Игрок</th><th>K</th><th>D</th><th>A</th><th>ADR</th><th>KAST</th><th>Rating</th></tr></thead>
            <tbody>
              ${players.map(p => {
                const playerObj = currentStats.players.find(sp => sp.id === p.id) || p;
                const ava = playerObj.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff`;
                return `<tr>
                  <td><div class="player-cell"><img src="${escapeHtml(ava)}" class="player-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'"><strong>${escapeHtml(displayName(p))}</strong></div></td>
                  <td>${p.kills}</td><td>${p.deaths}</td><td>${p.assists}</td>
                  <td>${escapeHtml(p.adr ?? '—')}</td><td>${escapeHtml(p.kast ?? '—')}</td><td style="color:#10b981; font-weight:600;">${escapeHtml(p.rating ?? '—')}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  document.getElementById('match-modal-title').innerText = 'Детали матча';
  document.getElementById('match-modal-content').innerHTML = contentHtml;
  document.getElementById('match-modal').style.display = 'block';
}
function closeMatchDetails() {
  document.getElementById('match-modal').style.display = 'none';
}

// ===== DUEL =====
function initDuel() {
  const p1Select = document.getElementById('duel-p1');
  const p2Select = document.getElementById('duel-p2');
  const btn = document.getElementById('duel-btn');
  const resultDiv = document.getElementById('duel-result');
  const options = currentStats.players.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(displayName(p))}</option>`).join('');
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
    const winnerName = (p1.avgRating ?? p1.kd) > (p2.avgRating ?? p2.kd) ? displayName(p1) : displayName(p2);
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div class="duel-row"><span class="${kd1}">${p1.kd} K/D</span><span style="font-weight:bold;color:var(--text-muted);">K/D</span><span class="${kd2}">${p2.kd} K/D</span></div>
      <div class="duel-row"><span class="${rat1}">${p1.avgRating ?? '—'} Рейтинг</span><span style="font-weight:bold;color:var(--text-muted);">Рейтинг</span><span class="${rat2}">${p2.avgRating ?? '—'} Рейтинг</span></div>
      <div class="duel-row"><span class="${adr1}">${p1.avgAdr ?? '—'} ADR</span><span style="font-weight:bold;color:var(--text-muted);">ADR</span><span class="${adr2}">${p2.avgAdr ?? '—'} ADR</span></div>
      <div class="duel-row"><span class="${kast1}">${p1.avgKast ?? '—'} KAST</span><span style="font-weight:bold;color:var(--text-muted);">KAST</span><span class="${kast2}">${p2.avgKast ?? '—'} KAST</span></div>
      <div style="text-align:center; margin-top:15px; font-weight:bold; color:#fff;">Победитель: <span style="color:#10b981;">${escapeHtml(winnerName)}</span></div>
    `;
  };
}

// ===== ПРОФИЛЬ =====
function openProfile(playerId) {
  const p = currentStats.players.find(pl => pl.id === playerId);
  if (!p) return;
  const img = document.getElementById('prof-avatar');
  img.src = p.avatar;
  img.onerror = function () {
    this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true&size=128`;
  };

  document.getElementById('prof-name').innerHTML = `${escapeHtml(displayName(p))}
    <span style="font-size:0.8rem; padding:2px 6px; border-radius:4px; background:${escapeHtml(p.rankColor || '#4d6bfe')}33; color:${escapeHtml(p.rankColor || '#4d6bfe')}; border:1px solid ${escapeHtml(p.rankColor || '#4d6bfe')}; margin-left:8px; white-space:nowrap;">${p.elo ?? 1000} ELO</span>`;

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
          showToast('У этого игрока нет FACEIT', 'error');
        }
      } catch (err) {
        newTab.close();
        showToast('Не удалось найти FACEIT', 'error');
      } finally {
        faceitBtn.innerText = 'FACEIT';
        faceitBtn.disabled = false;
      }
    };
  }

  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) shareBtn.onclick = () => {
    const text = encodeURIComponent(`Статистика: ${displayName(p)}\nРейтинг: ${p.avgRating || 0}\nK/D: ${p.kd}\nADR: ${p.avgAdr || 0}\nПодробнее:`);
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
    const playersTab = document.querySelector('[data-tab="players"]');
    if (playersTab) playersTab.classList.add('active');
    const playersContent = document.getElementById('tab-players');
    if (playersContent) playersContent.classList.add('active');
    setTimeout(() => document.getElementById('duel-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
  };

  const tbody = document.getElementById('prof-match-history');
  const history = [...(p.matchHistory || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  tbody.innerHTML = history.map(h => {
    const d = new Date(h.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    let eloHtml = '<span style="color:var(--text-muted);">0</span>';
    if (h.eloChange > 0) eloHtml = `<span style="color:#10b981; font-weight:bold;">+${h.eloChange}</span>`;
    if (h.eloChange < 0) eloHtml = `<span style="color:#ef4444; font-weight:bold;">${h.eloChange}</span>`;
    return `<tr class="match-history-row" style="cursor:pointer;" onclick="openMatchDetails('${escapeHtml(h.matchId)}')">
      <td>${escapeHtml(d)}</td>
      <td>${escapeHtml(h.map)}</td>
      <td>${h.kills}</td>
      <td>${h.deaths}</td>
      <td>${h.assists}</td>
      <td>${escapeHtml(h.adr ?? '—')}</td>
      <td>${escapeHtml(h.kast ?? '—')}</td>
      <td style="color:var(--accent); font-weight:600;">${escapeHtml(h.rating ?? '—')}</td>
      <td>${eloHtml}</td>
    </tr>`;
  }).join('');

  // Line chart
  const canvas = document.getElementById('prof-chart');
  if (profChart) { profChart.destroy(); profChart = null; }
  if (p.history && p.history.length > 1) {
    const sortedHist = [...p.history].sort((a, b) => new Date(a.date) - new Date(b.date));
    profChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: sortedHist.map(h => new Date(h.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit' })),
        datasets: [{
          label: 'Рейтинг',
          data: sortedHist.map(h => h.rating),
          borderColor: '#4d6bfe',
          backgroundColor: 'rgba(77, 107, 254, 0.1)',
          fill: true, tension: 0.3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#8b96a5', maxRotation: 45, minRotation: 45 } },
          y: { grid: { color: '#262f40' }, ticks: { color: '#8b96a5' } }
        }
      }
    });
  }

  // Radar
  const radarCanvas = document.getElementById('prof-radar-chart');
  if (radarCanvas) {
    if (profRadarChart) { profRadarChart.destroy(); profRadarChart = null; }
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
          { label: 'Игрок', data: playerData, borderColor: '#4d6bfe', backgroundColor: 'rgba(77, 107, 254, 0.3)', pointBackgroundColor: '#4d6bfe', borderWidth: 2 },
          { label: 'Среднее по серверу', data: serverData, borderColor: '#8b96a5', backgroundColor: 'rgba(139, 150, 165, 0.1)', pointBackgroundColor: '#8b96a5', borderDash: [5, 5], borderWidth: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#8b96a5', font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (context) {
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
            angleLines: { color: '#262f40' }, grid: { color: '#262f40' },
            pointLabels: { color: '#f0f3f8', font: { size: 12, weight: 'bold' } },
            ticks: { display: false, min: 0, max: 100 }
          }
        }
      }
    });
  }

  document.getElementById('profile-modal').style.display = 'block';
}

function closeProfile() {
  document.getElementById('profile-modal').style.display = 'none';
  if (profChart) { profChart.destroy(); profChart = null; }
  if (profRadarChart) { profRadarChart.destroy(); profRadarChart = null; }
}

window.onclick = function (event) {
  if (event.target == document.getElementById('profile-modal')) closeProfile();
  if (event.target == document.getElementById('map-modal')) closeMapDetails();
  if (event.target == document.getElementById('match-modal')) closeMatchDetails();
  if (event.target == document.getElementById('record-modal')) closeRecordDetails();
  if (event.target == document.getElementById('balancer-modal')) closeBalancer();
  if (event.target == document.getElementById('feedback-modal')) closeFeedback();
};

// ===== БАЛАНСИРОВЩИК =====
function getSavedKey() {
  const sel = document.getElementById('tournament-select');
  return `savedTeams_${sel ? sel.value : 'default'}`;
}

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

function getPlaystyle(p) {
  if (!p || p.matches < 3) return 'Универсал';
  const adr = p.avgAdr || 0;
  const kd = p.kd || 0
