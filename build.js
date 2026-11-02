// build.js — СБОРКА ДАННЫХ + РЕАЛЬНЫЕ АВАТАРКИ STEAM
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch'; // нужно установить: npm install node-fetch

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MATCHES_DIR = path.join(__dirname, 'data', 'matches');
const OUTPUT_FILE = path.join(__dirname, 'docs', 'data', 'stats.json');

// 🔑 ВСТАВЬ СВОЙ КЛЮЧ STEAM API СЮДА
const STEAM_API_KEY = 'ТВОЙ_КЛЮЧ_ЗДЕСЬ';

function num(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

async function fetchSteamAvatars(steamIds) {
  const avatars = new Map();
  if (!STEAM_API_KEY || STEAM_API_KEY === 'ТВОЙ_КЛЮЧ_ЗДЕСЬ') {
    console.log('⚠️ Steam API ключ не указан. Аватарки будут заглушками.');
    return avatars;
  }

  // Steam API принимает до 100 ID за раз
  const chunks = [];
  for (let i = 0; i < steamIds.length; i += 100) {
    chunks.push(steamIds.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const ids = chunk.join(',');
    const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${ids}`;
    
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      if (data.response && data.response.players) {
        for (const player of data.response.players) {
          avatars.set(player.steamid, player.avatarmedium); // или avatarfull
        }
      }
    } catch (err) {
      console.error('Ошибка запроса к Steam API:', err.message);
    }
  }

  return avatars;
}

function calculateStats(matches, steamAvatars) {
  const playerMap = new Map();
  const mapStatsRaw = {}; 
  const recentMatches = [];
  let totalKillsAll = 0;
  let totalDeathsAll = 0;
  let totalMapsPlayed = 0;

  const records = {
    maxKills: { value: 0, player: '', map: '', date: '' },
    maxDeaths: { value: 0, player: '', map: '', date: '' },
    maxAdr: { value: 0, player: '', map: '', date: '' },
    minAdr: { value: 999, player: '', map: '', date: '' }
  };

  matches.sort((a, b) => new Date(b.date) - new Date(a.date));

  for (const match of matches) {
    const maps = match.maps || [];
    recentMatches.push({ matchId: match.matchId, url: match.url, date: match.date, maps: maps.map(m => m.map) });
    totalMapsPlayed += maps.length;

    for (const mapData of maps) {
      const mapName = mapData.map || 'unknown';
      
      if (!mapStatsRaw[mapName]) {
          mapStatsRaw[mapName] = { matches: 0, totalKills: 0, totalDeaths: 0, ratingSum: 0, ratingCount: 0, playersMap: new Map() };
      }
      mapStatsRaw[mapName].matches += 1;

      for (const p of mapData.players) {
        const pid = p.id; 
        
        if (!playerMap.has(pid)) {
          playerMap.set(pid, {
            id: pid, name: p.name, lastPlayed: match.date,
            matches: 0, kills: 0, deaths: 0, assists: 0,
            adrSum: 0, adrCount: 0, kastSum: 0, kastCount: 0, ratingSum: 0, ratingCount: 0,
            history: [], matchHistory: [] 
          });
        }

        const st = playerMap.get(pid);
        if (new Date(match.date) >= new Date(st.lastPlayed)) { st.name = p.name; st.lastPlayed = match.date; }

        st.matches += 1;
        const k = Math.round(Number(p.kills)) || 0;
        const d = Math.round(Number(p.deaths)) || 0;
        const a = Math.round(Number(p.assists)) || 0;
        
        st.kills += k; st.deaths += d; st.assists += a;
        mapStatsRaw[mapName].totalKills += k; mapStatsRaw[mapName].totalDeaths += d;
        totalKillsAll += k; totalDeathsAll += d;

        const adrVal = num(p.adr); const kastVal = num(p.kast); const ratingVal = num(p.rating);

        if (k > records.maxKills.value) records.maxKills = { value: k, player: p.name, map: mapName, date: match.date };
        if (d > records.maxDeaths.value) records.maxDeaths = { value: d, player: p.name, map: mapName, date: match.date };
        if (adrVal !== null) {
            if (adrVal > records.maxAdr.value) records.maxAdr = { value: adrVal, player: p.name, map: mapName, date: match.date };
            if (adrVal < records.minAdr.value && adrVal > 5) records.minAdr = { value: adrVal, player: p.name, map: mapName, date: match.date };
        }

        if (ratingVal !== null) { mapStatsRaw[mapName].ratingSum += ratingVal; mapStatsRaw[mapName].ratingCount += 1; }

        if (!mapStatsRaw[mapName].playersMap.has(pid)) {
            mapStatsRaw[mapName].playersMap.set(pid, { name: p.name, avatar: '', matches: 0, kills: 0, deaths: 0, ratingSum: 0 });
        }
        let mp = mapStatsRaw[mapName].playersMap.get(pid);
        mp.matches += 1; mp.kills += k; mp.deaths += d;
        if (ratingVal) mp.ratingSum += ratingVal;

        if (adrVal !== null) { st.adrSum += adrVal; st.adrCount += 1; }
        if (kastVal !== null) { st.kastSum += kastVal; st.kastCount += 1; }
        if (ratingVal !== null) { st.ratingSum += ratingVal; st.ratingCount += 1; st.history.push({ date: match.date, rating: ratingVal }); }

        st.matchHistory.push({ date: match.date, map: mapData.map, kills: k, deaths: d, assists: a, adr: adrVal, kast: kastVal, rating: ratingVal });
      }
    }
  }

  // Используем реальные аватарки из Steam API, если они есть
  const getAvatar = (id, name) => {
      const steamAvatar = steamAvatars.get(String(id));
      if (steamAvatar) return steamAvatar;
      
      // Заглушка, если аватарка не найдена
      return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || '?')}&background=4d6bfe&color=fff&size=128&bold=true&rounded=true`;
  };

  const players = Array.from(playerMap.values()).map(p => {
    const kd = p.deaths > 0 ? +(p.kills / p.deaths).toFixed(2) : p.kills;
    return { ...p, avatar: getAvatar(p.id, p.name), kd: kd, avgRating: p.ratingCount > 0 ? +(p.ratingSum / p.ratingCount).toFixed(2) : null, avgAdr: p.adrCount > 0 ? +(p.adrSum / p.adrCount).toFixed(1) : null, avgKast: p.kastCount > 0 ? +(p.kastSum / p.kastCount).toFixed(1) : null };
  });

  const nameCounts = {};
  players.forEach(p => { nameCounts[p.name] = (nameCounts[p.name] || 0) + 1; });
  players.forEach(p => {
    if (nameCounts[p.name] > 1) {
      const shortId = p.id.startsWith('name_') ? p.id.replace('name_', '') : p.id.slice(-4);
      p.displayName = `${p.name} (${shortId})`;
    } else { p.displayName = p.name; }
  });

  players.forEach(p => {
      const matchesPlayed = p.matches;
      const avgRating = p.avgRating || 0;

      if (matchesPlayed < 3) {
          if (matchesPlayed === 0) p.form = 'new';
          else if (avgRating >= 1.2) p.form = 'hot';
          else if (avgRating <= 0.8) p.form = 'cold';
          else p.form = 'stable';
          return;
      }

      const hist = [...p.matchHistory].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 3);
      const recentAvg = hist.reduce((sum, h) => sum + (h.rating || 0), 0) / hist.length;
      
      if (recentAvg > (avgRating * 1.1)) p.form = 'hot';
      else if (recentAvg < (avgRating * 0.9)) p.form = 'cold';
      else p.form = 'stable';
  });

  players.sort((a, b) => (b.avgRating ?? b.kd) - (a.avgRating ?? a.kd));

  const formattedMapStats = Object.entries(mapStatsRaw).map(([map, data]) => {
      const topPlayers = Array.from(data.playersMap.values())
        .map(pl => ({ ...pl, kd: pl.deaths > 0 ? +(pl.kills / pl.deaths).toFixed(2) : pl.kills, avgRating: pl.matches > 0 ? +(pl.ratingSum / pl.matches).toFixed(2) : 0 }))
        .sort((a,b) => b.avgRating - a.avgRating);
      const updatedTop = topPlayers.map(tp => {
          const found = players.find(p => p.name === tp.name);
          return { ...tp, avatar: found ? found.avatar : '' };
      });
      return { map, matches: data.matches, avgKd: data.totalDeaths > 0 ? +(data.totalKills / data.totalDeaths).toFixed(2) : data.totalKills, avgRating: data.ratingCount > 0 ? +(data.ratingSum / data.ratingCount).toFixed(2) : 0, topPlayers: updatedTop };
  }).sort((a,b) => b.matches - a.matches);

  return { players, mapStats: formattedMapStats, recentMatches: recentMatches.slice(0, 10), records, funStats: { totalHours: Math.round(totalMapsPlayed * 40 / 60), totalKills: totalKillsAll, totalDeaths: totalDeathsAll } };
}

async function main() {
  await fs.ensureDir(path.dirname(OUTPUT_FILE));
  const files = (await fs.readdir(MATCHES_DIR)).filter(f => f.endsWith('.json'));
  if (files.length === 0) return console.log('Нет матчей.');

  const allMatches = [];
  const tournamentsMap = new Map();
  const allSteamIds = new Set();

  for (const file of files) {
    const match = await fs.readJson(path.join(MATCHES_DIR, file));
    allMatches.push(match);
    
    const tName = match.tournament || 'Без турнира';
    if (!tournamentsMap.has(tName)) tournamentsMap.set(tName, []);
    tournamentsMap.get(tName).push(match);

    // Собираем все Steam ID для запроса аватарок
    for (const map of match.maps || []) {
        for (const p of map.players || []) {
            if (p.id && !p.id.startsWith('name_')) {
                allSteamIds.add(p.id);
            }
        }
    }
  }

  // Получаем аватарки из Steam API
  console.log(`Запрос аватарок для ${allSteamIds.size} игроков...`);
  const steamAvatars = await fetchSteamAvatars([...allSteamIds]);

  const output = {
    generatedAt: new Date().toISOString(),
    totalMatchesCount: allMatches.length,
    tournaments: {
      "Все матчи": calculateStats(allMatches, steamAvatars)
    }
  };

  for (const [tName, tMatches] of tournamentsMap.entries()) {
      output.tournaments[tName] = calculateStats(tMatches, steamAvatars);
  }

  await fs.writeJson(OUTPUT_FILE, output, { spaces: 2 });
  console.log(`Статистика обновлена! Турниров: ${Object.keys(output.tournaments).length}`);
}

main().catch(err => { console.error(err); process.exit(1); });