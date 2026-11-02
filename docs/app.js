window.onerror = function(message, source, lineno) {
  const meta = document.getElementById('meta-info');
  if (meta) meta.innerHTML = `<span style="color: #ef4444;">Ошибка: ${message} (строка ${lineno})</span>`;
  console.error(message);
};

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW error:', err));
  });
}

let statsData = null;
let currentStats = null;
let myChart = null;
let profChart = null;
let selectedPlayers = [];

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
    renderRecords();
    renderPlayersTable();
    renderMapStats();
    initDuel();
  } catch (e) {
    document.getElementById('meta-info').innerHTML = `<span style="color: #ef4444;">Ошибка рендера: ${e.message}</span>`;
    console.error(e);
  }
}

function renderRecords() {
  if (!currentStats.records) return;
  const r = currentStats.records;

  const killRec = (r.maxKills && r.maxKills.value > 0) ? r.maxKills : null;
  const deathRec = (r.maxDeaths && r.maxDeaths.value > 0) ? r.maxDeaths : null;
  const adrRec = (r.maxAdr && r.maxAdr.value > 0) ? r.maxAdr : null;

  document.getElementById('rec-max-kills').innerText = killRec ? killRec.value : '—';
  document.getElementById('rec-max-kills-desc').innerHTML = killRec 
    ? `<b>${killRec.player}</b><br><span class="record-map">${killRec.map}</span>` 
    : 'Нет данных';
  
  document.getElementById('rec-max-deaths').innerText = deathRec ? deathRec.value : '—';
  document.getElementById('rec-max-deaths-desc').innerHTML = deathRec 
    ? `<b>${deathRec.player}</b><br><span class="record-map">${deathRec.map}</span>` 
    : 'Нет данных';

  document.getElementById('rec-max-adr').innerText = adrRec ? adrRec.value : '—';
  document.getElementById('rec-max-adr-desc').innerHTML = adrRec 
    ? `<b>${adrRec.player}</b><br><span class="record-map">${adrRec.map}</span>` 
    : 'Нет данных';
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
      if (p.form === 'hot') formText = '<span style="color: #10b981; font-weight: 600;">В форме</span>';
      else if (p.form === 'cold') formText = '<span style="color: #ef4444; font-weight: 600;">Спад</span>';
      else if (p.form === 'new') formText = '<span style="color: #f59e0b;">Мало данных</span>';
      else formText = '<span style="color: #8b96a5;">Стабильно</span>';

      return `
      <tr>
        <td>
          <div class="player-cell">
            <img src="${p.avatar}" class="player-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">
            <div><strong class="player-link" onclick="openProfile('${p.id}')">${p.displayName || p.name}</strong></div>
          </div>
        </td>
        <td>${formText}</td>
        <td>${p.matches}</td>
        <td><strong>${p.kd}</strong></td>
        <td style="color: var(--accent); font-weight: 600;">${p.avgRating ?? '—'}</td>
      </tr>
    `}).join('');
  }

  filterInput.oninput = draw;
  sortSelect.onchange = draw;
  draw();
}

function renderMapStats() {
  const tbody = document.querySelector('#maps-table tbody');
  if (!tbody || !currentStats.mapStats) return;
  tbody.innerHTML = currentStats.mapStats.map(m => `
    <tr class="map-row" onclick="openMapDetails('${m.map}')">
      <td><strong>${m.map}</strong></td>
      <td>${m.matches}</td>
      <td>${m.avgKd}</td>
      <td style="color: var(--accent); font-weight: 600;">${m.avgRating}</td>
    </tr>
  `).join('');
}

function openMapDetails(mapName) {
  const mapData = currentStats.mapStats.find(m => m.map === mapName);
  if (!mapData) return;

  document.getElementById('map-modal-title').innerText = mapName;
  
  // РЕНДЕР РЕКОРДОВ ДЛЯ КАРТЫ
  const recs = mapData.records || { maxKills: {}, maxDeaths: {}, maxAdr: {} };
  document.getElementById('map-records-container').innerHTML = `
    <div class="fun-stat-box" style="padding: 12px;">
      <div class="fun-val" style="font-size: 1.3rem;">${recs.maxKills.value || 0}</div>
      <div class="fun-desc">Макс. убийств<br><b style="color:#fff;">${recs.maxKills.player || '—'}</b></div>
    </div>
    <div class="fun-stat-box" style="padding: 12px;">
      <div class="fun-val" style="font-size: 1.3rem; color: #ef4444;">${recs.maxDeaths.value || 0}</div>
      <div class="fun-desc">Макс. смертей<br><b style="color:#fff;">${recs.maxDeaths.player || '—'}</b></div>
    </div>
    <div class="fun-stat-box" style="padding: 12px;">
      <div class="fun-val" style="font-size: 1.3rem; color: #10b981;">${recs.maxAdr.value || 0}</div>
      <div class="fun-desc">Макс. ADR<br><b style="color:#fff;">${recs.maxAdr.player || '—'}</b></div>
    </div>
  `;

  const tbody = document.getElementById('map-players-list');
  tbody.innerHTML = mapData.topPlayers.map((p) => `
    <tr>
      <td>
        <div class="player-cell">
          <img src="${p.avatar}" class="player-avatar" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">
          <strong>${p.name}</strong>
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
    if (p1.id === p2.id) return alert('Выбери двух разных людей!');

    const compare = (val1, val2) => {
      if (val1 === val2) return ['', ''];
      return val1 > val2 ? ['duel-winner', 'duel-loser'] : ['duel-loser', 'duel-winner'];
    };

    const [classKd1, classKd2] = compare(p1.kd, p2.kd);
    const [classRat1, classRat2] = compare(p1.avgRating ?? 0, p2.avgRating ?? 0);
    const [classAdr1, classAdr2] = compare(p1.avgAdr ?? 0, p2.avgAdr ?? 0);
    const [classKast1, classKast2] = compare(p1.avgKast ?? 0, p2.avgKast ?? 0);
    const winnerName = (p1.avgRating ?? p1.kd) > (p2.avgRating ?? p2.kd) ? (p1.displayName || p1.name) : (p2.displayName || p2.name);

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div class="duel-row"><span class="${classKd1}">${p1.kd} K/D</span><span style="font-weight:bold;color:var(--text-muted);">K/D</span><span class="${classKd2}">${p2.kd} K/D</span></div>
      <div class="duel-row"><span class="${classRat1}">${p1.avgRating ?? '—'} Рейтинг</span><span style="font-weight:bold;color:var(--text-muted);">RATING</span><span class="${classRat2}">${p2.avgRating ?? '—'} Рейтинг</span></div>
      <div class="duel-row"><span class="${classAdr1}">${p1.avgAdr ?? '—'} ADR</span><span style="font-weight:bold;color:var(--text-muted);">ADR</span><span class="${classAdr2}">${p2.avgAdr ?? '—'} ADR</span></div>
      <div class="duel-row"><span class="${classKast1}">${p1.avgKast ?? '—'} KAST</span><span style="font-weight:bold;color:var(--text-muted);">KAST</span><span class="${classKast2}">${p2.avgKast ?? '—'} KAST</span></div>
      <div style="text-align:center; margin-top:15px; font-weight:bold; font-size:1.2rem; color:#fff;">Победитель: <span style="color:#10b981;">${winnerName}</span></div>
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
  if (shareBtn) {
    shareBtn.onclick = () => {
      const text = encodeURIComponent(`Смотрите, кто у нас тащит:\n🏆 ${p.displayName || p.name}\n📊 Рейтинг: ${p.avgRating || 0}\n🔫 K/D: ${p.kd}\n📈 ADR: ${p.avgAdr || 0}\n\nПруфы:`);
      window.open(`https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${text}`, '_blank');
    };
  }

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

// БАЛАНСИРОВЩИК
function getSavedKey() {
  return `savedTeams_${document.getElementById('tournament-select').value}`;
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
    const query = searchInput.value.toLowerCase();
    const filtered = currentStats.players.filter(p => (p.displayName || p.name).toLowerCase().includes(query));
    grid.innerHTML = filtered.map(p => {
      const isSelected = selectedPlayers.find(sp => sp.id === p.id);
      return `
        <div class="player-card ${isSelected ? 'selected' : ''}" onclick="togglePlayer('${p.id}')">
          <img src="${p.avatar}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">
          <div class="card-name">${p.displayName || p.name}</div>
          <div class="card-rating">${p.avgRating ?? p.kd}</div>
        </div>
      `;
    }).join('');
  }

  window.togglePlayer = (id) => {
    const idx = selectedPlayers.findIndex(p => p.id === id);
    if (idx > -1) {
      selectedPlayers.splice(idx, 1);
    } else {
      if (selectedPlayers.length >= 10) {
        countLabel.style.background = 'rgba(239, 68, 68, 0.2)';
        countLabel.style.color = '#ef4444';
        setTimeout(() => { countLabel.style.background = 'rgba(77, 107, 254, 0.1)'; countLabel.style.color = 'var(--accent)'; }, 500);
        return;
      }
      const player = currentStats.players.find(p => p.id === id);
      if (player) selectedPlayers.push(player);
    }
    updateUI();
    drawGrid();
  };

  function updateUI() {
    if (!countLabel) return;
    countLabel.innerText = `${selectedPlayers.length} / 10`;
    balanceBtn.disabled = selectedPlayers.length !== 10;
    if (selectedPlayers.length === 10) mapActions.classList.add('show');
    else { mapActions.classList.remove('show'); mapResult.innerHTML = ''; }
    if (selectedPlayers.length !== 10) resultDiv.classList.remove('show');
  }

  searchInput.addEventListener('input', drawGrid);

  randomBtn.onclick = () => {
    const shuffled = [...currentStats.players].sort(() => Math.random() - 0.5);
    selectedPlayers = shuffled.slice(0, Math.min(10, shuffled.length));
    updateUI();
    drawGrid();
  };

  clearBtn.onclick = () => {
    selectedPlayers = [];
    mapResult.innerHTML = '';
    updateUI();
    drawGrid();
  };

  balanceBtn.onclick = () => {
    if (selectedPlayers.length !== 10) return;
    const { teamA, teamB, sumA, sumB } = balanceTeams(selectedPlayers, p => p.avgRating ?? 0);
    renderTeams(resultDiv, teamA, teamB, sumA, sumB, 'Команда А', 'Команда Б');
    resultDiv.classList.add('show');
    savedSection.classList.remove('show');
    saveTeams(teamA, teamB);
  };

  document.getElementById('random-map-btn').onclick = () => {
    const mapNames = currentStats.mapStats.map(m => m.map);
    if (mapNames.length === 0) return;
    const randomMap = mapNames[Math.floor(Math.random() * mapNames.length)];
    showMapResult(randomMap, '🎲 Случайная карта', null);
  };

  document.getElementById('balanced-map-btn').onclick = () => {
    const result = findMostBalancedMap(selectedPlayers);
    if (!result) { showMapResult(null, 'Нет карты, на которой играли ВСЕ 10 выбранных игроков', null); return; }
    showMapResult(result.map, '⚖️ Самая балансная карта', result);
  };

  document.getElementById('clear-saved-btn').onclick = () => {
    localStorage.removeItem(getSavedKey());
    savedSection.classList.remove('show');
    savedContent.innerHTML = '';
  };

  function saveTeams(teamA, teamB) {
    try {
      localStorage.setItem(getSavedKey(), JSON.stringify({ teamA: teamA.map(p => ({ name: p.name, rating: p.rating, avatar: p.avatar })), teamB: teamB.map(p => ({ name: p.name, rating: p.rating, avatar: p.avatar })), savedAt: new Date().toISOString() }));
    } catch (e) { console.error('Не удалось сохранить', e); }
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(getSavedKey());
      if (!raw) { savedSection.classList.remove('show'); return; }
      const data = JSON.parse(raw);
      if (!data.teamA || !data.teamB) return;
      const sumA = data.teamA.reduce((s, p) => s + (p.rating || 0), 0);
      const sumB = data.teamB.reduce((s, p) => s + (p.rating || 0), 0);
      const date = new Date(data.savedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      savedContent.innerHTML = `<p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 10px;">Сохранено: ${date}</p><div class="balance-result-modal show" style="margin-top: 0;">${renderTeamBox('Команда А', data.teamA, sumA)}${renderTeamBox('Команда Б', data.teamB, sumB)}</div>`;
      savedSection.classList.add('show');
    } catch (e) { console.error(e); }
  }

  function renderTeamBox(name, players, sum) {
    return `<div class="team-box"><h3>${name} <span>Σ ${sum.toFixed(1)}</span></h3><ul>${players.map(p => `<li><div class="t-player"><img src="${p.avatar}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">${p.name}</div><span>${p.rating.toFixed(1)}</span></li>`).join('')}</ul></div>`;
  }

  function renderTeams(container, teamA, teamB, sumA, sumB, nameA, nameB) {
    container.innerHTML = `<div class="team-box"><h3>${nameA} <span>Σ ${sumA.toFixed(1)}</span></h3><ul>${teamA.map(p => `<li><div class="t-player"><img src="${p.avatar}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">${p.name}</div><span>${p.rating.toFixed(1)}</span></li>`).join('')}</ul></div><div class="team-box"><h3>${nameB} <span>Σ ${sumB.toFixed(1)}</span></h3><ul>${teamB.map(p => `<li><div class="t-player"><img src="${p.avatar}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">${p.name}</div><span>${p.rating.toFixed(1)}</span></li>`).join('')}</ul></div>`;
  }

  function balanceTeams(players, getRating) {
    const prepared = players.map(p => ({ ...p, rating: getRating(p) }));
    prepared.sort((a, b) => b.rating - a.rating);
    const teamA = [], teamB = [];
    let sumA = 0, sumB = 0;
    prepared.forEach(p => {
      if (sumA <= sumB) { teamA.push(p); sumA += p.rating; }
      else { teamB.push(p); sumB += p.rating; }
    });
    return { teamA, teamB, sumA, sumB };
  }

  function showMapResult(mapName, label, details) {
    if (!mapName) { mapResult.innerHTML = `<div class="team-box" style="text-align:center; border-color: #ef4444;"><p style="color:#ef4444;">${label}</p></div>`; return; }
    let extra = details ? `<p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 8px;">Разница рейтингов: <b style="color: #10b981;">${details.diff.toFixed(1)}</b> (${details.sumA.toFixed(1)} vs ${details.sumB.toFixed(1)})</p>` : '';
    mapResult.innerHTML = `<div class="team-box" style="text-align:center; border-color: #10b981;"><p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 8px;">${label}</p><h2 style="color: #10b981; font-size: 1.8rem; margin: 0;">${mapName}</h2>${extra}</div>`;
  }

  function findMostBalancedMap(players) {
    if (!currentStats.mapStats || currentStats.mapStats.length === 0) return null;
    let bestMap = null, bestDiff = Infinity, bestDetails = null;
    for (const mapStat of currentStats.mapStats) {
      const mapRatings = players.map(p => { const tp = mapStat.topPlayers.find(tp => tp.id === p.id); return tp ? { rating: tp.avgRating, hasData: true } : { rating: null, hasData: false }; });
      if (mapRatings.some(r => !r.hasData)) continue;
      const sorted = [...mapRatings].sort((a,b) => b.rating - a.rating);
      let sumA = 0, sumB = 0;
      sorted.forEach(r => { if (sumA <= sumB) sumA += r.rating; else sumB += r.rating; });
      const diff = Math.abs(sumA - sumB);
      if (diff < bestDiff) { bestDiff = diff; bestMap = mapStat.map; bestDetails = { diff, sumA, sumB }; }
    }
    return bestMap ? { map: bestMap, ...bestDetails } : null;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  initBalancer();
});