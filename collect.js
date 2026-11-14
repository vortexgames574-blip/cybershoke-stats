// collect.js — Скачивание демки (ZIP/BZ2) + Парсинг awpy + Склейка с DOM
import { chromium } from 'playwright';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import AdmZip from 'adm-zip';

const execAsync = promisify(exec);
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

// Ультимативная функция поиска даты (ищет в сыром HTML)
async function extractMatchDate(page) {
  try {
    // Ждем, пока страница полностью прогрузится (включая скрипты)
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);

    const content = await page.content();

    // 1. Ищем ISO формат (обычно в скрытых JSON данных)
    // Пример: "date":"2026-11-14T18:51:00"
    const isoMatch = content.match(/"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/);
    if (isoMatch && isoMatch[1]) {
      const d = new Date(isoMatch[1]);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    // 2. Ищем формат "ГГГГ-ММ-ДД ЧЧ:ММ" или "ДД.ММ.ГГГГ ЧЧ:ММ" в тексте
    // Пример: "2026-11-14 18:51" или "14.11.2026, 18:51"
    const textMatch = content.match(/(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/) || 
                      content.match(/(\d{2}\.\d{2}\.\d{4})[\s,]+(\d{2}:\d{2})/);
                      
    if (textMatch) {
      let datePart = textMatch[1];
      const timePart = textMatch[2];
      
      // Если дата в формате ДД.ММ.ГГГГ, конвертируем в ГГГГ-ММ-ДД для JS
      if (datePart.includes('.')) {
        const [d, m, y] = datePart.split('.');
        datePart = `${y}-${m}-${d}`;
      }
      
      const d = new Date(`${datePart}T${timePart}:00`);
      if (!isNaN(d.getTime())) return d.toISOString();
    }

    // 3. Ищем просто дату без времени (ставим полдень)
    const dateOnlyMatch = content.match(/"(\d{4}-\d{2}-\d{2})/);
    if (dateOnlyMatch && dateOnlyMatch[1]) {
       const d = new Date(`${dateOnlyMatch[1]}T12:00:00`);
       if (!isNaN(d.getTime())) return d.toISOString();
    }

  } catch (e) {
    console.error('  [!] Ошибка извлечения даты:', e.message);
  }
  
  // Если вообще ничего не нашли
  console.warn('  [!] Не удалось найти дату матча в HTML. Используется текущее время.');
  return new Date().toISOString();
}

// Извлекает ВСЕ .dem файлы из архива
function extractDemoIfNeeded(filePath) {
  if (!fs.existsSync(filePath)) return [];

  const buffer = Buffer.alloc(4);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buffer, 0, 4, 0);
  fs.closeSync(fd);

  // Проверка на ZIP (PK\x03\x04)
  if (buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
    console.log(`  [*] Файл является ZIP-архивом. Распаковываем...`);
    try {
      const zip = new AdmZip(filePath);
      const demEntries = zip.getEntries().filter(entry => entry.entryName.endsWith('.dem'));
      if (demEntries.length === 0) return [];

      fs.ensureDirSync(EXTRACTED_DIR);
      const extractedPaths = [];
      
      for (const demEntry of demEntries) {
        const extractedPath = path.join(EXTRACTED_DIR, path.basename(demEntry.entryName));
        zip.extractEntryTo(demEntry, EXTRACTED_DIR, false, true);
        console.log(`  [+] Извлечен файл: ${extractedPath}`);
        extractedPaths.push(extractedPath);
      }
      
      return extractedPaths;
    } catch (err) {
      console.error(`  [!] Ошибка распаковки ZIP:`, err.message);
      return [];
    }
  }
  return [filePath];
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

    // Пропускаем, если уже есть JSON
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

    if (!fs.existsSync(pythonExe)) {
      console.error(`\n  [!] КРИТИЧЕСКАЯ ОШИБКА: Python не найден по пути: ${pythonExe}`);
      continue;
    }

    try {
      const localDemoBz2 = path.join(DEMOS_DIR, `${matchId}.dem.bz2`);
      const localDemoZip = path.join(DEMOS_DIR, `${matchId}.zip`);
      const localDemoDem = path.join(DEMOS_DIR, `${matchId}.dem`);
      
      let demosToParse = [];

      if (await fs.pathExists(localDemoBz2)) demosToParse = extractDemoIfNeeded(localDemoBz2);
      else if (await fs.pathExists(localDemoZip)) demosToParse = extractDemoIfNeeded(localDemoZip);
      else if (await fs.pathExists(localDemoDem)) demosToParse = [localDemoDem];

      // Если нашли демки локально
      if (demosToParse.length > 0) {
        console.log(`  Найдено демок для парсинга: ${demosToParse.length}`);
        let combinedAwpyData = [];

        for (const demoPath of demosToParse) {
          console.log(`  Запускаем awpy для: ${path.basename(demoPath)}...`);
          const tempAwpyPath = path.join(MATCHES_DIR, `${matchId}_awpy_${path.basename(demoPath, '.dem')}.json`);
          
          try {
            const cmd = `"${pythonExe}" "${scriptPath}" "${demoPath}" "${tempAwpyPath}"`;
            const { stdout, stderr } = await execAsync(cmd, { encoding: 'utf8', env: pythonEnv, maxBuffer: 1024 * 1024 * 10 });
            
            if (stdout) console.log(`    [awpy] ${stdout.trim().replace(/\n/g, '\n    [awpy] ')}`);
            if (stderr) console.error(`    [awpy error] ${stderr.trim()}`);
            
            if (await fs.pathExists(tempAwpyPath)) {
              try {
                const data = await fs.readJson(tempAwpyPath);
                if (Array.isArray(data)) combinedAwpyData.push(...data);
                await fs.remove(tempAwpyPath);
              } catch (e) {
                console.error(`  [!] Ошибка чтения JSON от awpy:`, e.message);
              }
            }
          } catch (err) {
            console.error(`  [!] Ошибка Python:\n${err.stdout || err.message}\n${err.stderr || ''}`);
          }
        }

        if (combinedAwpyData.length > 0) {
          await fs.writeJson(awpyJsonPath, combinedAwpyData, { spaces: 2 });
        }

      } else {
        // Скачиваем с сайта
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
              
              const demosToParseDownload = extractDemoIfNeeded(demoPath);
              let combinedAwpyDataDownload = [];
              
              for (const demoPath of demosToParseDownload) {
                console.log(`  Запускаем awpy для: ${path.basename(demoPath)}...`);
                const tempAwpyPath = path.join(MATCHES_DIR, `${matchId}_awpy_${path.basename(demoPath, '.dem')}.json`);
                
                try {
                  const cmd = `"${pythonExe}" "${scriptPath}" "${demoPath}" "${tempAwpyPath}"`;
                  const { stdout, stderr } = await execAsync(cmd, { encoding: 'utf8', env: pythonEnv, maxBuffer: 1024 * 1024 * 10 });
                  
                  if (stdout) console.log(`    [awpy] ${stdout.trim().replace(/\n/g, '\n    [awpy] ')}`);
                  if (stderr) console.error(`    [awpy error] ${stderr.trim()}`);
                  
                  if (await fs.pathExists(tempAwpyPath)) {
                    try {
                      const data = await fs.readJson(tempAwpyPath);
                      if (Array.isArray(data)) combinedAwpyDataDownload.push(...data);
                      await fs.remove(tempAwpyPath);
                    } catch (e) {}
                  }
                } catch (err) {}
              }
              
              if (combinedAwpyDataDownload.length > 0) {
                await fs.writeJson(awpyJsonPath, combinedAwpyDataDownload, { spaces: 2 });
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

      // Извлекаем реальное время матча
      const matchDate = await extractMatchDate(page);
      console.log(`  [*] Время матча: ${new Date(matchDate).toLocaleString('ru-RU')}`);

      // === ИСПРАВЛЕНИЕ ДУБЛИКАТОВ КАРТ ===
      let mapNames = [];
      if (awpyData && Array.isArray(awpyData) && awpyData.length > 0) {
        mapNames = [...new Set(awpyData.map(p => p.map_name).filter(Boolean))];
      } else {
        mapNames = await page.evaluate(() => {
          const text = document.body.innerText;
          const matches = text.match(/(de_[a-z0-9_]+|cs_[a-z0-9_]+)/g);
          return matches ? [...new Set(matches)] : [];
        });
      }

      if (mapNames.length === 0) {
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
          
          if (mapAwpyData.length === 0) {
            console.log(`  [-] Карта ${mapName} не найдена в демках. Пропускаем.`);
            continue;
          }

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
        await fs.writeJson(outFile, { matchId, url, tournament: tournamentName, date: matchDate, maps: collectedMaps }, { spaces: 2 });
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