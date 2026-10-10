import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { applyAction, canBid, canCreate, createRoom, eligiblePlayers, maxBid, maxRoomSize, results, startRoom } from '../src/game.js';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const india = catalog.countries.find((country) => country.name === 'India');

test('catalog covers countries and retains only format-eligible rooms', () => {
  assert.ok(catalog.countries.length >= 100);
  assert.equal(maxRoomSize(india, 'odi'), 7);
  for (const country of catalog.countries) {
    assert.ok(country.players.length >= 10);
    assert.equal(new Set(country.players.map((player) => player.id)).size, country.players.length);
    for (const player of country.players) {
      assert.ok(player.recentInternationalMatches >= 2);
      assert.ok(['BAT', 'BOWL', 'AR'].includes(player.role));
      for (const score of Object.values(player.ratings)) assert.ok(score >= 1 && score <= 100);
    }
  }
});

test('country and format constrain capacity, while budgets stay within 20–100', () => {
  assert.equal(canCreate({ country: india, format: 'odi', size: 7, budget: 100 }), true);
  assert.equal(canCreate({ country: india, format: 'odi', size: 8, budget: 50 }), false);
  assert.equal(canCreate({ country: india, format: 'odi', size: 2, budget: 10 }), false);
  assert.equal(canCreate({ country: india, format: 'odi', size: 2, budget: 25 }), false);
  const small = { name: 'Small', players: india.players.slice(0, 4) };
  assert.equal(maxRoomSize(small, 'odi'), 0);
});

test('seven-player auction completes with unique five-player teams and no overspend', () => {
  const room = createRoom({ code: 'TEST42', country: india, format: 'odi', size: 7, budget: 20, name: 'Player 1' });
  for (let i = 2; i <= 7; i++) room.players.push({ id: `P${i}`, name: `Player ${i}`, budget: 20, picks: [], connected: true });
  startRoom(room, india, (items) => items);
  assert.equal(room.phase, 'draft');
  const first = room.players[0];
  assert.equal(maxBid(first), 16);
  assert.equal(applyAction(room, 'P1', 'BID', 17), false);
  let moves = 0;
  while (room.phase === 'draft') {
    assert.ok(++moves < 600, 'auction should terminate');
    const target = room.players.find((player) => player.picks.length < 5);
    const index = room.index;
    assert.equal(applyAction(room, target.id, 'BID', 1), true);
    for (const player of room.players) {
      if (room.index !== index || room.phase !== 'draft') break;
      if (player.id !== target.id && player.picks.length < 5) applyAction(room, player.id, 'PASS');
    }
  }
  assert.equal(room.phase, 'complete');
  assert.ok(room.players.every((player) => player.picks.length === 5 && player.budget === 15));
  const allPicks = room.players.flatMap((player) => player.picks.map((pick) => pick.cricketerId));
  assert.equal(new Set(allPicks).size, 35);
  assert.ok(allPicks.every((id) => eligiblePlayers(india, 'odi').some((player) => player.id === id)));
});

test('a leading bidder can pass and reopen the auction', () => {
  const room = createRoom({ code: 'TEST44', country: india, format: 'odi', size: 2, budget: 20, name: 'Player 1' });
  room.players.push({ id: 'P2', name: 'Player 2', budget: 20, picks: [], connected: true });
  room.phase = 'draft';
  room.currentBid = 5;
  room.highBidder = 'P1';
  room.passed = [];
  room.round = 1;
  room.pool = ['a', 'b', 'c', 'd'];
  room.index = 0;

  const allowed = applyAction(room, 'P1', 'PASS');

  assert.equal(allowed, true);
  assert.equal(room.highBidder, null);
  assert.equal(room.currentBid, 0);
  assert.deepEqual(room.passed, ['P1']);
  assert.equal(canBid(room, room.players[1]), true);
});

test('any five is legal, while an exact 2/2/1 team gets a results-only bonus', () => {
  const country = { name: 'Fixture', players: [
    { id: 'a', role: 'BAT', ratings: { odi: 50 } },
    { id: 'b', role: 'BAT', ratings: { odi: 50 } },
    { id: 'c', role: 'BOWL', ratings: { odi: 50 } },
    { id: 'd', role: 'BOWL', ratings: { odi: 50 } },
    { id: 'e', role: 'AR', ratings: { odi: 50 } },
    { id: 'f', role: 'BAT', ratings: { odi: 50 } },
    { id: 'g', role: 'BAT', ratings: { odi: 50 } },
    { id: 'h', role: 'BAT', ratings: { odi: 50 } },
    { id: 'i', role: 'BAT', ratings: { odi: 50 } },
    { id: 'j', role: 'BAT', ratings: { odi: 50 } },
  ] };
  const room = createRoom({ code: 'TEST43', country, format: 'odi', size: 2, budget: 50, name: 'Balanced' });
  room.players.push({ id: 'P2', name: 'All batters', budget: 50, picks: [], connected: true });
  room.players[0].picks = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ cricketerId: id, price: 1 }));
  room.players[1].picks = ['f', 'g', 'h', 'i', 'j'].map((id) => ({ cricketerId: id, price: 1 }));
  const scored = results(room, country);
  assert.equal(scored[0].base, 250);
  assert.equal(scored[0].bonus, 25);
  assert.equal(scored[0].total, 275);
  assert.equal(scored[1].bonus, 0);
  assert.equal(scored[1].total, 250);
  assert.equal(canBid({ ...room, phase: 'draft' }, room.players[1]), false);
});
