/* docs/winners.js — главная: последний турнир + хронология победителей.
   Данные: docs/data/winners.json (массив, новые сверху)
   Фото:   docs/img/winners/<teamPhoto>
   Клик по нику → openProfile(playerId) из app.js.
*/
(() => {
  'use strict';

  const DATA_URL = 'data/winners.json';
  const PHOTO_BASE = 'img/winners/';
  const ROOT_ID = 'home-winners-root';

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
    if (!Array.isArray(players) || players.length === 0) return '';
    const chips = players.map((p) => {
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
    return parts.length ? `<div class="winners-meta">${parts.join('')}</div>` : '';
  }

  function tournamentLinkHtml(data) {
    if (!data.url) return '';
    return `<div class="winners-actions"><a class="btn-primary" href="${esc(data.url)}" target="_blank" rel="noopener">Открыть турнир на Cybershoke</a></div>`;
  }

  function currentHtml(data) {
    const title = data.title || 'Победители последнего турнира';
    return `
      <div class="winners-current">
        ${heroHtml(data.teamPhoto, title)}
        <div class="winners-head">
          <h2 class="winners-title">${esc(title)}</h2>
          ${metaHtml(data)}
        </div>
        ${chipsHtml(data.players)}
        ${tournamentLinkHtml(data)}
      </div>
    `;
  }

  function timelineItemHtml(data) {
    const title = data.title || 'Турнир';
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

  function render(root, list) {
    const tournaments = Array.isArray(list) ? list.filter(Boolean) : [];
    if (tournaments.length === 0) {
      root.innerHTML = '<p class="winners-empty">Победители пока не добавлены</p>';
      return;
    }

    const [current, ...past] = tournaments;

    const timelineHtml = past.length
      ? `
        <div class="winners-timeline">
          <h3 class="winners-timeline-title">Хронология победителей</h3>
          <ol class="timeline-list">
            ${past.map(timelineItemHtml).join('')}
          </ol>
        </div>
      `
      : '';

    root.innerHTML = `<div class="winners-wrap">${currentHtml(current)}${timelineHtml}</div>`;

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

  async function boot() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('winners.json не найден (HTTP ' + res.status + ')');
      const data = await res.json();
      render(root, data);
    } catch (e) {
      console.warn('[winners]', e.message);
      root.innerHTML = '<p class="winners-empty">Победители последнего турнира пока не загружены</p>';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();