// collect.js — ПАРСИНГ DOM СТРАНИЦЫ МАТЧА (правильные K/D/A, включая ассисты)
import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MATCHES_FILE = path.join(__dirname, 'data', 'matches.txt');
const MATCHES_DIR = path.join(__dirname, 'data', 'matches');

async function main() {
  await fs.ensureDir(MATCHES_DIR);
  const lines = (await fs.readFile(MATCHES_FILE, 'utf-8'))
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  if (lines.length === 0) return console.log('Нет ссылок.');
  console.log(`Найдено ${lines.length} строк.`);

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--start-maximized']
  });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let tournamentName = 'Без турнира';
    let url = line;

    if (line.includes('|')) {
      const parts = line.split('|');
      tournamentName = parts[0].trim();
      url = parts[1].trim();
    }

    const matchId = extractMatchId(url);
    if (!matchId) continue;

    const outFile = path.join(MATCHES_DIR, `${matchId}.json`);

    // Пропускаем уже собранные
    if (await fs.pathExists(outFile)) {
      try {
        const existing = await fs.readJson(outFile);
        if (existing && existing.maps && existing.maps.length > 0) {
          console.log(`[${i + 1}/${lines.length}] Матч ${matchId} уже собран. Пропускаем.`);
          continue;
        }
      } catch (e) {}
    }

    console.log(`[${i + 1}/${lines.length}] Открываем ${url} (Турнир: ${tournamentName}) ...`);

    const collectedMaps = [];
    const seenMapSignatures = new Set();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(6000);

      // 1. Находим все названия карт
      const mapNames = await page.evaluate(() => {
        const text = document.body.innerText;
        const matches = text.match(/(de_[a-z0-9_]+|cs_[a-z0-9_]+)/g);
        return matches ? [...new Set(matches)] : [];
      });

      for (const mapName of mapNames) {
        if (collectedMaps.some(m => m.map === mapName)) continue;

        const clicked = await page.evaluate((name) => {
          const el = Array.from(document.querySelectorAll('*')).find(e =>
            e.textContent.trim().toLowerCase() === name.toLowerCase() &&
            e.children.length === 0
          );
          if (el) { el.click(); return true; }
          return false;
        }, mapName);

        if (!clicked) {
          console.log(`  [${mapName}] Не найден элемент для клика. Пропускаем.`);
          continue;
        }

        console.log(`  Клик по [${mapName}], ждём загрузки...`);
        await page.waitForTimeout(4000);

        // 2. Парсим DOM: игроки с K/D/A
        const players = await page.evaluate(() => {
          const result = [];
          const seenIds = new Set();

          const allElements = document.querySelectorAll('div, span, td, b, strong');
          for (const el of allElements) {
            const text = el.textContent.replace(/\s+/g, ' ').trim();
            if (!/^\d+\/\d+\/\d+$/.test(text)) continue;

            let container = el;
            let profileLink = null;
            while (container && container !== document.body) {
              const links = container.querySelectorAll('a[href*="/profile/"]');
              if (links.length > 0) {
                profileLink = Array.from(links).find(a => {
                  const href = a.getAttribute('href') || '';
                  return /\/profile\/\d+/.test(href);
                });
                if (profileLink) break;
              }
              container = container.parentElement;
            }

            if (!profileLink) continue;

            const href = profileLink.getAttribute('href');
            const idMatch = href.match(/\/profile\/(\d+)/);
            if (!idMatch) continue;
            const id = idMatch[1];
            if (seenIds.has(id)) continue;

            const nameLink = Array.from(container.querySelectorAll('a[href*="/profile/"]'))
              .find(a => a.textContent.trim().length > 0);
            const name = nameLink ? nameLink.textContent.trim() : 'St1gmat';
            const avatar = container.querySelector('img')?.getAttribute('src') || null;

            const [kills, deaths, assists] = text.split('/').map(Number);

            seenIds.add(id);
            result.push({
              id, name, avatar,
              kills, deaths, assists,
              adr: null, kast: null, rating: null
            });
          }

          return result;
        });

        if (players.length === 0) {
          console.log(`  [${mapName}] Не удалось найти игроков в DOM. Пропускаем.`);
          continue;
        }

        const signature = players.map(p => `${p.id}_${p.kills}_${p.deaths}`).sort().join('|');
        if (seenMapSignatures.has(signature)) {
          console.log(`  [${mapName}] ПРОПУЩЕНО (состав уже собран).`);
          continue;
        }

        seenMapSignatures.add(signature);
        collectedMaps.push({ map: mapName, players });
        console.log(`  [${mapName}] УСПЕХ! Игроков: ${players.length}`);
      }

      if (collectedMaps.length > 0) {
        await fs.writeJson(
          outFile,
          {
            matchId, url,
            tournament: tournamentName,
            date: new Date().toISOString(),
            maps: collectedMaps
          },
          { spaces: 2 }
        );
        console.log(`  Файл сохранён: ${matchId}.json (карт: ${collectedMaps.length})`);
      } else {
        console.log(`  Не удалось собрать ни одной карты для ${matchId}`);
      }
    } catch (err) {
      console.error(`  Ошибка:`, err.message);
    }
  }

  await browser.close();
  console.log('Сбор завершён!');
}

function extractMatchId(url) {
  const m = url.match(/\/match\/(\d+)/);
  return m ? m[1] : null;
}

main().catch(err => {
  console.error('Критическая ошибка:', err);
  process.exit(1);
});
