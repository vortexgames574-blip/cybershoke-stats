// build.js — СБОРКА ДАННЫХ С АГРЕГАЦИЕЙ ПО КАРТАМ И НИКАМИ
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MATCHES_DIR = path.join(__dirname, 'data', 'matches');
const OUTPUT_FILE = path.join(__dirname, 'docs', 'data', 'stats.json');

function num(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

async function main() {
  await fs.ensureDir(path.dirname(OUTPUT_FILE));
  const files = (await fs.readdir(MATCHES_DIR)).filter(f => f.endsWith('.json'));
  if (files.length === 0) return console.log('Нет матчей.');

  const matches = [];
  for (const file of files) {
    matches.push(await fs.readJson(path.join(MATCHES_DIR, file)));
  }
  matches.sort((a, b) => new Date(b.date) - new Date(a.date));

  const playerMap = new Map();
  const mapStats = {}; 
  const recentMatches = [];
  
  let totalKillsAll = 0;
  let totalDeathsAll = 0;
  let totalMapsPlayed = 0;

  for (const match of matches) {
    const maps = match.maps || [];
    recentMatches.push({ matchId: match.matchId, url: match.url, date: match.date, maps: maps.map(m => m.map) });
    totalMapsPlayed += maps.length;

    for (const mapData of maps) {
      const mapName = mapData.map || 'unknown';
      if (!mapStats[mapName]) {
          mapStats[mapName] = { matches: 0, totalKills: 0, totalDeaths: 0, ratingSum: 0, ratingCount: 0 };
      }
      mapStats[mapName].matches += 1;

      for (const p of mapData.players) {
        const pid = p.id; 
        
        if (!playerMap.has(pid)) {
          playerMap.set(pid, {
            id: pid, name: p.name, lastPlayed: match.date,
            matches: 0, kills: 0, deaths: 0, assists: 0,
            adrSum: 0, adrCount: 0, 
            kastSum: 0, kastCount: 0, 
            ratingSum: 0, ratingCount: 0,
            history: [],
            matchHistory: [] 
          });
        }

        const st = playerMap.get(pid);
        if (new Date(match.date) >= new Date(st.lastPlayed)) {
          st.name = p.name;
          st.lastPlayed = match.date;
        }

        st.matches += 1;
        const k = Math.round(Number(p.kills)) || 0;
        const d = Math.round(Number(p.deaths)) || 0;
        const a = Math.round(Number(p.assists)) || 0;
        
        st.kills += k;
        st.deaths += d;
        st.assists += a;
        
        mapStats[mapName].totalKills += k;
        mapStats[mapName].totalDeaths += d;
        
        totalKillsAll += k;
        totalDeathsAll += d;

        const adrVal = num(p.adr);
        const kastVal = num(p.kast);
        const ratingVal = num(p.rating);

        if (ratingVal !== null) {
            mapStats[mapName].ratingSum += ratingVal;
            mapStats[mapName].ratingCount += 1;
        }

        if (adrVal !== null) { st.adrSum += adrVal; st.adrCount += 1; }
        if (kastVal !== null) { st.kastSum += kastVal; st.kastCount += 1; }
        if (ratingVal !== null) { 
            st.ratingSum += ratingVal; 
            st.ratingCount += 1; 
            st.history.push({ date: match.date, rating: ratingVal });
        }

        st.matchHistory.push({
          date: match.date,
          map: mapData.map,
          kills: k,
          deaths: d,
          assists: a,
          adr: adrVal,
          kast: kastVal,
          rating: ratingVal
        });
      }
    }
  }

  const getAvatar = (id) => {
      const strId = String(id);
      if (strId && strId.length > 15 && !strId.startsWith('name_')) {
          return `https://avatars.steamstatic.com/${strId}_medium.jpg`;
      }
      return `https://avatars.steamstatic.com/fef49e7fa7e1997310d705b2a6158ff8dc1cdfeb_medium.jpg`;
  };

  const players = Array.from(playerMap.values()).map(p => {
    const kd = p.deaths > 0 ? +(p.kills / p.deaths).toFixed(2) : p.kills;
    return {
      ...p, 
      avatar: getAvatar(p.id),
      kd: kd,
      avgRating: p.ratingCount > 0 ? +(p.ratingSum / p.ratingCount).toFixed(2) : null,
      avgAdr: p.adrCount > 0 ? +(p.adrSum / p.adrCount).toFixed(1) : null,
      avgKast: p.kastCount > 0 ? +(p.kastSum / p.kastCount).toFixed(1) : null,
    };
  });

  // ВОЗВРАЩАЕМ ГЕНЕРАЦИЮ НИКОВ
  const nameCounts = {};
  players.forEach(p => { nameCounts[p.name] = (nameCounts[p.name] || 0) + 1; });
  
  players.forEach(p => {
    if (nameCounts[p.name] > 1) {
      const shortId = p.id.startsWith('name_') ? p.id.replace('name_', '') : p.id.slice(-4);
      p.displayName = `${p.name} (${shortId})`;
    } else {
      p.displayName = p.name;
    }
  });

  const mostDeaths = [...players].sort((a, b) => b.deaths - a.deaths)[0];
  const leastKills = [...players].sort((a, b) => a.kills - b.kills)[0];
  const mostMatches = [...players].sort((a, b) => b.matches - a.matches)[0];

  players.forEach(p => {
    if (p === mostDeaths && p.deaths > 50) p.title = "Магнит для пуль 🎯";
    else if (p === leastKills) p.title = "Пацифист 🕊️";
    else if (p === mostMatches) p.title = "Ветеран 🎖️";
    else if (p.kd > 1.2) p.title = "Киберспортсмен 🏆";
    else if (p.kd < 0.5) p.title = "Штурмовик Империи 🪖";
    else p.title = "Боец 🥊";
  });

  players.sort((a, b) => (b.avgRating ?? b.kd) - (a.avgRating ?? a.kd));

  const funStats = {
    totalHours: Math.round(totalMapsPlayed * 40 / 60),
    totalKills: totalKillsAll,
    totalDeaths: totalDeathsAll
  };

  const formattedMapStats = Object.entries(mapStats).map(([map, data]) => ({
      map: map,
      matches: data.matches,
      avgKd: data.totalDeaths > 0 ? +(data.totalKills / data.totalDeaths).toFixed(2) : data.totalKills,
      avgRating: data.ratingCount > 0 ? +(data.ratingSum / data.ratingCount).toFixed(2) : 0
  })).sort((a,b) => b.matches - a.matches);

  const output = {
    generatedAt: new Date().toISOString(),
    matchesCount: matches.length,
    players,
    mapStats: formattedMapStats,
    recentMatches: recentMatches.slice(0, 10),
    funStats
  };

  await fs.writeJson(OUTPUT_FILE, output, { spaces: 2 });
  console.log(`Статистика обновлена! Игроков: ${players.length}, Карт: ${formattedMapStats.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });