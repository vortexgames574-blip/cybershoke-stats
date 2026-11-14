// build.js — АГРЕГАЦИЯ ДАННЫХ + ВАЛИДАЦИЯ + КЭШ АВАТАРОК
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MATCHES_DIR = path.join(__dirname, 'data', 'matches');
const CACHE_FILE = path.join(__dirname, 'data', 'avatars-cache.json');
const LOGS_DIR = path.join(__dirname, 'logs');
const OUTPUT_FILE = path.join(__dirname, 'docs', 'data', 'stats.json');

const STEAM_API_KEY = process.env.STEAM_API_KEY || '';
const CACHE_TTL_DAYS = 30;

const logLines = [];
function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
  console.log(line);
  logLines.push(line);
}
async function flushLog() {
  await fs.ensureDir(LOGS_DIR);
  const fname = `build-${new Date().toISOString().slice(0, 10)}.log`;
  await fs.appendFile(path.join(LOGS_DIR, fname), logLines.join('\n') + '\n');
}

function num(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function validateMap(mapData) {
  if (!mapData || !Array.isArray(mapData.players)) return { ok: false };
  if (mapData.players.length !== 10) return { ok: false };
  if (mapData._warning) return { ok: false };

  const totalK = mapData.players.reduce((s, p) => s + (Number(p.kills) || 0), 0);
  const totalD = mapData.players.reduce((s, p) => s + (Number(p.deaths) || 0), 0);
  if (totalK > 500 || totalD > 500) return { ok: false };

  for (const p of mapData.players) {
    const k = Number(p.kills) || 0;
    const d = Number(p.deaths) || 0;
    const a = Number(p.assists) || 0;
    const adr = num(p.adr);
    const kast = num(p.kast);
    const rating = num(p.rating);

    if (k > 60 || d > 60 || a > 40) return { ok: false };
    if (adr !== null && (adr < 5 || adr > 300)) return { ok: false };
    if (kast !== null && (kast < 5 || kast > 100)) return { ok: false };
    if (rating !== null && (rating < 0.02 || rating > 4.0)) return { ok: false };
  }
  return { ok: true };
}

async function loadAvatarCache() {
  if (await fs.pathExists(CACHE_FILE)) {
    try { return await fs.readJson(CACHE_FILE); } catch (e) {}
  }
  return {};
}
async function saveAvatarCache(cache) {
  await fs.ensureDir(path.dirname(CACHE_FILE));
  await fs.writeJson(CACHE_FILE, cache, { spaces: 2 });
}
function isCacheFresh(entry) {
  if (!entry || !entry.updatedAt) return false;
  return ((Date.now() - entry.updatedAt) / (1000 * 60 * 60 * 24)) < CACHE_TTL_DAYS;
}

async function fetchSteamAvatars(steamIds) {
  const cache = await loadAvatarCache();
  const result = new Map();
  const toFetch = [];

  for (const id of steamIds) {
    const entry = cache[id];
    if (isCacheFresh(entry)) result.set(id, entry.avatar);
    else toFetch.push(id);
  }

  log('info', `Аватарок из кэша: ${result.size}, нужно обновить: ${toFetch.length}`);
  if (toFetch.length === 0) return result;

  if (STEAM_API_KEY) {
    const chunks = [];
    for (let i = 0; i < toFetch.length; i += 100) chunks.push(toFetch.slice(i, i + 100));
    for (const chunk of chunks) {
      try {
        const res = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${STEAM_API_KEY}&steamids=${chunk.join(',')}`);
        if (res.ok) {
          const data = await res.json();
          if (data.response?.players) {
            for (const p of data.response.players) {
              result.set(p.steamid, p.avatarmedium);
              cache[p.steamid] = { avatar: p.avatarmedium, updatedAt: Date.now() };
            }
          }
        }
      } catch (err) { log('error', `Steam API: ${err.message}`); }
    }
    await saveAvatarCache(cache);
    return result;
  }

  log('info', 'STEAM_API_KEY не задан, парсим публичные профили...');
  for (const id of toFetch) {
    try {
      const res = await fetch(`https://steamcommunity.com/profiles/${id}/?xml=1`);
      if (res.ok) {
        const text = await res.text();
        const m = text.match(/<avatarMedium><!\[CDATA\[(.*?)\]\]><\/avatarMedium>/i);
        if (m && m[1]) {
          result.set(id, m[1]);
          cache[id] = { avatar: m[1], updatedAt: Date.now() };
        }
      }
    } catch (err) {}
    await new Promise(r => setTimeout(r, 250));
  }
  await saveAvatarCache(cache);
  return result;
}

function getRank(elo) {
  if (elo < 1000) return { name: 'Silver', color: '#8b96a5', icon: 'shield' };
  if (elo < 1100) return { name: 'Green', color: '#10b981', icon: 'shield-check' };
  if (elo < 1200) return { name: 'Blue', color: '#4d6bfe', icon: 'shield-plus' };
  if (elo < 1300) return { name: 'Purple', color: '#a855f7', icon: 'gem' };
  return { name: 'GEIMERI', color: '#ef4444', icon: 'crown' };
}

function calculateStats(matches, steamAvatars) {
  const playerMap = new Map();
  const mapStatsRaw = {};
  const recentMatches = [];
  let totalKillsAll = 0, totalDeathsAll = 0, totalMapsPlayed = 0;

  const records = {
    maxKills: { value: 0, player: '', playerId: '', map: '', date: '', matchId: '' },
    maxDeaths: { value: 0, player: '', playerId: '', map: '', date: '', matchId: '' },
    maxAdr: { value: 0, player: '', playerId: '', map: '', date: '', matchId: '' }
  };

  const sortedMatches = [...matches].sort((a, b) => new Date(a.date) - new Date(b.date));
  let skippedMaps = 0;

  for (const match of sortedMatches) {
    const maps = match.maps || [];
    recentMatches.push({ matchId: match.matchId, url: match.url, date: match.date, maps: maps.map(m => m.map) });
    totalMapsPlayed += maps.length;

    for (const mapData of maps) {
      const check = validateMap(mapData);
      if (!check.ok) {
        skippedMaps++;
        log('warn', `Пропущена карта ${mapData.map} в матче ${match.matchId}`);
        continue;
      }

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
            history: [], matchHistory: [], elo: 1000
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
        st.kills += k; st.deaths += d; st.assists += a;
        mapStatsRaw[mapName].totalKills += k;
        mapStatsRaw[mapName].totalDeaths += d;
        totalKillsAll += k; totalDeathsAll += d;

        const adrVal = num(p.adr), kastVal = num(p.kast), ratingVal = num(p.rating);

        let perf = ratingVal;
        if (perf === null) {
          const kd = d > 0 ? k / d : (k > 0 ? 2.0 : 1.0);
          let proxyRating = 0.5 + kd * 0.5;
          if (k > 15) proxyRating += (k - 15) * 0.02;
          perf = Math.min(3.0, proxyRating);
        }
        if (perf !== null) perf = +(Number(perf).toFixed(2));

        let eloChange = 0;
        if (perf !== null) {
          const K = Math.max(5, 32 - (st.matches * 1.5));
          eloChange = Math.round(K * (perf - 1.0) * 1.5);
          eloChange = Math.max(-35, Math.min(35, eloChange));
          st.elo += eloChange;
        }

        if (k <= 50 && k > records.maxKills.value) records.maxKills = { value: k, player: p.name, playerId: pid, map: mapName, date: match.date, matchId: match.matchId };
        if (d <= 50 && d > records.maxDeaths.value) records.maxDeaths = { value: d, player: p.name, playerId: pid, map: mapName, date: match.date, matchId: match.matchId };
        if (adrVal !== null && adrVal <= 250 && adrVal > records.maxAdr.value) records.maxAdr = { value: adrVal, player: p.name, playerId: pid, map: mapName, date: match.date, matchId: match.matchId };

        if (perf !== null) {
          mapStatsRaw[mapName].ratingSum += perf;
          mapStatsRaw[mapName].ratingCount += 1;
        }
        if (!mapStatsRaw[mapName].playersMap.has(pid)) {
          mapStatsRaw[mapName].playersMap.set(pid, { id: pid, name: p.name, avatar: '', matches: 0, kills: 0, deaths: 0, ratingSum: 0 });
        }
        const mp = mapStatsRaw[mapName].playersMap.get(pid);
        mp.matches += 1; mp.kills += k; mp.deaths += d;
        if (perf) mp.ratingSum += perf;

        if (adrVal !== null) { st.adrSum += adrVal; st.adrCount += 1; }
        if (kastVal !== null) { st.kastSum += kastVal; st.kastCount += 1; }
        if (perf !== null) {
          st.ratingSum += perf;
          st.ratingCount += 1;
          st.history.push({ date: match.date, rating: perf });
        }

        st.matchHistory.push({
          date: match.date, matchId: match.matchId, map: mapData.map,
          kills: k, deaths: d, assists: a,
          adr: adrVal, kast: kastVal, rating: perf, eloChange
        });
      }
    }
  }

  if (skippedMaps > 0) log('warn', `Всего пропущено карт: ${skippedMaps}`);

  const getAvatar = (id, name) => steamAvatars.get(String(id)) || `https://ui-avatars.com/api/?name=${encodeURIComponent(name || '?')}&background=4d6bfe&color=fff&size=128&bold=true&rounded=true`;

  const players = Array.from(playerMap.values()).map(p => {
    const kd = p.deaths > 0 ? +(p.kills / p.deaths).toFixed(2) : p.kills;
    const rank = getRank(p.elo);
    return {
      ...p,
      avatar: getAvatar(p.id, p.name),
      kd,
      avgRating: p.ratingCount > 0 ? +(p.ratingSum / p.ratingCount).toFixed(2) : null,
      avgAdr: p.adrCount > 0 ? +(p.adrSum / p.adrCount).toFixed(1) : null,
      avgKast: p.kastCount > 0 ? +(p.kastSum / p.kastCount).toFixed(1) : null,
      rankName: rank.name,
      rankColor: rank.color,
      rankIcon: rank.icon
    };
  });

  const nameCounts = {};
  players.forEach(p => { nameCounts[p.name] = (nameCounts[p.name] || 0) + 1; });
  players.forEach(p => {
    if (nameCounts[p.name] > 1) {
      const shortId = p.id.startsWith('name_') ? p.id.replace('name_', '') : p.id.slice(-4);
      p.displayName = `${p.name} (${shortId})`;
    } else p.displayName = p.name;
  });

  const displayNameById = new Map(players.map(p => [p.id, p.displayName]));
  for (const key of ['maxKills', 'maxDeaths', 'maxAdr']) {
    const rec = records[key];
    if (rec && rec.playerId && displayNameById.has(rec.playerId)) rec.player = displayNameById.get(rec.playerId);
  }

  players.sort((a, b) => b.elo - a.elo);

  const formattedMapStats = Object.entries(mapStatsRaw).map(([map, data]) => {
    const topPlayers = Array.from(data.playersMap.values()).map(pl => ({
        ...pl,
        kd: pl.deaths > 0 ? +(pl.kills / pl.deaths).toFixed(2) : pl.kills,
        avgRating: pl.matches > 0 ? +(pl.ratingSum / pl.matches).toFixed(2) : 0
      })).sort((a, b) => b.avgRating - a.avgRating);

    const updatedTop = topPlayers.map(tp => {
      const found = players.find(p => p.id === tp.id);
      return { ...tp, avatar: found ? found.avatar : '', displayName: found ? found.displayName : tp.name };
    });

    return {
      map, matches: data.matches,
      avgKd: data.totalDeaths > 0 ? +(data.totalKills / data.totalDeaths).toFixed(2) : data.totalKills,
      avgRating: data.ratingCount > 0 ? +(data.ratingSum / data.ratingCount).toFixed(2) : 0,
      topPlayers: updatedTop
    };
  }).sort((a, b) => b.matches - a.matches);

  const eligibleForStability = players.filter(p => p.matches >= 3);
  let mostStable = null;
  if (eligibleForStability.length > 0) {
    const stats = eligibleForStability.map(p => {
      const ratings = p.matchHistory.map(h => h.rating).filter(r => r !== null && r > 0);
      if (ratings.length < 3) return null;
      const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      const variance = ratings.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / ratings.length;
      return { player: p.displayName, playerId: p.id, stdDev: parseFloat(Math.sqrt(variance).toFixed(2)) };
    }).filter(Boolean);
    if (stats.length > 0) mostStable = stats.sort((a, b) => a.stdDev - b.stdDev)[0];
  }

  let highestPeak = null, lowestRating = null;
  for (const p of players) {
    for (const h of p.matchHistory) {
      if (h.rating && h.rating > 0) {
        if (!highestPeak || h.rating > highestPeak.rating) highestPeak = { player: p.displayName, playerId: p.id, rating: h.rating, map: h.map };
        if (!lowestRating || h.rating < lowestRating.rating) lowestRating = { player: p.displayName, playerId: p.id, rating: h.rating, map: h.map };
      }
    }
  }

  let favoriteMap = null;
  if (formattedMapStats.length > 0) favoriteMap = { map: formattedMapStats[0].map, matches: formattedMapStats[0].matches };

  return {
    players, mapStats: formattedMapStats,
    recentMatches: recentMatches.slice(-10).reverse(),
    totalMatches: matches.length,
    records,
    funStats: { totalHours: Math.round(totalMapsPlayed * 40 / 60), totalKills: totalKillsAll, totalDeaths: totalDeathsAll },
    funFacts: { mostStable, highestPeak, lowestRating, favoriteMap }
  };
}

async function main() {
  await fs.ensureDir(path.dirname(OUTPUT_FILE));
  const files = (await fs.readdir(MATCHES_DIR)).filter(f => f.endsWith('.json') && !f.includes('_awpy'));
  if (files.length === 0) {
    log('error', 'Нет матчей в data/matches/');
    await flushLog();
    return;
  }

  const allMatches = [];
  const tournamentsMap = new Map();
  const allSteamIds = new Set();

  for (const file of files) {
    try {
      const match = await fs.readJson(path.join(MATCHES_DIR, file));
      allMatches.push(match);
      const tName = match.tournament || 'Без турнира';
      if (!tournamentsMap.has(tName)) tournamentsMap.set(tName, []);
      tournamentsMap.get(tName).push(match);
      for (const map of match.maps || []) {
        for (const p of map.players || []) {
          if (p.id && !p.id.startsWith('name_')) allSteamIds.add(p.id);
        }
      }
    } catch (err) {
      log('error', `Не удалось прочитать ${file}: ${err.message}`);
    }
  }

  log('info', `Всего матчей: ${allMatches.length}, игроков: ${allSteamIds.size}`);
  
  // ПОДСТАВЛЯЕМ ПРОКСИ-РЕЙТИНГ В СЫРЫЕ МАТЧИ (если демки не было)
  for (const match of allMatches) {
    if (!match.maps) continue;
    for (const map of match.maps) {
      if (!map.players) continue;
      for (const p of map.players) {
        if (p.rating === null || p.rating === undefined) {
          const k = Number(p.kills) || 0;
          const d = Number(p.deaths) || 0;
          const kd = d > 0 ? k / d : (k > 0 ? 2.0 : 1.0);
          let proxyRating = 0.5 + kd * 0.5;
          if (k > 15) proxyRating += (k - 15) * 0.02;
          p.rating = +Math.min(3.0, proxyRating).toFixed(2);
        }
      }
    }
  }

  log('info', 'Запрашиваем аватарки...');
  const steamAvatars = await fetchSteamAvatars([...allSteamIds]);

  const output = {
    generatedAt: new Date().toISOString(),
    totalMatchesCount: allMatches.length,
    allMatches,
    tournaments: { 'Все матчи': calculateStats(allMatches, steamAvatars) }
  };

  for (const [tName, tMatches] of tournamentsMap.entries()) {
    output.tournaments[tName] = calculateStats(tMatches, steamAvatars);
  }

  await fs.writeJson(OUTPUT_FILE, output, { spaces: 2 });
  log('info', 'Статистика обновлена!');
  await flushLog();
}

main().catch(async (err) => {
  log('error', err.stack || err.message);
  await flushLog();
  process.exit(1);
});