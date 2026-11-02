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

  function draw() {
    let data = [...currentStats.mapStats];
    const key = currentMapSort.key;
    const dir = currentMapSort.dir === 'asc' ? 1 : -1;

    data.sort((a, b) => {
      if (key === 'map') return a.map.localeCompare(b.map) * dir;
      return (a[key] - b[key]) * dir;
    });

    tbody.innerHTML = data.map(m => `
      <tr class="map-row" onclick="openMapDetails('${m.map}')">
        <td><strong>${m.map}</strong></td>
        <td>${m.matches}</td>
        <td>${m.avgKd}</td>
        <td style="color: var(--accent); font-weight: 600;">${m.avgRating}</td>
      </tr>
    `).join('');
  }

  document.querySelectorAll('#maps-table .sortable').forEach(th => {
    if (th.dataset.listenerAttached) return;
    th.dataset.listenerAttached = 'true';
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (currentMapSort.key === key) {
        currentMapSort.dir = currentMapSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        currentMapSort.key = key;
        currentMapSort.dir = 'desc';
      }
      document.querySelectorAll('#maps-table .sortable').forEach(t => {
        t.classList.remove('asc', 'desc');
        t.querySelector('.sort-arrow').textContent = '⬍';
      });
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
      return `<div class="player-card ${sel ? 'selected' : ''}" onclick="togglePlayer('${p.id}')">
        <img src="${p.avatar}" onerror="this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(p.name)}&background=4d6bfe&color=fff&rounded=true'">
        <div class="card-name">${p.displayName || p.name}</div>
        <div class="card-rating">${p.avgRating ?? p.kd}</div>
      </div>`;
    }).join('');
  }

  window.togglePlayer = (id) => {
    const idx = selectedPlayers.findIndex(p => p.id === id);
    if (idx > -1) selectedPlayers.splice(idx, 1);
    else {
      if (selectedPlayers.length >= 10) {
        countLabel.style.color = '#ef4444';
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

  clearBtn.onclick = () => {
    selectedPlayers = []; mapResult.innerHTML = '';
    updateUI(); drawGrid();
  };

  balanceBtn.onclick = () => {
    if (selectedPlayers.length !== 10) return;
    const { teamA, teamB, sumA, sumB } = findBestTeams(selectedPlayers.map(p => ({ ...p, rating: p.avgRating ?? 0 })));
    
    resultDiv.innerHTML = `
      <div class="team-box"><h3>Команда А <span>Σ ${sumA.toFixed(2)}</span></h3><ul>${teamA.map(p => `<li><div class="t-player"><img src="${p.avatar}">${p.displayName || p.name}</div><span>${p.rating.toFixed(2)}</span></li>`).join('')}</ul></div>
      <div class="team-box"><h3>Команда Б <span>Σ ${sumB.toFixed(2)}</span></h3><ul>${teamB.map(p => `<li><div class="t-player"><img src="${p.avatar}">${p.displayName || p.name}</div><span>${p.rating.toFixed(2)}</span></li>`).join('')}</ul></div>
    `;
    resultDiv.classList.add('show');
    savedSection.classList.remove('show');
    try {
      localStorage.setItem(getSavedKey(), JSON.stringify({
        teamA: teamA.map(p => ({ name: p.displayName || p.name, rating: p.rating, avatar: p.avatar })),
        teamB: teamB.map(p => ({ name: p.displayName || p.name, rating: p.rating, avatar: p.avatar })),
        savedAt: new Date().toISOString()
      }));
    } catch (e) {}
  };

  document.getElementById('random-map-btn').onclick = () => {
    const names = currentStats.mapStats.map(m => m.map);
    if (!names.length) return;
    mapResult.innerHTML = `<div class="team-box" style="text-align:center;"><p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 6px;">Случайная карта:</p><h2 style="color: #4d6bfe; font-size: 1.5rem; margin: 0;">${names[Math.floor(Math.random() * names.length)]}</h2></div>`;
  };

  document.getElementById('balanced-map-btn').onclick = () => {
    let best = null, bestDiff = Infinity, bestD = null;
    for (const ms of currentStats.mapStats) {
      const ratings = selectedPlayers.map(p => {
        const tp = ms.topPlayers.find(t => t.id === p.id);
        return tp ? { rating: tp.avgRating } : null;
      });
      if (ratings.some(r => r === null)) continue;
      
      const { sumA, sumB } = findBestTeams(ratings.map((r, i) => ({ id: selectedPlayers[i].id, rating: r.rating })));
      const diff = Math.abs(sumA - sumB);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = ms.map;
        bestD = { diff, sumA, sumB };
      }
    }
    if (!best) {
      mapResult.innerHTML = `<div class="team-box" style="text-align:center; border-color:#ef4444;"><p style="color:#ef4444; font-size:0.85rem;">Нет карты, где играли все 10 выбранных игроков</p></div>`;
      return;
    }
    mapResult.innerHTML = `<div class="team-box" style="text-align:center; border-color: #10b981;"><p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 6px;">Оптимальная карта по балансу:</p><h2 style="color: #10b981; font-size: 1.5rem; margin: 0 0 8px 0;">${best}</h2><p style="font-size: 0.8rem; color: var(--text-muted);">Разница рейтингов: <b style="color:#10b981;">${bestD.diff.toFixed(2)}</b> (${bestD.sumA.toFixed(2)} vs ${bestD.sumB.toFixed(2)})</p></div>`;
  };

  function findBestTeams(players) {
    const n = players.length;
    const half = n / 2;
    let bestDiff = Infinity;
    let bestTeamA = [], bestTeamB = [];
    let bestSumA = 0, bestSumB = 0;

    const combinations = (arr, k) => {
      if (k === 0) return [[]];
      if (arr.length === 0) return [];
      const [first, ...rest] = arr;
      const withFirst = combinations(rest, k - 1).map(comb => [first, ...comb]);
      const withoutFirst = combinations(rest, k);
      return [...withFirst, ...withoutFirst];
    };

    for (const teamA of combinations(players, half)) {
      const teamB = players.filter(p => !teamA.includes(p));
      const sumA = teamA.reduce((s, p) => s + p.rating, 0);
      const sumB = teamB.reduce((s, p) => s + p.rating, 0);
      const diff = Math.abs(sumA - sumB);
      if (diff < bestDiff) {
        bestDiff = diff; bestTeamA = teamA; bestTeamB = teamB; bestSumA = sumA; bestSumB = sumB;
      }
    }
    return { teamA: bestTeamA, teamB: bestTeamB, sumA: bestSumA, sumB: bestSumB };
  }

  document.getElementById('clear-saved-btn').onclick = () => {
    localStorage.removeItem(getSavedKey());
    savedSection.classList.remove('show');
    savedContent.innerHTML = '';
  };

  function loadSaved() {
    try {
      const raw = localStorage.getItem(getSavedKey());
      if (!raw) { savedSection.classList.remove('show'); return; }
      const d = JSON.parse(raw);
      const sA = d.teamA.reduce((s, p) => s + (p.rating || 0), 0);
      const sB = d.teamB.reduce((s, p) => s + (p.rating || 0), 0);
      savedContent.innerHTML = `
        <div class="balance-result-modal show" style="margin-top: 0;">
          <div class="team-box"><h3>Сохранено: Команда А <span>Σ ${sA.toFixed(2)}</span></h3><ul>${d.teamA.map(p => `<li><div class="t-player"><img src="${p.avatar}">${p.name}</div><span>${p.rating.toFixed(2)}</span></li>`).join('')}</ul></div>
          <div class="team-box"><h3>Сохранено: Команда Б <span>Σ ${sB.toFixed(2)}</span></h3><ul>${d.teamB.map(p => `<li><div class="t-player"><img src="${p.avatar}">${p.name}</div><span>${p.rating.toFixed(2)}</span></li>`).join('')}</ul></div>
        </div>`;
      savedSection.classList.add('show');
    } catch (e) {}
  }
}

function initCSV() {
  const btn = document.getElementById('export-csv-btn');
  if (!btn) return;
  btn.onclick = () => {
    const players = currentStats.players;
    const headers = ['Игрок','Карты','Убийства','Смерти','Ассисты','K/D','Рейтинг','ADR','KAST','Форма'];
    const rows = players.map(p => [
      p.displayName || p.name, p.matches, p.kills, p.deaths, p.assists,
      p.kd, p.avgRating || '', p.avgAdr || '', p.avgKast || '', p.form || ''
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const t = document.getElementById('tournament-select').value.replace(/[^a-zа-я0-9]/gi, '_');
    a.download = `stats_${t}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };
}

document.addEventListener('DOMContentLoaded', () => {
  loadData();
  initBalancer();
  initCSV();
});