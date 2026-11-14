// collect.js — Скачивание демки (ZIP/BZ2) + Парсинг awpy + Склейка с DOM
import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import AdmZip from 'adm-zip';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MATCHES_FILE = path.join(__dirname, 'data', 'matches.txt');
const MATCHES_DIR = path.join(__dirname, 'data', 'matches');
const DEMOS_DIR = path.join(__dirname, 'demos');
const EXTRACTED_DIR = path.join(DEMOS_DIR, 'extracted');

const isWin = process.platform === 'win32';
const pythonEnv = {
  ...process.env,
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1'
};

function extractDemoIfNeeded(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buffer = Buffer.alloc(4);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 4, 0);
  fs.closeSync(fd);

  if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
    console.log(`  [*] Файл является ZIP-архивом. Распаковываем...`);
    try {
      const zip = new AdmZip(filePath);
      const demEntry = zip.getEntries().find(entry => entry.entryName.endsWith('.dem'));
      if (!demEntry) return null;

      fs.ensureDirSync(EXTRACTED_DIR);
      const extractedPath = path.join(EXTRACTED_DIR, path.basename(demEntry.entryName));
      zip.extractEntryTo(demEntry, EXTRACTED_DIR, false, true);
      console.log(`  [+] Извлечен файл: ${extractedPath}`);
      return extractedPath;
    } catch (err) {
      console.error(`  [!] Ошибка распаковки ZIP:`, err.message);
      return null;
    }
  }
  return filePath;
}

async function main() {
  await fs.ensureDir(MATCHES_DIR);
  await fs.ensureDir(DEMOS_DIR);
  await fs.ensureDir(EXTRACTED_DIR);
  
  if (!await fs.pathExists(MATCHES_FILE)) return;

  const lines = (await fs.readFile(MATCHES_FILE, 'utf-8'))
    .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  if (lines.length === 0) return console.log('Нет ссылок в matches.txt.');
  console.log(`Найдено ${lines.length} строк для обработки.`);

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

    if (await fs.pathExists(outFile)) {
      console.log(`[${i + 1}/${lines.length}] Матч ${matchId} уже собран. Пропускаем.`);
      continue;
    }

    console.log(`\n[${i + 1}/${lines.length}] Обрабатываем ${url} (Турнир: ${tournamentName}) ...`);

    const collectedMaps = [];
    const seenMapSignatures = new Set();
    let awpyJsonPath = path.join(MATCHES_DIR, `${matchId}_awpy.json`);
    
    const pythonExe = isWin ? path.join(__dirname, 'venv', 'Scripts', 'python.exe') : path.join(__dirname, 'venv', 'bin', 'python');
    const scriptPath = path.join(__dirname, 'parse_demo.py');

    try {
      const localDemoBz2 = path.join(DEMOS_DIR, `${matchId}.dem.bz2`);
      const localDemoZip = path.join(DEMOS_DIR, `${matchId}.zip`);
      const localDemoDem = path.join(DEMOS_DIR, `${matchId}.dem`);
      
      let demoToParse = null;

      if (await fs.pathExists(localDemoBz2)) demoToParse = extractDemoIfNeeded(localDemoBz2);
      else if (await fs.pathExists(localDemoZip)) demoToParse = extractDemoIfNeeded(localDemoZip);
      else if (await fs.pathExists(localDemoDem)) demoToParse = localDemoDem;

      if (demoToParse) {
        console.log(`  Запускаем awpy для локальной демки...`);
        try {
          const { stdout, stderr } = await execFileAsync(pythonExe, [scriptPath, demoToParse, awpyJsonPath], { encoding: 'utf8', env: pythonEnv });
          if (stdout) console.log(`    [awpy] ${stdout.trim().replace(/\n/g, '\n    [awpy] ')}`);
          if (stderr) console.error(`    [awpy error] ${stderr.trim()}`);
        } catch (err) {
          console.error(`  [!] Ошибка Python:\n${err.stdout || err.message}\n${err.stderr || ''}`);
        }
      } else {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(5000);

        const btnInfo = await page.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('button, a, div, span'));
          for (const el of elements) {
            const text = (el.textContent || '').toLowerCase().trim();
            if (text.includes('скачать демо') || text.includes('скачать .dem') || text === 'демо' || text === 'скачать') {
              if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.onclick) return { found: true };
            }
          }
          return { found: false };
        });

        if (btnInfo.found) {
          console.log(`  Найдена кнопка "Скачать демо". Пробуем скачать...`);
          try {
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 20000 }).catch(() => null),
              page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button, a')).find(b => (b.textContent || '').toLowerCase().includes('демо') || (b.textContent || '').toLowerCase().includes('.dem'));
                if (btn) btn.click();
              })
            ]);

            if (download) {
              const demoPath = path.join(DEMOS_DIR, `${matchId}.zip`);
              await download.saveAs(demoPath);
              console.log(`  Файл успешно скачан!`);
              const extractedPath = extractDemoIfNeeded(demoPath);
              
              if (extractedPath) {
                console.log(`  Запускаем awpy...`);
                try {
                  const { stdout, stderr } = await execFileAsync(pythonExe, [scriptPath, extractedPath, awpyJsonPath], { encoding: 'utf8', env: pythonEnv });
                  if (stdout) console.log(`    [awpy] ${stdout.trim().replace(/\n/g, '\n    [awpy] ')}`);
                  if (stderr) console.error(`    [awpy error] ${stderr.trim()}`);
                } catch (err) {
                  console.error(`  [!] Ошибка Python:\n${err.stdout || err.message}\n${err.stderr || ''}`);
                }
              }
            }
          } catch (err) {
            console.error(`  Ошибка при скачивании:`, err.message);
          }
        }
      }

      let awpyData = null;
      if (await fs.pathExists(awpyJsonPath)) {
        try { awpyData = await fs.readJson(awpyJsonPath); } catch (e) {}
      }

      if (page.url() !== url) {
         await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
         await page.waitForTimeout(3000);
      }

      const mapNames = await page.evaluate(() => {
        const text = document.body.innerText;
        const matches = text.match(/(de_[a-z0-9_]+|cs_[a-z0-9_]+)/g);
        return matches ? [...new Set(matches)] : [];
      });

      if (mapNames.length === 0 && awpyData) {
        const awpyMaps = [...new Set(awpyData.map(p => p.map_name))].filter(Boolean);
        if (awpyMaps.length > 0) mapNames.push(...awpyMaps);
        else mapNames.push("unknown_map");
      } else if (mapNames.length === 0) {
        mapNames.push("unknown_map");
      }

      for (const mapName of mapNames) {
        if (collectedMaps.some(m => m.map === mapName)) continue;

        const domPlayers = await page.evaluate(() => {
          const result = [];
          const links = document.querySelectorAll('a[href*="/profile/"]');
          for (const link of links) {
            const href = link.getAttribute('href');
            const idMatch = href.match(/\/profile\/(\d+)/);
            if (!idMatch) continue;
            const id = idMatch[1];
            const name = link.textContent.trim();
            if (!name) continue;
            
            let container = link.parentElement;
            let avatar = null;
            for (let i=0; i<5 && container; i++) {
              if (container.querySelector('img')) { avatar = container.querySelector('img').getAttribute('src'); break; }
              container = container.parentElement;
            }
            if (!result.some(p => p.id === id)) result.push({ id, name, avatar });
          }
          return result;
        });

        let players = [];

        if (awpyData && Array.isArray(awpyData)) {
          let mapAwpyData = awpyData.filter(a => a.map_name && a.map_name.toLowerCase() === mapName.toLowerCase());
          if (mapAwpyData.length === 0) mapAwpyData = awpyData;

          mapAwpyData.forEach(ap => {
            const apSteamId = ap.steamid ? String(ap.steamid) : null;
            const cleanApName = ap.name ? String(ap.name).replace(/^.*\|\s*/, '').trim() : '';

            let dp = domPlayers.find(p => apSteamId && String(p.id) === apSteamId);
            if (!dp) dp = domPlayers.find(p => 
              p.name.toLowerCase() === cleanApName.toLowerCase() || 
              p.name.toLowerCase() === String(ap.name).toLowerCase().trim()
            );
            if (!dp) dp = domPlayers.find(p => 
              (cleanApName && cleanApName.toLowerCase().includes(p.name.toLowerCase())) || 
              p.name.toLowerCase().includes(cleanApName.toLowerCase())
            );

            let finalId = apSteamId;
            if (!finalId || finalId === '0' || finalId === 'None') {
              finalId = dp ? String(dp.id) : String(ap.name || 'Unknown');
            }

            players.push({
              id: finalId,
              name: dp ? dp.name : (ap.name || 'Unknown'),
              avatar: dp ? dp.avatar : null,
              kills: ap.kills || 0,
              deaths: ap.deaths || 0,
              assists: ap.assists || 0,
              adr: ap.adr, 
              kast: ap.kast, 
              rating: ap.rating
            });
          });
          if (players.length > 0) console.log(`  [${mapName}] Данные склеены: ${players.length} игроков.`);
        } else {
          players = domPlayers.map(dp => ({ ...dp, kills: 0, deaths: 0, assists: 0, adr: null, kast: null, rating: null }));
        }

        if (players.length > 0) {
          const signature = players.map(p => `${p.id}_${p.kills}_${p.deaths}`).sort().join('|');
          if (!seenMapSignatures.has(signature)) {
            seenMapSignatures.add(signature);
            collectedMaps.push({ map: mapName, players });
          }
        }
      }

      if (collectedMaps.length > 0) {
        await fs.writeJson(outFile, { matchId, url, tournament: tournamentName, date: new Date().toISOString(), maps: collectedMaps }, { spaces: 2 });
        console.log(`  [+] Файл сохранён: ${matchId}.json`);
      } else {
        console.log(`  [-] Не удалось собрать ни одной карты.`);
      }

    } catch (err) {
      console.error(`  [!] Ошибка:`, err.message);
    }
  }

  await browser.close();
  console.log('\nСбор завершён!');
}

function extractMatchId(url) {
  const m = url.match(/\/match\/(\d+)/);
  return m ? m[1] : null;
}

main().catch(err => {
  console.error('Критическая ошибка:', err);
  process.exit(1);
});