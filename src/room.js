import { applyAction, createRoom, startRoom } from './game.js';

const PREFIX = 'CD-';
const readMessage = (data) => typeof data === 'string' ? JSON.parse(data) : data;

export class LiveRoom {
  constructor({ catalog, onState, onNotice, onReaction }) {
    this.catalog = catalog;
    this.onState = onState;
    this.onNotice = onNotice;
    this.onReaction = onReaction;
    this.peer = null;
    this.conn = null;
    this.connections = new Map();
    this.room = null;
    this.selfId = null;
    this.host = false;
    this.closing = false;
    this.readyTimer = null;
  }

  country() { return this.catalog.countries.find((country) => country.name === this.room?.country); }
  inviteLink() { return `${location.origin}${location.pathname}?room=${encodeURIComponent(this.room.code)}`; }

  create(config) {
    if (!window.Peer) throw new Error('Online connection is loading. Please try again.');
    this.leave(false);
    this.host = true;
    this.closing = false;
    this.selfId = 'P1';
    const peer = new Peer(`${PREFIX}${config.code}`);
    this.peer = peer;
    peer.on('open', () => {
      if (this.peer !== peer || this.closing) return;
      this.room = createRoom(config);
      this.enter();
      this.onNotice(`Room ${config.code} is ready. Share the invite link.`);
    });
    peer.on('connection', (conn) => this.acceptConnection(conn));
    peer.on('disconnected', () => {
      if (!this.closing) {
        this.onNotice('Room connection paused. Reconnecting…');
        try { peer.reconnect(); } catch { /* PeerJS retries via online event. */ }
      }
    });
    peer.on('error', (error) => {
      if (this.closing) return;
      if (error.type === 'unavailable-id' && !this.room) this.leave(false);
      this.onNotice(error.type === 'unavailable-id' ? 'That room code is taken. Try again.' : `Connection error: ${error.message || error.type}`);
    });
  }

  join(code, name) {
    if (!window.Peer) throw new Error('Online connection is loading. Please try again.');
    this.leave(false);
    this.host = false;
    this.closing = false;
    const peer = new Peer();
    this.peer = peer;
    const tokenKey = `cricket-draft-token-${code}`;
    const token = sessionStorage.getItem(tokenKey) || crypto.randomUUID();
    sessionStorage.setItem(tokenKey, token);
    const connect = () => {
      if (this.peer !== peer || this.closing || peer.destroyed) return;
      const conn = peer.connect(`${PREFIX}${code}`, { reliable: true });
      this.conn = conn;
      const timeout = setTimeout(() => {
        if (this.conn === conn && !this.room) { conn.close(); this.onNotice('Could not reach the host. Check the code and ask them to keep their tab open.'); }
      }, 12000);
      conn.on('open', () => {
        clearTimeout(timeout);
        conn.send({ type: 'JOIN', name: name.slice(0, 30), token });
      });
      conn.on('data', (raw) => {
        const data = readMessage(raw);
        if (data.type === 'WELCOME') {
          this.selfId = data.selfId;
          this.room = data.room;
          this.enter();
          this.onNotice(`Joined room ${code}.`);
        } else if (data.type === 'STATE') {
          this.room = data.room;
          this.onState(this.room, this.selfId);
        } else if (data.type === 'REACTION') this.onReaction(data.emoji);
        else if (data.type === 'REJECT') { this.onNotice(data.reason); this.leave(false); }
      });
      conn.on('close', () => {
        clearTimeout(timeout);
        if (!this.closing) {
          this.onNotice('The host disconnected. Rejoin when the host opens the room again.');
          this.leave(false);
          this.onState(null, null);
        }
      });
      conn.on('error', () => this.onNotice('Connection lost. Please rejoin the room.'));
    };
    peer.on('open', connect);
    peer.on('error', (error) => {
      if (!this.closing) this.onNotice(`Connection error: ${error.message || error.type}`);
    });
  }

  acceptConnection(conn) {
    conn.on('data', (raw) => {
      let data;
      try { data = readMessage(raw); } catch { return; }
      if (data.type === 'JOIN') {
        if (!this.room) return conn.send({ type: 'REJECT', reason: 'The room is not ready yet.' });
        const token = String(data.token || '');
        let player = this.room.players.find((entry) => entry.token === token && entry.id !== 'P1');
        if (!player && this.room.phase === 'lobby' && this.room.players.length < this.room.size) {
          player = { id: `P${this.room.players.length + 1}`, name: String(data.name || 'Player').slice(0, 30),
            token, budget: this.room.startingBudget, picks: [], connected: true };
          this.room.players.push(player);
        }
        if (!player) return conn.send({ type: 'REJECT', reason: this.room.phase === 'lobby' ? 'This room is full.' : 'This draft has already started.' });
        const previous = [...this.connections.values()].find((entry) => entry.playerId === player.id);
        if (previous) {
          this.connections.delete(previous.conn.peer);
          previous.conn.close();
        }
        player.connected = true;
        this.connections.set(conn.peer, { conn, playerId: player.id });
        if (this.room.phase === 'paused' && this.room.players.every((entry) => entry.connected)) this.room.phase = 'draft';
        conn.send({ type: 'WELCOME', selfId: player.id, room: this.publicRoom() });
        this.publish();
        this.scheduleStart();
        this.onNotice(`${player.name} joined.`);
      } else {
        const entry = this.connections.get(conn.peer);
        if (!entry) return;
        if (data.type === 'ACTION' && applyAction(this.room, entry.playerId, data.action, data.amount)) this.publish();
        if (data.type === 'REACTION' && typeof data.emoji === 'string' && data.emoji.length < 10) this.react(data.emoji);
      }
    });
    conn.on('close', () => {
      const entry = this.connections.get(conn.peer);
      if (!entry || !this.room) return;
      this.connections.delete(conn.peer);
      const player = this.room.players.find((item) => item.id === entry.playerId);
      if (player) player.connected = false;
      if (this.room.phase === 'draft') this.room.phase = 'paused';
      clearTimeout(this.readyTimer);
      this.publish();
    });
  }

  publicRoom() {
    return { ...this.room, players: this.room.players.map(({ token, ...player }) => player) };
  }

  publish() {
    const room = this.publicRoom();
    this.onState(room, this.selfId);
    for (const { conn } of this.connections.values()) if (conn.open) conn.send({ type: 'STATE', room });
  }

  scheduleStart() {
    clearTimeout(this.readyTimer);
    if (this.room?.phase !== 'lobby' || this.room.players.length !== this.room.size || this.room.players.some((player) => !player.connected)) return;
    this.readyTimer = setTimeout(() => this.start(), 2500);
  }

  start() {
    if (!this.host || !this.room) return;
    clearTimeout(this.readyTimer);
    try { startRoom(this.room, this.country()); this.publish(); }
    catch (error) { this.onNotice(error.message); }
  }

  action(action, amount) {
    if (!this.room) return;
    if (this.host) {
      if (applyAction(this.room, this.selfId, action, amount)) this.publish();
    } else if (this.conn?.open) this.conn.send({ type: 'ACTION', action, amount });
  }

  react(emoji) {
    if (this.host) {
      this.onReaction(emoji);
      for (const { conn } of this.connections.values()) if (conn.open) conn.send({ type: 'REACTION', emoji });
    } else if (this.conn?.open) this.conn.send({ type: 'REACTION', emoji });
  }

  enter() {
    history.replaceState({}, '', this.inviteLink());
    this.onState(this.publicRoom(), this.selfId);
  }

  leave(notice = true) {
    this.closing = true;
    clearTimeout(this.readyTimer);
    try { this.conn?.close(); } catch { /* already closed */ }
    for (const { conn } of this.connections.values()) try { conn.close(); } catch { /* already closed */ }
    try { this.peer?.destroy(); } catch { /* already closed */ }
    this.connections.clear();
    this.conn = null;
    this.peer = null;
    this.room = null;
    this.selfId = null;
    this.host = false;
    if (notice) {
      history.replaceState({}, '', location.pathname);
      this.onState(null, null);
      this.onNotice('Left the room.');
    }
  }
}
