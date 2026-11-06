// collect.js — ИСПРАВЛЕННЫЙ (С защитой от несыгранных карт в Bo3 и умным выбором финального пакета данных)
import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MATCHES_FILE = path.join(__dirname, 'data', 'matches.txt');
const MATCHES_DIR = path.join(__dirname, 'data', 'matches');

async function main() {
  await fs.ensureDir(MATCHES_DIR);
  const lines = (await fs.readFile(MATCHES_FILE, 'utf-8')).split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  if (lines.length === 0) return console.log('Нет ссылок.');
  console.log(`Найдено ${lines.length} строк.`);

  const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--start-maximized'] });
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
    
    // Проверка: если уже скачано — пропускаем
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
    const collectedMaps = new Map();

    const seenSignatures = new Set();
    const signatureOf = (players) =>
      players.map(p => `${p.id}_${p.kills}_${p.deaths}`).sort().join('|');

    try {
      await page.addInitScript(() => {
        window.__CAPTURED_API = [];
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
          const response = await originalFetch(...args);
          const clone = response.clone();
          clone.text().then(text => {
            if (text.includes('kills') && text.includes('deaths')) window.__CAPTURED_API.push(text);
          }).catch(()=>{});
          return response;
        };
        const origXHR = window.XMLHttpRequest.prototype.open;
        window.XMLHttpRequest.prototype.open = function() {
          this.addEventListener('load', function() {
            if (this.responseText && this.responseText.includes('kills') && this.responseText.includes('deaths')) {
              window.__CAPTURED_API.push(this.responseText);
            }
          });
          return origXHR.apply(this, arguments);
        };
      });

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000); 

      let initialCaptured = await page.evaluate(() => window.__CAPTURED_API || []);
      if (initialCaptured.length > 0) {
          for (const raw of initialCaptured) {
              try {
                  const parsed = JSON.parse(raw);
                  const maps = extractStrictMaps(parsed);
                  for (const m of maps) {
                      if (!collectedMaps.has(m.map)) {
                          collectedMaps.set(m.map, m);
                          seenSignatures.add(signatureOf(m.players));
                          console.log(`    [${m.map}] УСПЕХ (авто)! Игроков: ${m.players.length}`);
                      }
                  }
              } catch(e){}
          }
      }

      const mapNames = await page.evaluate(() => {
        const text = document.body.innerText;
        const matches = text.match(/(de_[a-z0-9_]+|cs_[a-z0-9_]+)/g);
        return matches ? [...new Set(matches)] : [];
      });

      for (const mapName of mapNames) {
        if (collectedMaps.has(mapName)) continue;

        await page.evaluate(() => { window.__CAPTURED_API = []; });
        
        const clicked = await page.evaluate((name) => {
          const el = Array.from(document.querySelectorAll('*')).find(e => 
            e.textContent.trim().toLowerCase() === name.toLowerCase() && e.children.length === 0
          );
          if (el) { el.click(); return true; }
          return false;
        }, mapName);

        if (clicked) {
          console.log(`  Клик по [${mapName}], ждем...`);
          await page.waitForTimeout(3000); 
          
          const capturedData = await page.evaluate(() => window.__CAPTURED_API);
          
          if (capturedData.length > 0) {
            // УМНЫЙ ВЫБОР: Ищем пакет данных, где сумма K+D максимальна (это финал игры)
            let bestPayload = null;
            let maxScore = -1;

            for (const raw of capturedData) {
              try {
                const parsed = JSON.parse(raw);
                const players = extractPlayersStrict(parsed);
                if (players.length === 10) {
                   const totalScore = players.reduce((sum, p) => sum + p.kills + p.deaths, 0);
                   if (totalScore > maxScore) {
                     maxScore = totalScore;
                     bestPayload = raw;
                   }
                }
              } catch(e) {}
            }

            const rawJson = bestPayload || capturedData[capturedData.length - 1]; 
            
            try {
              const parsed = JSON.parse(rawJson);
              const players = extractPlayersStrict(parsed);
              
              if (players.length > 0) {
                const currentSignature = signatureOf(players);

                if (seenSignatures.has(currentSignature)) {
                    console.log(`    [${mapName}] ПРОПУЩЕНО (состав уже собран — карта не игралась).`);
                    continue;
                }

                collectedMaps.set(mapName, { map: mapName, players });
                seenSignatures.add(currentSignature);
                console.log(`    [${mapName}] УСПЕХ! Игроков: ${players.length}`);
              }
            } catch (e) {}
          } else {
            console.log(`    [${mapName}] API молчит. Пропускаем.`);
          }
        }
      }

      if (collectedMaps.size > 0) {
        const uniqueMaps = Array.from(collectedMaps.values());
        await fs.writeJson(outFile, { matchId, url, tournament: tournamentName, date: new Date().toISOString(), maps: uniqueMaps }, { spaces: 2 });
        console.log(`  Файл сохранен: ${matchId}.json (карт: ${uniqueMaps.length})`);
      }
    } catch (err) {
      console.error(`  Ошибка:`, err.message);
    }
  }

  await browser.close();
  console.log('Сбор завершен!');
}

function extractPlayersStrict(obj) {
  let bestPlayers = [];
  function traverse(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      const valid = node.filter(isPlayerObject);
      if (valid.length === 10) { bestPlayers = valid; return; }
      if (valid.length > bestPlayers.length && valid.length < 10) bestPlayers = valid;
      node.forEach(traverse);
    } else {
      Object.values(node).forEach(traverse);
    }
  }
  traverse(obj);
  
  const unique = [];
  const seen = new Set();
  for (const p of bestPlayers) {
    let id = p.steam_id || p.steamid || p.steamId || p.user_id || p.player_id || p.uuid || p.id;
    if (id) id = String(id).trim();
    else id = 'name_' + extractName(p).toLowerCase().replace(/[^a-z0-9а-я]/gi, '');
    
    if (id && !seen.has(id)) {
      seen.add(id);
      unique.push(formatPlayer(p));
    }
  }
  return unique;
}

function extractStrictMaps(obj) {
  let found = [];
  function traverse(current, depth = 0) {
    if (!current || typeof current !== 'object' || depth > 10) return;
    if (current.map || current.mapName) {
      const players = extractPlayersStrict(current); 
      if (players && players.length > 0) {
        let mName = current.map?.name || current.map || current.mapName;
        found.push({ map: mName, players: players });
        return;
      }
    }
    if (Array.isArray(current)) current.forEach(item => traverse(item, depth + 1));
    else for (const key in current) traverse(current[key], depth + 1);
  }
  traverse(obj);
  return found;
}

function formatPlayer(p) {
  const s = p.stats || {};
  return {
    id: extractId(p), name: extractName(p),
    kills: safeNum(p.kills ?? p.k ?? s.kills ?? s.k),
    deaths: safeNum(p.deaths ?? p.d ?? s.deaths ?? s.d),
    assists: safeNum(p.assists ?? p.a ?? s.assists ?? s.a),
    adr: safeNum(p.adr ?? s.adr) || null, kast: safeNum(p.kast ?? s.kast) || null,
    rating: safeNum(p.rating ?? p.rating2 ?? s.rating ?? s.rating2) || null
  };
}

function isPlayerObject(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.players && Array.isArray(obj.players)) return false;
  if (obj.weapon_id || obj.weapon || obj.gun) return false;
  const nameStr = String(obj.name || obj.nickname || obj.username || obj.nick || '').toLowerCase();
  const weapons = ['ak47', 'ak-47', 'm4a1', 'awp', 'galil', 'famas', 'deagle', 'desert eagle', 'glock', 'usp', 'p90', 'mp5', 'sg553', 'aug', 'ssg08', 'scar', 'g3sg1', 'negev', 'm249', 'mac10', 'ump45', 'bizon', 'mp7', 'mp9', 'mag7', 'xm1014', 'sawedoff', 'nova', 'm4a4', 'm4a1-s', 'tec9', 'five-seven', 'cz75', 'p250', 'dual berettas', 'knife', 'hegrenade', 'flashbang', 'smokegrenade', 'molotov', 'incgrenade'];
  if (weapons.includes(nameStr)) return false;
  const hasName = !!(obj.name || obj.nickname || obj.username || obj.nick || (obj.player && obj.player.name));
  if (!hasName) return false;
  const s = obj.stats || {};
  return obj.kills !== undefined || obj.k !== undefined || obj.deaths !== undefined || obj.d !== undefined || obj.assists !== undefined || obj.adr !== undefined || obj.kast !== undefined || obj.rating !== undefined || obj.steam_id !== undefined || obj.steamid !== undefined || s.kills !== undefined || s.deaths !== undefined || s.adr !== undefined;
}

function extractId(p) {
  let id = p.steam_id || p.steamid || p.steamId || p.user_id || p.player_id || p.uuid || p.id || (p.player && p.player.id);
  if (!id) id = 'name_' + extractName(p).toLowerCase().replace(/[^a-z0-9а-я]/gi, '');
  return String(id).trim();
}

function extractName(p) {
  let n = p.nickname || p.name || p.username || p.nick || p.steam_nickname || (p.player && (p.player.name || p.player.nickname));
  if (typeof n === 'object' && n !== null) n = n.name || n.nickname || n.title || n.value;
  return (n && typeof n === 'string') ? n.trim() : 'Unknown';
}

function safeNum(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') { const n = parseFloat(val); return isNaN(n) ? 0 : n; }
  if (typeof val === 'object') return safeNum(val.total ?? val.value ?? val.count ?? 0);
  return 0;
}

function extractMatchId(url) {
  const m = url.match(/\/match\/(\d+)/);
  return m ? m[1] : null;
}

main().catch(err => {
  console.error('Критическая ошибка:', err);
  process.exit(1);
});