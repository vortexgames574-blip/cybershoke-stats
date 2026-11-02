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
let selectedPlayers = [];
let currentMapSort = { key: 'matches', dir: 'desc' };
let bracketState = null;

let peer = null;
let isHost = false;
let hostConn = null;
let clients = [];
let onlineRoomState = null;
let myNickname = "";

// ============ ИНИЦИАЛИЗАЦИЯ ТАБОВ ============
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
      
      if (target === 'bracket') renderBracket();
      if (target === 'draft') initOnlineDraftTab();
      
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
      bracketState = null;
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
    initBracketTab();
  } catch (e) {
    document.getElementById('meta-info').innerHTML = `<span style="color: #ef4444;">Ошибка рендера: ${e.message}</span>`;
    console.error(e);
  }
}

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
      <div class="podium-name">${p.displayName || p.name}</div>
      <div class="podium-rating">${p.avgRating ?? p.kd}</div>
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
  if (ff.mostStable) items.push({ title: 'Самый стабильный', player: ff.mostStable.player, desc: `Разброс рейтинга ±${ff.mostStable.stdDev}` });
  if (ff.highestPeak) items.push({ title: 'Пиковый рейтинг', player: ff.highestPeak.player, desc: `${ff.highestPeak.rating.toFixed(2)} на ${ff.highestPeak.map}` });
  if (ff.lowestRating) items.push({ title: 'Худший матч', player: ff.lowestRating.player, desc: `${ff.lowestRating.rating.toFixed(2)} на ${ff.lowestRating.map}` });
  if (ff.favoriteMap) items.push({ title: 'Любимая карта', player: ff.favoriteMap.map, desc: `${ff.favoriteMap.matches} игр` });
  container.innerHTML = items.map(i => `<div class="fun-fact-item"><div class="fact-title">${i.title}</div><div class="fact-player">${i.player}</div><div class="fact-desc">${i.desc}</div></div>`).join('');
}

function renderRecords() {
  if (!currentStats.records) return;
  const r = currentStats.records;
  const killRec = (r.maxKills && r.maxKills.value > 0) ? r.maxKills : null;
  const deathRec = (r.maxDeaths && r.maxDeaths.value > 0) ? r.maxDeaths : null;
  const adrRec = (r.maxAdr && r.maxAdr.value > 0) ? r.maxAdr : null;
  document.getElementById('rec-max-kills').innerText = killRec ? killRec.value : '—';
  document.getElementById('rec-max-kills-desc').innerHTML = killRec ? `<b>${killRec.player}</b><br><span>${killRec.map}</span>` : 'Нет данных';
  document.getElementById('rec-max-deaths').innerText = deathRec ? deathRec.value : '—';
  document.getElementById('rec-max-deaths-desc').innerHTML = deathRec ? `<b>${deathRec.player}</b><br><span>${deathRec.map}</span>` : 'Нет данных';
  document.getElementById('rec-max-adr').innerText = adrRec ? adrRec.value : '—';
  document.getElementById('rec-max-adr-desc').innerHTML = adrRec ? `<b>${adrRec.player}</b><br><span>${adrRec.map}</span>` : 'Нет данных';
  document.getElementById('card-rec-kills').onclick = killRec ? () => openMapDetails(killRec.map) : null;
  document.getElementById('card-rec-deaths').onclick = deathRec ? () => openMapDetails(deathRec.map) : null;
  document.getElementById('card-rec-adr').onclick = adrRec ? () => openMapDetails(adrRec.map) : null;
}

function renderPlayersTable() {
  const tbody = document.querySelector('#players-table tbody');
  const filterInput = document.getElementById('filter-name');
  const sortSelect = document.getElementById('sort-by');
  function draw() {
    const filter = filterInput.value.toLowerCase();
    const sortKey = sortSelect.value;
    let players = [...currentStats.players].filter(p => (p.displayName || p.name).toLowerCase().includes(filter));
    players.sort((a, b) => {
      if (sortKey === 'deaths') return b.deaths - a.deaths;
      if (sortKey === 'kd') return b.kd - a.kd;
      return (b.avgRating ?? 0) - (a.avgRating ?? 0);
    });
    tbody.innerHTML = players.map((p) => {
      let formText = '';
      if (p.form === 'hot') formText = '<span style="color: #10b981;">В форме</span>';
      else if (p.form === 'cold') formText = '<span style="color: #ef4444;">Спад</span>';
      else if (p.form === 'new') formText = '<span style="color: #f59e0b;">Мало данных</span>';
      else formText = '<span style="color: var(--text-muted);">Стабильно</span>';
      return `<tr>
        <td><div class="player-cell"><img src="${p.avatar}" class="player-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'"><div><strong class="player-link" onclick="openProfile('${p.id}')">${p.displayName || p.name}</strong></div></div></td>
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
  tbody.innerHTML = mapData.topPlayers.map((p) => `<tr><td><div class="player-cell"><img src="${p.avatar}" class="player-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'"><strong>${p.name}</strong></div></td><td>${p.matches}</td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.kd}</td><td style="color: var(--accent); font-weight: 600;">${p.avgRating}</td></tr>`).join('');
  document.getElementById('map-modal').style.display = 'block';
}
function closeMapDetails() { document.getElementById('map-modal').style.display = 'none'; }

function initDuel() {
  const p1Select = document.getElementById('duel-p1');
  const p2Select = document.getElementById('duel-p2');
  const btn = document.getElementById('duel-btn');
  const resultDiv = document.getElementById('duel-result');
  const options = currentStats.players.map(p => `<option value="${p.id}">${p.displayName || p.name}</option>`).join('');
  p1Select.innerHTML = options;
  p2Select.innerHTML = options;
  btn.onclick = () => {
    const p1 = currentStats.players.find(p => p.id === p1Select.value);
    const p2 = currentStats.players.find(p => p.id === p2Select.value);
    if (!p1 || !p2) return;
    if (p1.id === p2.id) return alert('Выберите двух разных игроков');
    const compare = (v1, v2) => v1 === v2 ? ['', ''] : (v1 > v2 ? ['duel-winner', 'duel-loser'] : ['duel-loser', 'duel-winner']);
    const [kd1, kd2] = compare(p1.kd, p2.kd);
    const [rat1, rat2] = compare(p1.avgRating ?? 0, p2.avgRating ?? 0);
    const [adr1, adr2] = compare(p1.avgAdr ?? 0, p2.avgAdr ?? 0);
    const [kast1, kast2] = compare(p1.avgKast ?? 0, p2.avgKast ?? 0);
    const winnerName = (p1.avgRating ?? p1.kd) > (p2.avgRating ?? p2.kd) ? (p1.displayName || p1.name) : (p2.displayName || p2.name);
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

function openProfile(playerId) {
  const p = currentStats.players.find(pl => pl.id === playerId);
  if (!p) return;
  const img = document.getElementById('prof-avatar');
  img.src = p.avatar;
  img.onerror = function() { this.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true&size=128`; };
  document.getElementById('prof-name').innerText = p.displayName || p.name;
  document.getElementById('prof-matches').innerText = p.matches;
  document.getElementById('prof-kd').innerText = p.kd;
  document.getElementById('prof-rating').innerText = p.avgRating ?? '—';
  document.getElementById('prof-adr').innerText = p.avgAdr ?? '—';
  document.getElementById('prof-kast').innerText = p.avgKast ?? '—';
  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) shareBtn.onclick = () => {
    const text = encodeURIComponent(`Статистика: ${p.displayName || p.name}\nРейтинг: ${p.avgRating || 0}\nK/D: ${p.kd}\nADR: ${p.avgAdr || 0}\nПодробнее:`);
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
    const d = new Date(h.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    return `<tr><td>${d}</td><td>${h.map}</td><td>${h.kills}</td><td>${h.deaths}</td><td>${h.assists}</td><td>${h.adr ?? '—'}</td><td>${h.kast ?? '—'}</td><td style="color: var(--accent); font-weight: 600;">${h.rating ?? '—'}</td></tr>`;
  }).join('');
  const canvas = document.getElementById('prof-chart');
  if (profChart) profChart.destroy();
  if (p.history && p.history.length > 1) {
    const sortedHist = [...p.history].sort((a,b) => new Date(a.date) - new Date(b.date));
    profChart = new Chart(canvas, {
      type: 'line',
      data: { labels: sortedHist.map(h => new Date(h.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })), datasets: [{ label: 'Рейтинг', data: sortedHist.map(h => h.rating), borderColor: '#4d6bfe', backgroundColor: 'rgba(77, 107, 254, 0.1)', fill: true, tension: 0.3 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: '#8b96a5' } }, y: { grid: { color: '#262f40' }, ticks: { color: '#8b96a5' } } } }
    });
  }
  document.getElementById('profile-modal').style.display = 'block';
}
function closeProfile() { document.getElementById('profile-modal').style.display = 'none'; }
window.onclick = function(event) {
  if (event.target == document.getElementById('profile-modal')) closeProfile();
  if (event.target == document.getElementById('map-modal')) closeMapDetails();
  if (event.target == document.getElementById('balancer-modal')) closeBalancer();
}

// ============ БАЛАНСИРОВЩИК ============
function getSavedKey() { return `savedTeams_${document.getElementById('tournament-select').value}`; }
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
  openBtn.onclick = () => {
    modal.style.display = 'block';
    selectedPlayers = [];
    searchInput.value = '';
    resultDiv.classList.remove('show');
    resultDiv.innerHTML = '';
    mapActions.classList.remove('show');
    mapResult.innerHTML = '';
    updateUI();
    drawGrid();
    loadSaved();
  };
  window.closeBalancer = () => { modal.style.display = 'none'; };
  function drawGrid() {
    if (!grid) return;
    const q = searchInput.value.toLowerCase();
    grid.innerHTML = currentStats.players.filter(p => (p.displayName || p.name).toLowerCase().includes(q)).map(p => {
      const sel = selectedPlayers.find(sp => sp.id === p.id);
      return `<div class="player-card ${sel ? 'selected' : ''}" onclick="togglePlayer('${p.id}')"><img src="${p.avatar}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'"><div class="card-name">${p.displayName || p.name}</div><div class="card-rating">${p.avgRating ?? p.kd}</div></div>`;
    }).join('');
  }
  window.togglePlayer = (id) => {
    const idx = selectedPlayers.findIndex(p => p.id === id);
    if (idx > -1) selectedPlayers.splice(idx, 1);
    else {
      if (selectedPlayers.length >= 10) { countLabel.style.color = '#ef4444'; setTimeout(() => { countLabel.style.color = 'var(--accent)'; }, 500); return; }
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
  randomBtn.onclick = () => { const sh = [...currentStats.players].sort(() => Math.random() - 0.5); selectedPlayers = sh.slice(0, Math.min(10, sh.length)); updateUI(); drawGrid(); };
  clearBtn.onclick = () => { selectedPlayers = []; mapResult.innerHTML = ''; updateUI(); drawGrid(); };
  balanceBtn.onclick = () => {
    if (selectedPlayers.length !== 10) return;
    const { teamA, teamB, sumA, sumB } = findBestTeams(selectedPlayers.map(p => ({ ...p, rating: p.avgRating ?? 0 })));
    resultDiv.innerHTML = `<div class="team-box"><h3>Команда А <span>Σ ${sumA.toFixed(2)}</span></h3><ul>${teamA.map(p => `<li><div class="t-player"><img src="${p.avatar}">${p.displayName || p.name}</div><span>${p.rating.toFixed(2)}</span></li>`).join('')}</ul></div><div class="team-box"><h3>Команда Б <span>Σ ${sumB.toFixed(2)}</span></h3><ul>${teamB.map(p => `<li><div class="t-player"><img src="${p.avatar}">${p.displayName || p.name}</div><span>${p.rating.toFixed(2)}</span></li>`).join('')}</ul></div>`;
    resultDiv.classList.add('show');
    savedSection.classList.remove('show');
    try { localStorage.setItem(getSavedKey(), JSON.stringify({ teamA: teamA.map(p => ({ name: p.displayName || p.name, rating: p.rating, avatar: p.avatar })), teamB: teamB.map(p => ({ name: p.displayName || p.name, rating: p.rating, avatar: p.avatar })), savedAt: new Date().toISOString() })); } catch (e) {}
  };
  document.getElementById('random-map-btn').onclick = () => { const names = currentStats.mapStats.map(m => m.map); if (!names.length) return; mapResult.innerHTML = `<div class="team-box" style="text-align:center;"><p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 6px;">Случайная карта:</p><h2 style="color: #4d6bfe; font-size: 1.5rem; margin: 0;">${names[Math.floor(Math.random() * names.length)]}</h2></div>`; };
  document.getElementById('balanced-map-btn').onclick = () => {
    let best = null, bestDiff = Infinity, bestD = null;
    for (const ms of currentStats.mapStats) {
      const ratings = selectedPlayers.map(p => { const tp = ms.topPlayers.find(t => t.id === p.id); return tp ? { rating: tp.avgRating } : null; });
      if (ratings.some(r => r === null)) continue;
      const { sumA, sumB } = findBestTeams(ratings.map((r, i) => ({ id: selectedPlayers[i].id, rating: r.rating })));
      const diff = Math.abs(sumA - sumB);
      if (diff < bestDiff) { bestDiff = diff; best = ms.map; bestD = { diff, sumA, sumB }; }
    }
    if (!best) { mapResult.innerHTML = `<div class="team-box" style="text-align:center; border-color:#ef4444;"><p style="color:#ef4444; font-size:0.85rem;">Нет карты, где играли все 10 игроков</p></div>`; return; }
    mapResult.innerHTML = `<div class="team-box" style="text-align:center; border-color: #10b981;"><p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 6px;">Оптимальная карта:</p><h2 style="color: #10b981; font-size: 1.5rem; margin: 0 0 8px 0;">${best}</h2><p style="font-size: 0.8rem; color: var(--text-muted);">Разница: <b style="color:#10b981;">${bestD.diff.toFixed(2)}</b> (${bestD.sumA.toFixed(2)} vs ${bestD.sumB.toFixed(2)})</p></div>`;
  };
  function findBestTeams(players) {
    const half = players.length / 2;
    let bestDiff = Infinity, bestTeamA = [], bestTeamB = [], bestSumA = 0, bestSumB = 0;
    const combinations = (arr, k) => { if (k === 0) return [[]]; if (arr.length === 0) return []; const [first, ...rest] = arr; const withFirst = combinations(rest, k - 1).map(comb => [first, ...comb]); const withoutFirst = combinations(rest, k); return [...withFirst, ...withoutFirst]; };
    for (const teamA of combinations(players, half)) {
      const teamB = players.filter(p => !teamA.includes(p));
      const sumA = teamA.reduce((s, p) => s + p.rating, 0);
      const sumB = teamB.reduce((s, p) => s + p.rating, 0);
      const diff = Math.abs(sumA - sumB);
      if (diff < bestDiff) { bestDiff = diff; bestTeamA = teamA; bestTeamB = teamB; bestSumA = sumA; bestSumB = sumB; }
    }
    return { teamA: bestTeamA, teamB: bestTeamB, sumA: bestSumA, sumB: bestSumB };
  }
  document.getElementById('clear-saved-btn').onclick = () => { localStorage.removeItem(getSavedKey()); savedSection.classList.remove('show'); savedContent.innerHTML = ''; };
  function loadSaved() {
    try {
      const raw = localStorage.getItem(getSavedKey());
      if (!raw) { savedSection.classList.remove('show'); return; }
      const d = JSON.parse(raw);
      const sA = d.teamA.reduce((s, p) => s + (p.rating || 0), 0);
      const sB = d.teamB.reduce((s, p) => s + (p.rating || 0), 0);
      savedContent.innerHTML = `<div class="balance-result-modal show" style="margin-top: 0;"><div class="team-box"><h3>Сохранено: Команда А <span>Σ ${sA.toFixed(2)}</span></h3><ul>${d.teamA.map(p => `<li><div class="t-player"><img src="${p.avatar}">${p.name}</div><span>${p.rating.toFixed(2)}</span></li>`).join('')}</ul></div><div class="team-box"><h3>Сохранено: Команда Б <span>Σ ${sB.toFixed(2)}</span></h3><ul>${d.teamB.map(p => `<li><div class="t-player"><img src="${p.avatar}">${p.name}</div><span>${p.rating.toFixed(2)}</span></li>`).join('')}</ul></div></div>`;
      savedSection.classList.add('show');
    } catch (e) {}
  }
}

// ============ СЕТКА ТУРНИРА ============
function seedOrder(n) {
  if (n === 1) return [1];
  if (n === 2) return [1, 2];
  const prev = seedOrder(n / 2);
  const result = [];
  for (const s of prev) { result.push(s); result.push(n + 1 - s); }
  return result;
}

function initBracketTab() {
  const genBtn = document.getElementById('generate-bracket-btn');
  const simBtn = document.getElementById('simulate-bracket-btn');
  const resetBtn = document.getElementById('reset-bracket-btn');
  if (!genBtn) return;
  genBtn.onclick = () => generateBracket();
  simBtn.onclick = () => simulateBracket();
  resetBtn.onclick = () => { bracketState = null; saveBracket(); renderBracket(); };
  
  try {
    const raw = localStorage.getItem(`bracket_${document.getElementById('tournament-select').value}`);
    if (raw) bracketState = JSON.parse(raw);
  } catch(e){}
  renderBracket();
}

function generateBracket() {
  const players = currentStats.players.slice().sort((a, b) => (b.avgRating ?? b.kd ?? 0) - (a.avgRating ?? a.kd ?? 0));
  const n = players.length;
  if (n < 2) { alert('Нужно минимум 2 игрока'); return; }
  const size = Math.pow(2, Math.ceil(Math.log2(n)));
  const seeded = seedOrder(size);
  const round0 = [];
  for (let i = 0; i < size; i += 2) {
    const seedA = seeded[i], seedB = seeded[i + 1];
    round0.push({
      t1: seedA <= n ? { id: players[seedA - 1].id, name: players[seedA - 1].displayName || players[seedA - 1].name, avatar: players[seedA - 1].avatar, rating: players[seedA - 1].avgRating, seed: seedA } : null,
      t2: seedB <= n ? { id: players[seedB - 1].id, name: players[seedB - 1].displayName || players[seedB - 1].name, avatar: players[seedB - 1].avatar, rating: players[seedB - 1].avgRating, seed: seedB } : null,
      winner: null,
    });
  }
  const rounds = [round0];
  let curSize = size / 2;
  while (curSize >= 1) {
    const round = [];
    for (let i = 0; i < curSize; i++) round.push({ t1: null, t2: null, winner: null });
    rounds.push(round);
    curSize /= 2;
  }
  bracketState = { size, participants: players.length, rounds, champion: null, completed: false };
  processBracket(bracketState);
  saveBracket();
  renderBracket();
}

function processBracket(state) {
  const rounds = state.rounds;
  for (let r = 0; r < rounds.length; r++) {
    for (let m = 0; m < rounds[r].length; m++) {
      const match = rounds[r][m];
      if (match.winner === null) {
        if (match.t1 && !match.t2) match.winner = 1;
        else if (!match.t1 && match.t2) match.winner = 2;
      }
      if (match.winner !== null && r < rounds.length - 1) {
        const winner = match.winner === 1 ? match.t1 : match.t2;
        if (winner) {
          const nextMatch = rounds[r + 1][Math.floor(m / 2)];
          if (m % 2 === 0) nextMatch.t1 = winner;
          else nextMatch.t2 = winner;
        }
      }
    }
  }
  const finalMatch = rounds[rounds.length - 1][0];
  state.champion = finalMatch.winner === 1 ? finalMatch.t1 : (finalMatch.winner === 2 ? finalMatch.t2 : null);
  state.completed = state.champion !== null;
}

function saveBracket() {
  try {
    const key = `bracket_${document.getElementById('tournament-select').value}`;
    if (bracketState) localStorage.setItem(key, JSON.stringify(bracketState));
    else localStorage.removeItem(key);
  } catch(e){}
}

function renderBracket() {
  const container = document.getElementById('bracket-container');
  if (!container) return;
  if (!bracketState) { container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding: 40px;">Нажмите "Сгенерировать", чтобы создать сетку</p>'; return; }
  const rounds = bracketState.rounds;
  const roundNames = [];
  const totalRounds = rounds.length;
  for (let r = 0; r < totalRounds; r++) {
    const remaining = Math.pow(2, totalRounds - r);
    if (remaining === 2) roundNames.push('Финал');
    else if (remaining === 4) roundNames.push('Полуфинал');
    else if (remaining === 8) roundNames.push('1/4 финала');
    else if (remaining === 16) roundNames.push('1/8 финала');
    else roundNames.push(`Раунд ${r + 1}`);
  }
  
  let html = '<div class="bracket">';
  for (let r = 0; r < rounds.length; r++) {
    html += `<div class="bracket-round"><div class="bracket-round-title">${roundNames[r]}</div>`;
    for (let m = 0; m < rounds[r].length; m++) {
      html += renderMatchCard(r, m, rounds[r][m]);
    }
    html += `</div>`;
  }
  html += '</div>';
  if (bracketState.champion) html += `<div class="bracket-champion">Победитель турнира: ${bracketState.champion.name}</div>`;
  container.innerHTML = html;
}

function renderMatchCard(r, m, match) {
  const t1Class = match.winner === 1 ? 'winner' : (match.winner === 2 ? 'loser' : '');
  const t2Class = match.winner === 2 ? 'winner' : (match.winner === 1 ? 'loser' : '');
  const t1Name = match.t1 ? match.t1.name : '—';
  const t2Name = match.t2 ? match.t2.name : '—';
  const canClick = match.t1 && match.t2 && match.winner === null;
  const t1Click = canClick ? `onclick="setBracketWinner(${r},${m},1)"` : '';
  const t2Click = canClick ? `onclick="setBracketWinner(${r},${m},2)"` : '';
  return `<div class="bracket-match ${match.winner ? 'completed' : ''}">
    <div class="bracket-team ${t1Class}" ${t1Click}><span>${t1Name}</span>${match.winner === 1 ? '<span class="bracket-score">✓</span>' : ''}</div>
    <div class="bracket-team ${t2Class}" ${t2Click}><span>${t2Name}</span>${match.winner === 2 ? '<span class="bracket-score">✓</span>' : ''}</div>
  </div>`;
}

window.setBracketWinner = function(r, m, winner) {
  if (!bracketState) return;
  const match = bracketState.rounds[r][m];
  if (!match.t1 || !match.t2) return;
  match.winner = winner;
  let curM = m;
  for (let rr = r + 1; rr < bracketState.rounds.length; rr++) {
    curM = Math.floor(curM / 2);
    const nm = bracketState.rounds[rr][curM];
    if (!nm) break;
    nm.t1 = null; nm.t2 = null; nm.winner = null;
  }
  processBracket(bracketState);
  saveBracket();
  renderBracket();
};

function simulateBracket() {
  if (!bracketState) return;
  const rounds = bracketState.rounds;
  for (const round of rounds) for (const m of round) { m.winner = null; }
  bracketState = null;
  generateBracket();
  for (let r = 0; r < rounds.length; r++) {
    for (let m = 0; m < rounds[r].length; m++) {
      const match = rounds[r][m];
      if (match.winner !== null) continue;
      if (!match.t1 || !match.t2) continue;
      const r1 = match.t1.rating ?? 0, r2 = match.t2.rating ?? 0;
      const t1Better = r1 >= r2;
      const rnd = Math.random();
      match.winner = (rnd < 0.8) ? (t1Better ? 1 : 2) : (t1Better ? 2 : 1);
    }
    processBracket(bracketState);
  }
  saveBracket();
  renderBracket();
}

// ============ ОНЛАЙН ДРАФТ (WebRTC) ============
function initOnlineDraftTab() {
  const lobbyScreen = document.getElementById('draft-lobby-screen');
  const roomScreen = document.getElementById('draft-room-screen');
  
  if (!peer) {
    lobbyScreen.style.display = 'block';
    roomScreen.style.display = 'none';
    
    document.getElementById('create-room-btn').onclick = () => {
      const nick = document.getElementById('draft-nickname').value.trim();
      if (!nick) return alert('Введите ник');
      myNickname = nick;
      isHost = true;
      document.getElementById('create-room-btn').innerText = 'Создание...';
      document.getElementById('create-room-btn').disabled = true;
      createPeer(true);
    };

    document.getElementById('join-room-btn').onclick = () => {
      const nick = document.getElementById('draft-nickname').value.trim();
      const code = document.getElementById('join-room-code').value.trim().toUpperCase();
      if (!nick) return alert('Введите ник');
      if (!code) return alert('Введите код комнаты');
      myNickname = nick;
      isHost = false;
      document.getElementById('join-room-btn').innerText = 'Подключение...';
      document.getElementById('join-room-btn').disabled = true;
      createPeer(false, code);
    };
  } else {
    lobbyScreen.style.display = 'none';
    roomScreen.style.display = 'block';
    renderOnlineRoom();
  }
}

function createPeer(host, joinCode) {
  if (peer) peer.destroy();
  
  console.log('Инициализация PeerJS...');
  
  try {
    const peerId = host ? generateRoomCode() : undefined;
    // Используем альтернативный публичный сервер
    peer = new Peer(peerId, { 
      debug: 0,
      host: 'peerjs-server.herokuapp.com',
      secure: true,
      port: 443
    });
  } catch (e) {
    console.error('Ошибка инициализации PeerJS:', e);
    alert('Ошибка инициализации. Проверьте консоль (F12).');
    return;
  }
  
  peer.on('error', (err) => {
    console.error('PeerJS Error:', err);
    let msg = 'Ошибка соединения: ' + err.type;
    if (err.type === 'network') msg = 'Нет соединения с сигнальным сервером PeerJS. Проверьте интернет или VPN.';
    if (err.type === 'peer-unavailable') msg = 'Комната не найдена. Проверьте код.';
    if (err.type === 'unavailable-id') msg = 'Этот код комнаты уже занят.';
    alert(msg);
    
    document.getElementById('create-room-btn').innerText = 'Создать комнату';
    document.getElementById('create-room-btn').disabled = false;
    document.getElementById('join-room-btn').innerText = 'Войти в комнату';
    document.getElementById('join-room-btn').disabled = false;
  });
  
  peer.on('open', (id) => {
    console.log('PeerJS подключен. ID:', id);
    
    if (host) {
      onlineRoomState = {
        status: 'lobby',
        hostId: id,
        players: [{ id: id, name: myNickname, isCaptain: false, team: null }],
        captains: [],
        turnIndex: 0,
        pickOrder: [],
        pool: []
      };
      document.getElementById('draft-room-id').innerText = id;
      document.getElementById('draft-connection-status').innerText = 'Вы хост. Ждем подключений...';
      showRoomScreen();
    } else {
      console.log('Подключаемся к комнате:', joinCode);
      hostConn = peer.connect(joinCode, { metadata: { name: myNickname } });
      
      hostConn.on('open', () => {
        console.log('Соединение установлено');
        document.getElementById('draft-room-id').innerText = joinCode;
        document.getElementById('draft-connection-status').innerText = 'Подключено. Ждем данных...';
        hostConn.send({ type: 'JOIN', name: myNickname });
        showRoomScreen();
      });
      
      hostConn.on('data', (data) => {
        if (data.type === 'STATE') {
          onlineRoomState = data.state;
          renderOnlineRoom();
        }
      });
      
      hostConn.on('close', () => {
        alert('Соединение с хостом потеряно.');
        location.reload();
      });
    }
  });

  if (host) {
    peer.on('connection', (conn) => {
      clients.push(conn);
      
      conn.on('data', (data) => {
        if (data.type === 'JOIN') {
          if (!onlineRoomState.players.find(p => p.id === conn.peer)) {
            onlineRoomState.players.push({ id: conn.peer, name: data.name, isCaptain: false, team: null });
            broadcastState();
          }
        } else if (data.type === 'MAKE_CAPTAIN') {
          const p = onlineRoomState.players.find(x => x.id === data.playerId);
          if (p) { p.isCaptain = true; broadcastState(); }
        } else if (data.type === 'REMOVE_CAPTAIN') {
          const p = onlineRoomState.players.find(x => x.id === data.playerId);
          if (p) { p.isCaptain = false; broadcastState(); }
        } else if (data.type === 'START_DRAFT') {
          startOnlineDraftLogic();
        } else if (data.type === 'PICK') {
          if (onlineRoomState.status === 'picking') {
            const currentCaptainId = onlineRoomState.pickOrder[onlineRoomState.turnIndex];
            if (data.captainId === currentCaptainId) {
              executePickLogic(data.playerId);
            }
          }
        }
      });
      
      conn.on('close', () => {
        clients = clients.filter(c => c !== conn);
        onlineRoomState.players = onlineRoomState.players.filter(p => p.id !== conn.peer);
        onlineRoomState.captains = onlineRoomState.captains.filter(id => id !== conn.peer);
        if (onlineRoomState.status === 'lobby') {
           broadcastState();
        }
      });
    });
  }
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return code;
}

function showRoomScreen() {
  document.getElementById('draft-lobby-screen').style.display = 'none';
  document.getElementById('draft-room-screen').style.display = 'block';
  renderOnlineRoom();
}

function broadcastState() {
  if (!isHost) return;
  clients.forEach(conn => {
    if (conn.open) conn.send({ type: 'STATE', state: onlineRoomState });
  });
  renderOnlineRoom();
}

function renderOnlineRoom() {
  if (!onlineRoomState) return;
  
  if (onlineRoomState.status === 'lobby') {
    document.getElementById('draft-phase-lobby').style.display = 'block';
    document.getElementById('draft-phase-picking').style.display = 'none';
    
    const container = document.getElementById('draft-lobby-players');
    container.innerHTML = onlineRoomState.players.map(p => {
      const isCap = p.isCaptain;
      const isMe = p.id === peer?.id;
      const canToggle = isHost;
      const btnText = isCap ? 'Снять' : 'Капитан';
      return `<div class="draft-lobby-card ${isCap ? 'captain' : ''}">
        <span>${p.name} ${isMe ? '(Вы)' : ''}</span>
        ${canToggle ? `<button class="btn-outline" style="font-size: 0.7rem; padding: 4px 8px;" onclick="toggleCaptain('${p.id}')">${btnText}</button>` : (isCap ? '<span style="color:#ffd700; font-size:0.8rem;">Капитан</span>' : '')}
      </div>`;
    }).join('');
    
    const startBtn = document.getElementById('start-online-draft-btn');
    if (isHost) {
      startBtn.style.display = 'block';
      startBtn.disabled = onlineRoomState.captains.length !== 4 || onlineRoomState.players.length < 10;
      startBtn.onclick = () => { if (isHost) startOnlineDraftLogic(); };
    } else {
      startBtn.style.display = 'none';
    }
  } else if (onlineRoomState.status === 'picking') {
    document.getElementById('draft-phase-lobby').style.display = 'none';
    document.getElementById('draft-phase-picking').style.display = 'block';
    
    const turnCapId = onlineRoomState.pickOrder[onlineRoomState.turnIndex];
    const turnPlayer = onlineRoomState.players.find(p => p.id === turnCapId);
    const isMyTurn = peer?.id === turnCapId;
    
    document.getElementById('draft-online-turn').innerHTML = isMyTurn 
      ? `<span style="color:#ffd700;">Ваш ход! Выбирайте игрока.</span>` 
      : `Сейчас выбирает: <strong>${turnPlayer ? turnPlayer.name : '...'}</strong>`;
    
    for (let i = 0; i < 4; i++) {
      const capId = onlineRoomState.pickOrder[i];
      const cap = onlineRoomState.players.find(p => p.id === capId);
      const col = document.getElementById(`team-col-${i}`);
      const isTurn = onlineRoomState.pickOrder[onlineRoomState.turnIndex] === capId;
      
      if (cap) {
        const teamPlayers = onlineRoomState.players.filter(p => p.team === capId);
        col.className = `draft-team-col ${isTurn ? 'active-turn' : ''}`;
        col.innerHTML = `
          <h4>${cap.name}</h4>
          <ul>${teamPlayers.map(tp => `<li><img src="${tp.avatar || 'https://ui-avatars.com/api/?name='+encodeURIComponent(tp.name)+'&background=4d6bfe&color=fff'}">${tp.name}</li>`).join('')}</ul>
        `;
      }
    }
    
    const poolEl = document.getElementById('draft-online-pool');
    poolEl.innerHTML = onlineRoomState.pool.map(p => {
      const canPick = isMyTurn && onlineRoomState.status === 'picking';
      return `<div class="draft-pool-card ${!canPick ? 'picked' : ''}" onclick="${canPick ? `submitOnlinePick('${p.id}')` : ''}">
        <img src="${p.avatar || 'https://ui-avatars.com/api/?name='+encodeURIComponent(p.name)+'&background=4d6bfe&color=fff'}">
        <span>${p.name}</span>
        <span style="margin-left:auto;color:var(--accent);">${p.rating || ''}</span>
      </div>`;
    }).join('');
    
    if (onlineRoomState.pool.length === 0) {
      poolEl.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding: 20px;">Пул пуст</p>';
    }
  }
}

function startOnlineDraftLogic() {
  if (!isHost) return;
  const captainIds = onlineRoomState.players.filter(p => p.isCaptain).map(p => p.id);
  if (captainIds.length !== 4) return alert('Нужно ровно 4 капитана');
  
  const getRating = (id) => {
    const player = onlineRoomState.players.find(x => x.id === id);
    const stat = currentStats.players.find(p => p.name === player.name);
    return stat ? (stat.avgRating ?? 0) : 0;
  };
  captainIds.sort((a,b) => getRating(a) - getRating(b));
  
  onlineRoomState.status = 'picking';
  onlineRoomState.pickOrder = captainIds;
  
  onlineRoomState.players.forEach(p => {
    if (p.isCaptain) {
      p.team = p.id;
      const stat = currentStats.players.find(x => x.name === p.name);
      p.avatar = stat ? stat.avatar : '';
      p.rating = stat ? stat.avgRating : 0;
    }
  });
  
  onlineRoomState.pool = onlineRoomState.players.filter(p => !p.isCaptain).map(p => {
    const stat = currentStats.players.find(x => x.name === p.name);
    return { ...p, avatar: stat ? stat.avatar : '', rating: stat ? stat.avgRating : 0 };
  });
  
  onlineRoomState.pool.sort((a,b) => (b.rating || 0) - (a.rating || 0));
  
  onlineRoomState.turnIndex = 0;
  broadcastState();
}

function executePickLogic(playerId) {
  if (!isHost) return;
  if (onlineRoomState.status !== 'picking') return;
  
  const poolIdx = onlineRoomState.pool.findIndex(p => p.id === playerId);
  if (poolIdx === -1) return;
  
  const player = onlineRoomState.pool[poolIdx];
  const turnCapId = onlineRoomState.pickOrder[onlineRoomState.turnIndex];
  
  player.team = turnCapId;
  onlineRoomState.pool.splice(poolIdx, 1);
  
  onlineRoomState.turnIndex++;
  
  if (onlineRoomState.turnIndex >= 16 || onlineRoomState.pool.length === 0) {
    onlineRoomState.status = 'finished';
  }
  
  broadcastState();
}

window.toggleCaptain = function(id) {
  if (!isHost) return;
  const p = onlineRoomState.players.find(x => x.id === id);
  if (p) {
    p.isCaptain = !p.isCaptain;
    onlineRoomState.captains = onlineRoomState.players.filter(x => x.isCaptain).map(x => x.id);
    broadcastState();
  }
};

window.submitOnlinePick = function(id) {
  if (!peer) return;
  if (isHost) {
    const currentCap = onlineRoomState.pickOrder[onlineRoomState.turnIndex];
    if (currentCap === peer.id) executePickLogic(id);
  } else {
    hostConn.send({ type: 'PICK', captainId: peer.id, playerId: id });
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