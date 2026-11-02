let statsData = null;
let myChart = null;
let profChart = null;

async function loadData() {
  try {
    const res = await fetch('data/stats.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    statsData = await res.json();
    renderAll();
  } catch (err) {
    document.getElementById('meta-info').textContent = 'Ошибка загрузки данных.';
  }
}

function renderAll() {
  document.getElementById('meta-info').innerHTML = `Матчей: <b>${statsData.matchesCount}</b> | Игроков: <b>${statsData.players.length}</b>`;
  
  if (statsData.funStats) {
    document.getElementById('stat-kills').innerText = statsData.funStats.totalKills;
    document.getElementById('stat-deaths').innerText = statsData.funStats.totalDeaths;
    document.getElementById('stat-hours').innerText = statsData.funStats.totalHours + " ч.";
  }

  renderPlayersTable();
  renderMapStats();
  initDuel();
  renderBalancer();
}

function renderPlayersTable() {
  const tbody = document.querySelector('#players-table tbody');
  const filterInput = document.getElementById('filter-name');
  const sortSelect = document.getElementById('sort-by');

  function draw() {
    const filter = filterInput.value.toLowerCase();
    const sortKey = sortSelect.value;

    let players = [...statsData.players].filter(p => (p.displayName || p.name).toLowerCase().includes(filter));
    players.sort((a, b) => {
      if (sortKey === 'deaths') return b.deaths - a.deaths;
      if (sortKey === 'kd') return b.kd - a.kd;
      return (b.avgRating ?? 0) - (a.avgRating ?? 0);
    });

    tbody.innerHTML = players.map((p) => `
      <tr>
        <td>
          <div class="player-cell">
            <img src="${p.avatar}" class="player-avatar" onerror="this.src='https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg'">
            <div>
              <strong class="player-link" onclick="openProfile('${p.id}')">${p.displayName || p.name}</strong>
            </div>
          </div>
        </td>
        <td>${p.matches}</td>
        <td><strong>${p.kd}</strong></td>
        <td style="color: var(--accent); font-weight: 600;">${p.avgRating ?? '—'}</td>
        <td><span class="player-title">${p.title || ''}</span></td>
      </tr>
    `).join('');
  }

  filterInput.addEventListener('input', draw);
  sortSelect.addEventListener('change', draw);
  draw();
}

function renderMapStats() {
  const tbody = document.querySelector('#maps-table tbody');
  if (!tbody || !statsData.mapStats) return;

  tbody.innerHTML = statsData.mapStats.map(m => `
    <tr>
      <td><strong>${m.map}</strong></td>
      <td>${m.matches}</td>
      <td>${m.avgKd}</td>
      <td style="color: var(--accent); font-weight: 600;">${m.avgRating}</td>
    </tr>
  `).join('');
}

function initDuel() {
  const p1Select = document.getElementById('duel-p1');
  const p2Select = document.getElementById('duel-p2');
  const btn = document.getElementById('duel-btn');
  const resultDiv = document.getElementById('duel-result');

  const options = statsData.players.map(p => `<option value="${p.id}">${p.displayName || p.name}</option>`).join('');
  p1Select.innerHTML = options;
  p2Select.innerHTML = options;

  btn.addEventListener('click', () => {
    const p1 = statsData.players.find(p => p.id === p1Select.value);
    const p2 = statsData.players.find(p => p.id === p2Select.value);
    
    if (!p1 || !p2) return;
    if (p1.id === p2.id) return alert('Выбери двух разных людей!');

    const compare = (val1, val2, higherIsBetter = true) => {
      if (val1 === val2) return ['', ''];
      if (higherIsBetter) return val1 > val2 ? ['duel-winner', 'duel-loser'] : ['duel-loser', 'duel-winner'];
      return val1 < val2 ? ['duel-winner', 'duel-loser'] : ['duel-loser', 'duel-winner'];
    };

    const [classKd1, classKd2] = compare(p1.kd, p2.kd);
    const [classRat1, classRat2] = compare(p1.avgRating ?? 0, p2.avgRating ?? 0);
    const [classAdr1, classAdr2] = compare(p1.avgAdr ?? 0, p2.avgAdr ?? 0);
    const [classKast1, classKast2] = compare(p1.avgKast ?? 0, p2.avgKast ?? 0);
    
    // Определяем победителя по Рейтингу (если он есть), иначе по K/D
    const p1Score = p1.avgRating ?? p1.kd;
    const p2Score = p2.avgRating ?? p2.kd;
    const winnerName = p1Score > p2Score ? (p1.displayName || p1.name) : (p2.displayName || p2.name);

    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div class="duel-row">
        <span class="${classKd1}">${p1.kd} K/D</span>
        <span style="font-weight:bold;color:var(--text-muted);">K/D</span>
        <span class="${classKd2}">${p2.kd} K/D</span>
      </div>
      <div class="duel-row">
        <span class="${classRat1}">${p1.avgRating ?? '—'} Рейтинг</span>
        <span style="font-weight:bold;color:var(--text-muted);">RATING</span>
        <span class="${classRat2}">${p2.avgRating ?? '—'} Рейтинг</span>
      </div>
      <div class="duel-row">
        <span class="${classAdr1}">${p1.avgAdr ?? '—'} ADR</span>
        <span style="font-weight:bold;color:var(--text-muted);">ADR</span>
        <span class="${classAdr2}">${p2.avgAdr ?? '—'} ADR</span>
      </div>
      <div class="duel-row">
        <span class="${classKast1}">${p1.avgKast ?? '—'} KAST</span>
        <span style="font-weight:bold;color:var(--text-muted);">KAST</span>
        <span class="${classKast2}">${p2.avgKast ?? '—'} KAST</span>
      </div>
      <div class="duel-row">
        <span>${p1.matches} карт</span>
        <span style="font-weight:bold;color:var(--text-muted);">ОПЫТ</span>
        <span>${p2.matches} карт</span>
      </div>
      <div style="text-align:center; margin-top:15px; font-weight:bold; font-size:1.2rem; color:#fff;">
        Победитель: <span style="color:#10b981;">${winnerName}</span> 🏆
      </div>
    `;
  });
}

function openProfile(playerId) {
  const p = statsData.players.find(pl => pl.id === playerId);
  if (!p) return;

  document.getElementById('prof-avatar').src = p.avatar;
  document.getElementById('prof-name').innerText = p.displayName || p.name;
  document.getElementById('prof-title').innerText = p.title || '';
  document.getElementById('prof-matches').innerText = p.matches;
  document.getElementById('prof-kd').innerText = p.kd;
  document.getElementById('prof-rating').innerText = p.avgRating ?? '—';
  document.getElementById('prof-adr').innerText = p.avgAdr ?? '—';
  document.getElementById('prof-kast').innerText = p.avgKast ?? '—';

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
      data: {
        labels: sortedHist.map(h => new Date(h.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })),
        datasets: [{ label: 'Рейтинг', data: sortedHist.map(h => h.rating), borderColor: '#4d6bfe', backgroundColor: 'rgba(77, 107, 254, 0.1)', fill: true, tension: 0.3 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: '#8b96a5' } }, y: { grid: { color: '#262f40' }, ticks: { color: '#8b96a5' } } } }
    });
  }

  document.getElementById('profile-modal').style.display = 'block';
}

function closeProfile() { document.getElementById('profile-modal').style.display = 'none'; }
window.onclick = function(event) { if (event.target == document.getElementById('profile-modal')) closeProfile(); }

function renderBalancer() {
  const container = document.getElementById('balancer-players');
  const btn = document.getElementById('balance-btn');
  const result = document.getElementById('balance-result');

  container.innerHTML = statsData.players.map(p => `
    <label>
      <input type="checkbox" value="${p.id}" data-name="${p.displayName || p.name}" data-rating="${p.avgRating ?? 0}">
      <span>${p.displayName || p.name}</span>
    </label>
  `).join('');

  btn.addEventListener('click', () => {
    const checked = Array.from(container.querySelectorAll('input:checked'));
    if (checked.length !== 10) return alert('Выберите ровно 10 игроков.');
    const selected = checked.map(cb => ({ name: cb.dataset.name, rating: parseFloat(cb.dataset.rating) || 0 }));
    selected.sort((a, b) => b.rating - a.rating);
    const teamA = [], teamB = [];
    let sumA = 0, sumB = 0;
    selected.forEach(p => { if (sumA <= sumB) { teamA.push(p); sumA += p.rating; } else { teamB.push(p); sumB += p.rating; } });
    result.innerHTML = `<div class="balance-team"><h4>Команда А</h4><ul>${teamA.map(p => `<li>${p.name}</li>`).join('')}</ul></div><div class="balance-team"><h4>Команда Б</h4><ul>${teamB.map(p => `<li>${p.name}</li>`).join('')}</ul></div>`;
  });
}

loadData();