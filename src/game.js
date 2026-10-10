export const FORMATS = {
  t20: 'T20 International', odi: 'ODI', test: 'Test', ipl: 'IPL',
};
export const ROLE_LABELS = { BAT: 'Batsman', BOWL: 'Bowler', AR: 'All-rounder' };
export const TEAM_SIZE = 5;

export function eligiblePlayers(country, format) {
  return country?.players.filter((player) => Number.isFinite(player.ratings[format])) || [];
}

export function maxRoomSize(country, format) {
  return Math.min(7, Math.floor(eligiblePlayers(country, format).length / TEAM_SIZE));
}

export function canCreate({ country, format, size, budget }) {
  return Boolean(country && FORMATS[format] && Number.isInteger(size) && size >= 2 &&
    size <= maxRoomSize(country, format) && Number.isInteger(budget) &&
    budget >= 20 && budget <= 100 && budget % 10 === 0);
}

export function createRoom({ code, country, format, size, budget, name }) {
  if (!canCreate({ country, format, size, budget })) throw new Error('That country and format cannot support this room size.');
  return {
    code, country: country.name, format, size, startingBudget: budget, phase: 'lobby',
    players: [{ id: 'P1', name, budget, picks: [], connected: true }],
    pool: [], index: 0, currentBid: 0, highBidder: null, passed: [],
    bidHistory: [], lastSale: '', round: 0,
  };
}

export function startRoom(room, country, shuffle = defaultShuffle) {
  if (room.phase !== 'lobby' && room.phase !== 'complete') throw new Error('This room cannot start now.');
  if (room.players.length !== room.size || room.players.some((player) => !player.connected)) {
    throw new Error(`Wait for all ${room.size} players to join.`);
  }
  const pool = eligiblePlayers(country, room.format);
  if (pool.length < room.size * TEAM_SIZE) throw new Error('The selected player pool is too small.');
  room.pool = shuffle(pool.map((player) => player.id));
  room.index = 0;
  room.round = 1;
  room.currentBid = 0;
  room.highBidder = null;
  room.passed = [];
  room.bidHistory = [];
  room.lastSale = '';
  room.phase = 'draft';
  for (const player of room.players) { player.budget = room.startingBudget; player.picks = []; }
  return room;
}

export function remainingSlots(room) {
  return room.players.reduce((total, player) => total + TEAM_SIZE - player.picks.length, 0);
}

export function maxBid(player) {
  return player.budget - (TEAM_SIZE - player.picks.length - 1);
}

export function canBid(room, player) {
  return room.phase === 'draft' && player?.connected && player.picks.length < TEAM_SIZE &&
    !room.passed.includes(player.id) && room.highBidder !== player.id &&
    maxBid(player) >= room.currentBid + 1;
}

export function applyAction(room, playerId, action, amount) {
  if (room.phase !== 'draft') return false;
  const player = room.players.find((entry) => entry.id === playerId);
  if (!player?.connected || player.picks.length >= TEAM_SIZE) return false;
  if (action === 'BID') {
    if (!canBid(room, player) || !Number.isInteger(amount) || amount <= room.currentBid || amount > maxBid(player)) return false;
    room.currentBid = amount;
    room.highBidder = playerId;
    room.bidHistory.push({ playerId, amount });
  } else if (action === 'PASS') {
    if (room.passed.includes(playerId)) return false;
    room.passed.push(playerId);
    if (room.highBidder === playerId) {
      room.highBidder = null;
      room.currentBid = 0;
      room.bidHistory = [];
    }
  } else return false;
  resolveAuction(room);
  return true;
}

function resolveAuction(room) {
  const contenders = room.players.filter((player) => canBid(room, player));
  if (room.highBidder && contenders.length === 0) {
    const winner = room.players.find((player) => player.id === room.highBidder);
    const cricketerId = room.pool[room.index];
    winner.budget -= room.currentBid;
    winner.picks.push({ cricketerId, price: room.currentBid });
    room.lastSale = `${winner.name} signed a cricketer for ${room.currentBid} credits.`;
    advance(room, false);
  } else if (!room.highBidder && contenders.length === 0) {
    advance(room, true);
  }
}

function advance(room, recycle) {
  if (room.players.every((player) => player.picks.length === TEAM_SIZE)) {
    room.phase = 'complete';
    return;
  }
  if (recycle) room.pool.push(room.pool[room.index]);
  room.index += 1;
  room.round += 1;
  room.currentBid = 0;
  room.highBidder = null;
  room.passed = [];
  room.bidHistory = [];
  if (room.index >= room.pool.length) throw new Error('No draftable cricketers remain.');
}

export function results(room, country) {
  const byId = new Map(country.players.map((player) => [player.id, player]));
  const scored = room.players.map((player) => {
    const picks = player.picks.map((pick) => ({ ...pick, cricketer: byId.get(pick.cricketerId) }));
    const base = picks.reduce((total, pick) => total + (pick.cricketer?.ratings[room.format] || 0), 0);
    const counts = { BAT: 0, BOWL: 0, AR: 0 };
    for (const pick of picks) counts[pick.cricketer?.role] += 1;
    const balanced = picks.length === TEAM_SIZE && counts.BAT === 2 && counts.BOWL === 2 && counts.AR === 1;
    const bonus = balanced ? Math.round(base * .1) : 0;
    return { ...player, picks, base, balanced, bonus, total: base + bonus };
  });
  scored.sort((a, b) => b.total - a.total || b.budget - a.budget || b.base - a.base);
  let displayedRank = 0;
  return scored.map((player, index) => {
    const tied = index > 0 && player.total === scored[index - 1].total && player.budget === scored[index - 1].budget && player.base === scored[index - 1].base;
    if (!tied) displayedRank = index + 1;
    return { ...player, rank: displayedRank, tied };
  });
}

export function defaultShuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}
