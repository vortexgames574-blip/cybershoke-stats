/* docs/winners-admin.js — редактор победителей. */
(() => {
  'use strict';

  const STORAGE_KEY = 'winnersDraft_v1';
  const ADMIN_FLAG_KEY = 'winnersAdminMode';
  const MODAL_ID = 'winners-admin-modal';

  let draft = null;
  let activeIdx = 0;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isAdminMode() {
    try {
      if (new URLSearchParams(location.search).has('admin')) {
        localStorage.setItem(ADMIN_FLAG_KEY, '1');
        return true;
      }
      return localStorage.getItem(ADMIN_FLAG_KEY) === '1';
    } catch (e) { return false; }
  }

  function getStatsPlayers() {
    try {
      if (typeof currentStats === 'undefined' || !currentStats) return [];
      return Array.isArray(currentStats.players) ? currentStats.players : [];
    } catch (e) { return []; }
  }

  async function loadInitialList() {
    const fromDraft = window.winnersReadDraft ? window.winnersReadDraft() : null;
    if (fromDraft) return fromDraft;
    try {
      const res = await fetch('data/winners.json', { cache: 'no-cache' });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal';
    modal.style.display = 'none';
    modal.innerHTML = `
      <div class="modal-content glass-card winners-admin-modal">
        <span class="close-btn" onclick="closeWinnersAdmin()">×</span>
        <div class="card-header"><h2>Редактор победителей</h2></div>
        <div class="wa-layout">
          <aside class="wa-list">
            <div class="wa-list-items" id="wa-list"></div>
            <button class="btn-outline" id="wa-add">+ Добавить турнир</button>
          </aside>
          <section class="wa-form" id="wa-form"></section>
        </div>
        <div class="wa-actions">
          <button class="btn-primary" id="wa-save">Сохранить (в этом браузере)</button>
          <button class="btn-outline" id="wa-download">Скачать winners.json</button>
          <button class="btn-outline danger" id="wa-reset">Сбросить правки</button>
          <button class="btn-outline" id="wa-exit">Выйти из редактора</button>
        </div>
        <p class="wa-note" style="margin-top:10px;">
          Первый турнир в списке — большой блок на главной, остальные уходят в хронологию.
          Стрелки ↑↓ меняют порядок. После правок нажмите «Скачать winners.json» и замените
          файл <code>docs/data/winners.json</code> в проекте, затем закоммитьте.
        </p>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function renderList() {
    const list = document.getElementById('wa-list');
    if (!list) return;
    if (!draft.length) {
      list.innerHTML = '<p class="wa-note">Пока нет турниров.</p>';
      return;
    }
    list.innerHTML = draft.map((t, i) => `
      <div class="wa-list-item ${i === activeIdx ? 'active' : ''}" data-idx="${i}">
        <span class="wa-li-title">${esc((t.title || '').trim() || 'Без названия')}</span>
        <span class="wa-li-move">
          <button class="wa-move" data-move="-1" data-idx="${i}" title="Выше" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="wa-move" data-move="1" data-idx="${i}" title="Ниже" ${i === draft.length - 1 ? 'disabled' : ''}>↓</button>
        </span>
      </div>
    `).join('');

    list.querySelectorAll('.wa-list-item').forEach((el) => {
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.wa-move')) return;
        activeIdx = Number(el.dataset.idx);
        renderList();
        renderForm();
      });
    });

    list.querySelectorAll('.wa-move').forEach((btn) => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const idx = Number(btn.dataset.idx);
        const dir = Number(btn.dataset.move);
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= draft.length) return;
        readFormIntoDraft();
        const [item] = draft.splice(idx, 1);
        draft.splice(newIdx, 0, item);
        activeIdx = newIdx;
        renderList();
        renderForm();
      });
    });
  }

  function playerListHtml() {
    const players = getStatsPlayers();
    const names = new Set();
    for (const p of players) {
      if (p.name) names.add(p.name);
      if (p.displayName) names.add(p.displayName);
      if (typeof aliasText === 'function') {
        try {
          const a = aliasText(p.displayName || p.name);
          if (a) names.add(a);
        } catch (e) {}
      }
    }
    return Array.from(names).sort().map((n) => `<option value="${esc(n)}"></option>`).join('');
  }

  function photoPreviewHtml(photo) {
    if (!photo) {
      return `<div class="wa-photo-preview"><div class="wa-empty">Нет фото</div></div>`;
    }
    const src = /^(https?:|data:|blob:)/i.test(photo)
      ? photo
      : 'img/winners/' + String(photo).replace(/^\/+/, '');
    return `<div class="wa-photo-preview"><img src="${esc(src)}" alt=""></div>`;
  }

  function renderForm() {
    const form = document.getElementById('wa-form');
    if (!form) return;
    if (!draft.length) {
      form.innerHTML = '<p class="wa-note">Нет турниров. Нажмите «+ Добавить турнир» слева.</p>';
      return;
    }
    if (activeIdx >= draft.length) activeIdx = draft.length - 1;
    const t = draft[activeIdx];
    const players = Array.isArray(t.players) ? t.players : [];

    const playerRows = players.map((p, i) => `
      <div class="wa-player-row" data-i="${i}">
        <input type="text" list="wa-players-dl" placeholder="Ник" value="${esc(p.name || '')}" data-field="name">
        <input type="text" placeholder="Роль" value="${esc(p.role || '')}" data-field="role">
        <button class="wa-remove" title="Удалить">×</button>
      </div>
    `).join('');

    form.innerHTML = `
      <datalist id="wa-players-dl">${playerListHtml()}</datalist>
      <div class="wa-field">
        <label>Название турнира (можно оставить пустым)</label>
        <input type="text" id="wa-title" value="${esc(t.title || '')}" placeholder="Например: Cybershoke Autumn Cup 2026">
      </div>
      <div class="wa-field">
        <label>Дата</label>
        <input type="date" id="wa-date" value="${esc((t.date || '').slice(0, 10))}">
      </div>
      <div class="wa-field">
        <label>Счёт финала</label>
        <input type="text" id="wa-score" value="${esc(t.finalScore || '')}" placeholder="2 : 1">
      </div>
      <div class="wa-field">
        <label>Ссылка на турнир (Cybershoke)</label>
        <input type="url" id="wa-url" value="${esc(t.url || '')}" placeholder="https://cybershoke.net/...">
      </div>
      <div class="wa-field">
        <label>Фото команды — имя файла из папки <code>docs/img/winners/</code></label>
        <div class="wa-photo">
          ${photoPreviewHtml(t.teamPhoto)}
          <div style="display:flex; flex-direction:column; gap:6px; flex:1;">
            <input type="text" id="wa-photo-name" value="${esc(t.teamPhoto || '')}" placeholder="team-2026-autumn.jpg">
            <button class="btn-outline" id="wa-photo-clear" style="font-size:0.8rem; align-self:flex-start;">Очистить фото</button>
            <span class="wa-note">Файл с этим именем должен лежать в <code>docs/img/winners/</code>. Регистр важен: <code>Team.jpg</code> ≠ <code>team.jpg</code>.</span>
          </div>
        </div>
      </div>
      <div class="wa-field">
        <label>Игроки</label>
        <div class="wa-players" id="wa-players">${playerRows}</div>
        <button class="btn-outline" id="wa-add-player" style="font-size:0.85rem; align-self:flex-start;">+ Добавить игрока</button>
      </div>
    `;

    bindFormEvents();
  }

  function readFormIntoDraft() {
    if (!draft.length) return;
    const t = draft[activeIdx];
    t.title = (document.getElementById('wa-title')?.value || '').trim();
    t.date = document.getElementById('wa-date')?.value || '';
    t.finalScore = (document.getElementById('wa-score')?.value || '').trim();
    t.url = (document.getElementById('wa-url')?.value || '').trim();
    t.teamPhoto = (document.getElementById('wa-photo-name')?.value || '').trim();

    const rows = document.querySelectorAll('#wa-players .wa-player-row');
    const statsPlayers = getStatsPlayers();
    t.players = Array.from(rows).map((row) => {
      const name = (row.querySelector('[data-field="name"]')?.value || '').trim();
      const role = (row.querySelector('[data-field="role"]')?.value || '').trim();
      const match = findPlayer(name, statsPlayers);
      return {
        playerId: match ? String(match.id || '') : '',
        name,
        role,
      };
    }).filter((p) => p.name);
  }

  function findPlayer(name, list) {
    if (!name) return null;
    const target = name.toLowerCase();
    for (const p of list) {
      const raw = (p.name || '').toLowerCase();
      const disp = (p.displayName || '').toLowerCase();
      let alias = '';
      if (typeof aliasText === 'function') {
        try { alias = String(aliasText(p.displayName || p.name) || '').toLowerCase(); } catch (e) {}
      }
      if (raw === target || disp === target || alias === target) return p;
    }
    return null;
  }

  function bindFormEvents() {
    const title = document.getElementById('wa-title');
    if (title) title.addEventListener('input', () => {
      readFormIntoDraft();
      renderList();
    });

    const addPlayer = document.getElementById('wa-add-player');
    if (addPlayer) addPlayer.addEventListener('click', () => {
      readFormIntoDraft();
      draft[activeIdx].players = (draft[activeIdx].players || []).concat([{ playerId: '', name: '', role: '' }]);
      renderForm();
    });

    document.querySelectorAll('#wa-players .wa-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = btn.closest('.wa-player-row');
        const i = Number(row.dataset.i);
        readFormIntoDraft();
        draft[activeIdx].players.splice(i, 1);
        renderForm();
      });
    });

    document.querySelectorAll('#wa-players input[data-field="name"]').forEach((inp) => {
      inp.addEventListener('change', () => {
        readFormIntoDraft();
        const row = inp.closest('.wa-player-row');
        const i = Number(row.dataset.i);
        const player = findPlayer(inp.value.trim(), getStatsPlayers());
        if (player) {
          draft[activeIdx].players[i].playerId = String(player.id || '');
          renderForm();
        }
      });
    });

    const photoName = document.getElementById('wa-photo-name');
    if (photoName) photoName.addEventListener('input', () => {
      readFormIntoDraft();
      const preview = document.querySelector('.wa-photo-preview');
      if (preview) preview.outerHTML = photoPreviewHtml(draft[activeIdx].teamPhoto);
    });

    const photoClear = document.getElementById('wa-photo-clear');
    if (photoClear) photoClear.addEventListener('click', () => {
      readFormIntoDraft();
      draft[activeIdx].teamPhoto = '';
      renderForm();
    });
  }

  function bindActions() {
    document.getElementById('wa-add').addEventListener('click', () => {
      draft.push({ title: 'Новый турнир', date: '', finalScore: '', url: '', teamPhoto: '', players: [] });
      activeIdx = draft.length - 1;
      renderList();
      renderForm();
    });

    document.getElementById('wa-save').addEventListener('click', () => {
      readFormIntoDraft();
      if (window.winnersSaveDraft && window.winnersSaveDraft(draft)) {
        renderList();
        if (window.renderWinners) window.renderWinners();
        const btn = document.getElementById('wa-save');
        const prev = btn.textContent;
        btn.textContent = '✓ Сохранено';
        setTimeout(() => { btn.textContent = prev; }, 1500);
      }
    });

    document.getElementById('wa-download').addEventListener('click', () => {
      readFormIntoDraft();
      if (window.winnersDownloadJson) window.winnersDownloadJson(draft);
    });

    document.getElementById('wa-reset').addEventListener('click', () => {
      if (!confirm('Удалить все локальные правки и вернуться к серверному winners.json?')) return;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      draft = [];
      activeIdx = 0;
      renderList();
      renderForm();
      if (window.renderWinners) window.renderWinners();
    });

    document.getElementById('wa-exit').addEventListener('click', () => {
      try { localStorage.removeItem(ADMIN_FLAG_KEY); } catch (e) {}
      closeWinnersAdmin();
      if (window.renderWinners) window.renderWinners();
    });
  }

  window.openWinnersAdmin = async function () {
    if (!isAdminMode()) return;
    if (!draft) draft = await loadInitialList();
    if (!Array.isArray(draft)) draft = [];
    if (activeIdx >= draft.length) activeIdx = 0;
    const modal = ensureModal();
    modal.style.display = 'block';
    renderList();
    renderForm();
  };

  window.closeWinnersAdmin = function () {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
  };

  document.addEventListener('DOMContentLoaded', () => {
    if (!isAdminMode()) return;
    ensureModal();
    bindActions();
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.addEventListener('click', (ev) => {
      if (ev.target === modal) closeWinnersAdmin();
    });
  });
})();