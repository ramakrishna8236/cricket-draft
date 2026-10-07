import { LiveRoom } from './room.js';
import { FORMATS, ROLE_LABELS, canBid, eligiblePlayers, maxBid, maxRoomSize, results } from './game.js';
import { createResultCard, downloadResultCard } from './resultCard.js';

const catalog = await fetch('/src/data/catalog.json').then((response) => {
  if (!response.ok) throw new Error('Could not load the cricketer catalog.');
  return response.json();
});

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const formatName = (key) => FORMATS[key] || key;
const initials = (name) => name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
const countryFor = (name) => catalog.countries.find((country) => country.name === name);
let roomView = null;
let selfId = null;
let toastTimer;
let currentScreen = 'landing';

function notice(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 5200);
}

function reaction(emoji) {
  const item = document.createElement('span');
  item.className = 'floating-reaction';
  item.textContent = emoji;
  item.style.left = `${20 + Math.random() * 60}%`;
  document.body.appendChild(item);
  setTimeout(() => item.remove(), 1900);
}

const live = new LiveRoom({ catalog, onState: (room, id) => {
  roomView = room;
  selfId = id;
  render();
}, onNotice: notice, onReaction: reaction });

function selectTab(tab) {
  document.querySelectorAll('.setup-tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  $('#create-form').classList.toggle('hidden', tab !== 'create');
  $('#join-form').classList.toggle('hidden', tab !== 'join');
}

function selectedFormat() { return document.querySelector('input[name="format"]:checked').value; }

function updateCountryOptions() {
  const format = selectedFormat();
  const select = $('#create-country');
  const previous = select.value || 'India';
  const countries = catalog.countries.filter((country) => maxRoomSize(country, format) >= 2);
  select.innerHTML = countries.map((country) => `<option value="${escapeHtml(country.name)}">${escapeHtml(country.name)}</option>`).join('');
  select.value = countries.some((country) => country.name === previous) ? previous : countries.some((country) => country.name === 'India') ? 'India' : countries[0]?.name || '';
  updateRoomSize();
}

function updateRoomSize() {
  const country = countryFor($('#create-country').value);
  const format = selectedFormat();
  const size = $('#create-size');
  const previous = Number(size.value) || 2;
  const max = maxRoomSize(country, format);
  size.innerHTML = Array.from({ length: Math.max(0, max - 1) }, (_, index) => `<option value="${index + 2}">${index + 2} players</option>`).join('');
  size.value = String(Math.min(previous, max));
  const count = eligiblePlayers(country, format).length;
  $('#pool-note').textContent = `${count} eligible cricketers · Supports ${max} ${max === 1 ? 'player' : 'players'} maximum in ${formatName(format)}.`;
}

function randomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const numbers = '23456789';
  const values = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(values.slice(0, 4), (value) => letters[value % letters.length]).join('') + Array.from(values.slice(4), (value) => numbers[value % numbers.length]).join('');
}

function roomHeader(room) {
  const joined = room.players.filter((player) => player.connected).length;
  return `<div class="room-top"><div class="room-breadcrumb"><span class="live-dot"></span><span>LIVE ROOM</span><strong>${escapeHtml(room.code)}</strong><span class="room-divider">/</span><span>${escapeHtml(room.country)}</span><span class="room-divider">/</span><span>${escapeHtml(formatName(room.format))}</span></div><div class="room-top-actions"><span>${joined}/${room.size} connected</span><button type="button" class="small-button" data-action="copy">Copy invite</button><button type="button" class="small-button" data-action="leave">Leave</button></div></div>`;
}

function roster(room) {
  return Array.from({ length: room.size }, (_, index) => {
    const player = room.players[index];
    return `<li class="roster-line ${player?.connected ? 'connected' : ''}"><span class="roster-number">${String(index + 1).padStart(2, '0')}</span><span class="roster-avatar">${player ? escapeHtml(initials(player.name)) : '—'}</span><span class="roster-name">${escapeHtml(player?.name || 'Waiting for player')} ${player?.id === selfId ? '<em>YOU</em>' : ''}</span><span class="roster-state">${player?.connected ? '● Ready' : '○ Waiting'}</span></li>`;
  }).join('');
}

function renderLobby(room) {
  const joined = room.players.filter((player) => player.connected).length;
  const paused = room.phase === 'paused';
  const status = paused ? 'The auction will resume as soon as everyone reconnects.' : joined === room.size ? 'Everyone is here. The draft starts shortly.' : `Share the room code with ${room.size - joined} more ${room.size - joined === 1 ? 'player' : 'players'}. The draft starts when everyone is here.`;
  return `${roomHeader(room)}<section class="lobby-layout"><div class="lobby-main glass-panel"><span class="section-label">${paused ? 'DRAFT PAUSED' : 'THE TEAM IS ASSEMBLING'}</span><h1>${paused ? 'Waiting for a player to rejoin.' : 'Your room is ready.'}</h1><p>${status}</p><div class="invite-code"><span>ROOM CODE</span><strong>${escapeHtml(room.code)}</strong><button type="button" data-action="copy">Copy link ↗</button></div><div class="lobby-settings"><span>${escapeHtml(room.country)}</span><span>${escapeHtml(formatName(room.format))}</span><span>${room.startingBudget} credits each</span><span>5 picks each</span></div><p class="lobby-era">2010+ Era · International appearance within the past five years.</p>${live.host && !paused ? `<button type="button" class="primary-button lobby-start" data-action="start" ${joined === room.size ? '' : 'disabled'}>Start the draft <span>↗</span></button>` : ''}</div><aside class="roster-panel glass-panel"><div class="panel-heading"><span>PLAYERS</span><strong>${joined} / ${room.size}</strong></div><ol>${roster(room)}</ol></aside></section>`;
}

function playerPanel(room, player, index, byId) {
  const mine = player.id === selfId;
  const picks = player.picks.map((pick) => byId.get(pick.cricketerId)).filter(Boolean);
  return `<article class="team-card ${mine ? 'mine' : ''} ${player.connected ? '' : 'offline'}"><div class="team-top"><div><span class="team-number">TEAM ${String(index + 1).padStart(2, '0')}${mine ? ' · YOU' : ''}</span><h3>${escapeHtml(player.name)}</h3></div><strong>${player.budget}<small> cr</small></strong></div><div class="team-progress"><span style="width:${picks.length * 20}%"></span></div><div class="team-slots">${Array.from({ length: 5 }, (_, slot) => {
    const cricketer = picks[slot];
    return cricketer ? `<div class="team-pick"><span class="pick-role role-${cricketer.role.toLowerCase()}">${cricketer.role}</span><span>${escapeHtml(cricketer.name)}</span></div>` : `<div class="team-pick empty"><span class="pick-role">${slot + 1}</span><span>Open pick</span></div>`;
  }).join('')}</div><div class="team-footer"><span>${picks.length} / 5 drafted</span><span>${player.connected ? '● Online' : '○ Offline'}</span></div></article>`;
}

function renderDraft(room) {
  const country = countryFor(room.country);
  const byId = new Map(country.players.map((player) => [player.id, player]));
  const cricketer = byId.get(room.pool[room.index]);
  const me = room.players.find((player) => player.id === selfId);
  const leading = room.players.find((player) => player.id === room.highBidder);
  const able = canBid(room, me);
  const passable = me?.picks.length < 5 && !room.passed.includes(selfId) && room.highBidder !== selfId;
  const limit = me ? maxBid(me) : 0;
  const trail = room.bidHistory.length ? room.bidHistory.slice(-6).map((bid) => `<span>${escapeHtml(room.players.find((p) => p.id === bid.playerId)?.name || bid.playerId)} · ${bid.amount}</span>`).join('') : '<span>No bids yet. Make the first move.</span>';
  return `${roomHeader(room)}<div class="draft-layout"><div class="auction-column"><div class="auction-meta"><span>CRICKETER ${room.round}</span><span>${room.players.reduce((sum, player) => sum + player.picks.length, 0)} / ${room.size * 5} SIGNED</span></div><section class="spotlight glass-panel"><div class="spotlight-top"><span class="on-block"><i></i> ON THE BLOCK</span><span>${escapeHtml(formatName(room.format))} DRAFT</span></div><div class="player-art role-${cricketer?.role.toLowerCase()}"><div class="player-halo"></div><span>${escapeHtml(initials(cricketer?.name || 'CD'))}</span><div class="player-role">${escapeHtml(ROLE_LABELS[cricketer?.role] || '')}</div></div><div class="spotlight-name"><span>${escapeHtml(room.country)} · ${escapeHtml(formatName(room.format))}</span><h1>${escapeHtml(cricketer?.name || 'Cricketer')}</h1></div></section><section class="bidding-panel glass-panel"><div class="bid-status"><div><span>CURRENT BID</span><strong>${room.currentBid || 1}<small> credits</small></strong></div><p>${leading ? `${escapeHtml(leading.name)} leads the auction` : 'Opening bid · be first to raise your paddle'}</p></div><div class="bid-trail">${trail}</div><div class="bid-actions"><button type="button" class="primary-button" data-action="bid" ${able ? '' : 'disabled'}>Bid ${room.currentBid + 1} <span>↗</span></button><button type="button" class="raise-button" data-action="bid2" ${able && room.currentBid + 2 <= limit ? '' : 'disabled'}>+2</button><button type="button" class="pass-button" data-action="pass" ${passable ? '' : 'disabled'}>Pass</button></div><p class="bid-hint">${me?.picks.length === 5 ? 'Your five-player team is complete.' : room.passed.includes(selfId) ? 'You passed on this cricketer.' : room.highBidder === selfId ? 'Your bid leads. Waiting for the others.' : `You can bid up to ${Math.max(0, limit)} credits while saving for your remaining picks.`}</p></section><div class="reaction-row"><span>REACT</span>${['🔥','🏏','👏','😮','💪'].map((emoji) => `<button type="button" data-action="react" data-emoji="${emoji}" aria-label="React ${emoji}">${emoji}</button>`).join('')}</div></div><aside class="teams-column"><div class="teams-heading"><div><span class="section-label">LIVE SCOREBOARD</span><h2>Drafted teams</h2></div><span>${room.players.length} teams</span></div><div class="teams-list">${room.players.map((player, index) => playerPanel(room, player, index, byId)).join('')}</div></aside></div><p class="last-sale" role="status">${escapeHtml(room.lastSale)}</p>`;
}

function renderResults(room) {
  const ranked = results(room, countryFor(room.country));
  const top = ranked[0];
  const tiedWinners = ranked.filter((player) => player.rank === 1);
  const headline = tiedWinners.length > 1 ? 'A tie at the top.' : `${top.name} takes the win.`;
  return `${roomHeader(room)}<section class="results-hero"><span class="section-label">DRAFT COMPLETE</span><h1>${escapeHtml(headline)}</h1><p>${escapeHtml(room.country)} · ${escapeHtml(formatName(room.format))} · ${room.size} teams</p><div class="winner-score"><strong>${top.total}</strong><span>FINAL SCORE</span></div></section><section class="results-section"><div class="results-header"><div><span class="section-label">THE FINAL ORDER</span><h2>Every pick counts.</h2></div><div class="result-actions"><button type="button" class="small-button" data-action="share">Share result</button><button type="button" class="small-button" data-action="download">Download card</button>${live.host ? '<button type="button" class="primary-button" data-action="again">Play again ↗</button>' : ''}</div></div><div class="result-list">${ranked.map((player) => `<article class="result-card ${player.rank === 1 ? 'winner' : ''}"><div class="result-rank">${String(player.rank).padStart(2, '0')}</div><div class="result-detail"><div class="result-name"><h3>${escapeHtml(player.name)}</h3>${player.rank === 1 ? `<span class="winner-tag">${tiedWinners.length > 1 ? 'TIED' : 'WINNER'}</span>` : ''}</div><p>${player.picks.map((pick) => escapeHtml(pick.cricketer?.name || '')).join(' · ')}</p><div class="result-calculation"><span>Base ${player.base}</span>${player.balanced ? `<span class="balance-bonus">Perfect balance: 2 batsmen · 2 bowlers · 1 all-rounder <strong>+${player.bonus}</strong></span>` : '<span>No balance bonus</span>'}<span>${player.budget} credits left</span></div></div><strong class="result-total">${player.total}</strong></article>`).join('')}</div><p class="bonus-reveal">The balance rule is revealed at the finish: an exact 2 batsmen, 2 bowlers, 1 all-rounder team earns a 10% bonus on its base score. Any five-player lineup is valid.</p></section>`;
}

function render() {
  const nextScreen = roomView ? `${roomView.code}:${roomView.phase === 'paused' ? 'lobby' : roomView.phase}` : 'landing';
  $('#landing').classList.toggle('hidden', Boolean(roomView));
  $('#game').classList.toggle('hidden', !roomView);
  if (!roomView) {
    $('#game').innerHTML = '';
    if (currentScreen !== 'landing') window.scrollTo({ top: 0, behavior: 'instant' });
    currentScreen = nextScreen;
    return;
  }
  $('#game').innerHTML = roomView.phase === 'lobby' || roomView.phase === 'paused' ? renderLobby(roomView) : roomView.phase === 'draft' ? renderDraft(roomView) : renderResults(roomView);
  if (nextScreen !== currentScreen) window.scrollTo({ top: 0, behavior: 'instant' });
  currentScreen = nextScreen;
}

async function copyInvite() {
  try { await navigator.clipboard.writeText(live.inviteLink()); notice('Invite link copied.'); }
  catch { notice(`Room code: ${roomView.code}`); }
}

async function shareResults() {
  const ranked = results(roomView, countryFor(roomView.country));
  const text = `🏏 Cricket Draft · ${roomView.country} · ${formatName(roomView.format)}\n${ranked.map((player) => `${player.rank}. ${player.name} — ${player.total} points`).join('\n')}\n${location.origin}`;
  try {
    const blob = await createResultCard(roomView, ranked);
    const file = new File([blob], `cricket-draft-${roomView.code}.png`, { type: 'image/png' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) await navigator.share({ title: 'Cricket Draft results', text, files: [file] });
    else { await navigator.clipboard.writeText(text); notice('Results copied. Download the card to share the image.'); }
  } catch (error) { if (error.name !== 'AbortError') notice('Could not share the result.'); }
}

$('#header-how').addEventListener('click', () => { if (roomView) notice('Draft any five. Scores are revealed when every team is full.'); else $('#how').scrollIntoView({ behavior: 'smooth' }); });
$('#hero-join').addEventListener('click', () => { selectTab('join'); $('#play').scrollIntoView({ behavior: 'smooth' }); });
document.querySelectorAll('.setup-tab').forEach((button) => button.addEventListener('click', () => selectTab(button.dataset.tab)));
document.querySelectorAll('input[name="format"]').forEach((input) => input.addEventListener('change', updateCountryOptions));
$('#create-country').addEventListener('change', updateRoomSize);
$('#create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const country = countryFor($('#create-country').value);
  const name = $('#create-name').value.trim();
  if (!name) return notice('Enter your name to create a room.');
  try { live.create({ code: randomCode(), name, country,
    format: selectedFormat(), size: Number($('#create-size').value), budget: Number($('#create-budget').value) }); }
  catch (error) { notice(error.message); }
});
$('#join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const code = $('#join-code').value.trim().toUpperCase();
  const name = $('#join-name').value.trim();
  if (!/^[A-Z2-9]{6}$/.test(code)) return notice('Enter the six-character room code.');
  if (!name) return notice('Enter your name to join.');
  try { live.join(code, name); notice('Connecting to the room…'); }
  catch (error) { notice(error.message); }
});
$('#game').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || !roomView) return;
  const action = button.dataset.action;
  if (action === 'copy') copyInvite();
  else if (action === 'leave') live.leave();
  else if (action === 'start' || action === 'again') live.start();
  else if (action === 'bid') live.action('BID', roomView.currentBid + 1);
  else if (action === 'bid2') live.action('BID', roomView.currentBid + 2);
  else if (action === 'pass') live.action('PASS');
  else if (action === 'react') live.react(button.dataset.emoji);
  else if (action === 'share') shareResults();
  else if (action === 'download') {
    try { await downloadResultCard(roomView, results(roomView, countryFor(roomView.country))); notice('Result card downloaded.'); }
    catch { notice('Could not create the result card.'); }
  }
});

updateCountryOptions();
const roomCode = new URLSearchParams(location.search).get('room');
if (roomCode) {
  selectTab('join');
  $('#join-code').value = roomCode.toUpperCase();
  setTimeout(() => $('#play').scrollIntoView({ behavior: 'smooth' }), 200);
}
