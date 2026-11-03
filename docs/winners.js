/* docs/winners.js — главная: последний турнир + хронология победителей.
   Источник данных:
     - обычный режим: docs/data/winners.json
     - режим редактирования (?admin): localStorage winnersDraft_v1
   Редактор живёт в docs/winners-admin.js.
*/
(() => {
  'use strict';

  const DATA_URL = 'data/winners.json';
  const PHOTO_BASE = 'img/winners/';
  const ROOT_ID = 'home-winners-root';
  const STORAGE_KEY = 'winnersDraft_v1';
  const ADMIN_FLAG_KEY = 'winnersAdminMode';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function displayName(s) {
    if (typeof aliasText === 'function') {
      try { return aliasText(s); } catch (e) {}
    }
    return s;
  }

  function photoUrl(file) {
    if (!file) return '';
    // Поддерживает Base64 (data:image/...), ссылки и локальные файлы
    if (/^(https?:|data:|blob:)/i.test(file)) return file;
    return PHOTO_BASE + String(file).replace(/^\/+/, '');
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
  }

  function formatDateShort(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

  function readDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) { return null; }
  }

  async function loadData() {
    const admin = isAdminMode();
    if (admin) {
      const draft = readDraft();
      if (draft) return { list: draft, source: 'draft' };
    }
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return { list: Array.isArray(data) ? data : [], source: 'server' };
    } catch (e) {
      if (admin) return { list: [], source: 'empty' };
      throw e;
    }
  }

  window.openWinnerProfile = function (playerId, name) {
    if (typeof openProfile === 'function' && playerId) {
      openProfile(playerId);
      return;
    }
    if (name) alert('Профиль игрока «' + name + '» пока нет в статистике');
  };

  function heroHtml(photoFile, alt) {
    const src = photoUrl(photoFile);
    if (!src) {
      return '<div class="winners-hero"><div class="winners-hero-placeholder">Фото команды пока не загружено</div></div>';
    }
    return `<div class="winners-hero"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy"></div>`;
  }

  function chipsHtml(players) {
    if (!Array.isArray(players)) return '';
    const valid = players.filter((p) => (p && (p.name || p.nick)));
    if (!valid.length) return '';
    const chips = valid.map((p) => {
      const raw = p.name || p.nick || '';
      const shown = displayName(raw);
      const role = p.role || '';
      const pid = p.playerId || '';
      const cls = pid ? 'winner-chip link' : 'winner-chip';
      return `
        <div class="${cls}" data-pid="${esc(pid)}" data-name="${esc(shown)}">
          <span class="nick" title="${esc(shown)}">${esc(shown)}</span>
          ${role ? `<span class="role">${esc(role)}</span>` : ''}
        </div>
      `;
    }).join('');
    return `<div class="winners-players">${chips}</div>`;
  }

  function metaHtml(data) {
    const parts = [];
    if (data.date) parts.push(`<span>${esc(formatDate(data.date))}</span>`);
    if (data.finalScore) parts.push(`<span class="winners-score">Счёт финала: <b>${esc(data.finalScore)}</b></span>`);
    if (!parts.length) return '';
    return `<div class="winners-meta">${parts.join('')}</div>`;
  }

  function tournamentLinkHtml(data) {
    if (!data.url) return '';
    return `<div class="winners-actions"><a class="btn-primary" href="${esc(data.url)}" target="_blank" rel="noopener">Открыть турнир на Cybershoke</a></div>`;
  }

  function currentHtml(data) {
    const title = (data.title || '').trim();
    const head = (title || data.date || data.finalScore)
      ? `<div class="winners-head">
           ${title ? `<h2 class="winners-title">${esc(title)}</h2>` : ''}
           ${metaHtml(data)}
         </div>`
      : '';
    return `
      <div class="winners-current">
        ${heroHtml(data.teamPhoto, title || 'Фото команды-победителя')}
        ${head}
        ${chipsHtml(data.players)}
        ${tournamentLinkHtml(data)}
      </div>
    `;
  }

  function timelineItemHtml(data) {
    const title = (data.title || '').trim() || 'Турнир без названия';
    return `
      <li class="timeline-item">
        <details>
          <summary>
            <span class="tl-date">${esc(formatDateShort(data.date))}</span>
            <span class="tl-title" title="${esc(title)}">${esc(title)}</span>
            ${data.finalScore ? `<span class="tl-score">${esc(data.finalScore)}</span>` : ''}
          </summary>
          <div class="tl-body">
            ${heroHtml(data.teamPhoto, title)}
            ${chipsHtml(data.players)}
            ${tournamentLinkHtml(data)}
          </div>
        </details>
      </li>
    `;
  }

  function draftBannerHtml() {
    return `
      <div class="winners-draft-banner">
        <span>Показаны локальные правки из этого браузера. Обычные посетители их не видят.</span>
        <button class="btn-outline" onclick="window.winnersResetDraft()">Сбросить</button>
      </div>
    `;
  }

  function adminBarHtml() {
    return `
      <div class="winners-admin-bar">
        <button class="btn-primary" onclick="window.openWinnersAdmin()">✏️ Редактировать</button>
      </div>
    `;
  }

  function render(root, list, source) {
    const admin = isAdminMode();
    const tournaments = Array.isArray(list) ? list.filter(Boolean) : [];

    const bar = admin ? adminBarHtml() : '';
    const banner = source === 'draft' ? draftBannerHtml() : '';

    if (tournaments.length === 0) {
      root.innerHTML = `
        ${bar}
        ${banner}
        <p class="winners-empty">Победители пока не добавлены${admin ? '. Нажмите «Редактировать», чтобы заполнить.' : '.'}</p>
      `;
      return;
    }

    const [current, ...past] = tournaments;
    const timelineHtml = past.length
      ? `<div class="winners-timeline">
           <h3 class="winners-timeline-title">Хронология победителей</h3>
           <ol class="timeline-list">${past.map(timelineItemHtml).join('')}</ol>
         </div>`
      : '';

    root.innerHTML = `${bar}${banner}<div class="winners-wrap">${currentHtml(current)}${timelineHtml}</div>`;

    root.querySelectorAll('.winner-chip.link').forEach((chip) => {
      chip.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        window.openWinnerProfile(chip.dataset.pid, chip.dataset.name);
      });
    });

    root.querySelectorAll('.winners-hero img').forEach((img) => {
      img.addEventListener('error', () => {
        const hero = img.closest('.winners-hero');
        if (!hero) return;
        hero.innerHTML = '<div class="winners-hero-placeholder">Фото команды не найдено</div>';
      }, { once: true });
    });
  }

  window.renderWinners = async function () {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    try {
      const { list, source } = await loadData();
      render(root, list, source);
    } catch (e) {
      console.warn('[winners]', e.message);
      root.innerHTML = '<p class="winners-empty">Победители последнего турнира пока не загружены</p>';
    }
  };

  window.winnersResetDraft = function () {
    if (!confirm('Удалить локальные правки и вернуться к файлу с сервера?')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    window.renderWinners();
  };

  window.winnersSaveDraft = function (list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      alert('Не удалось сохранить: ' + e.message + '\n\nСкорее всего, вы добавили слишком много тяжелых фотографий и переполнили память браузера. Попробуйте удалить старые фотографии из хронологии.');
      return false;
    }
  };

  window.winnersReadDraft = readDraft;

  window.winnersDownloadJson = function (list) {
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'winners.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.renderWinners(), { once: true });
  } else {
    window.renderWinners();
  }
})();