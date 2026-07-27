/**
 * Schaatssprint — lobbyserver
 * Node 18+, enige dependency: ws
 *
 *   npm install
 *   node server.js            (of: pm2 start server.js --name schaats)
 *
 * Serveert /public en draait een WebSocket-lobby op dezelfde poort.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const PUB  = path.join(__dirname, 'public');
const COUNTDOWN_MS = 10000;          // 10 seconden aftellen
const CHALLENGE_TTL = 25000;         // uitdaging vervalt na 25s

const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png',
  '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUB, safe);
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end('nope'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain'}); return res.end('Niet gevonden'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
                         'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

/** @type {Map<string, Player>} */
const players = new Map();
const races   = new Map();
let seq = 0;
const uid = () => (++seq).toString(36) + Math.random().toString(36).slice(2, 7);

function send(ws, obj) {
  if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
}
function lobbyList() {
  return [...players.values()]
    .filter(p => p.naam)
    .map(p => ({ id: p.id, naam: p.naam, status: p.status, best: p.best, suit: p.suit, g: p.g }));
}
function pushLobby() {
  const list = lobbyList();
  for (const p of players.values()) send(p.ws, { t: 'lobby', players: list, you: p.id });
}

function endChallenge(p, reason) {
  if (p.challengeTimer) { clearTimeout(p.challengeTimer); p.challengeTimer = null; }
  const other = players.get(p.pendingWith);
  p.pendingWith = null;
  if (p.status === 'uitgedaagd' || p.status === 'wacht') p.status = 'lobby';
  if (other) {
    other.pendingWith = null;
    if (other.challengeTimer) { clearTimeout(other.challengeTimer); other.challengeTimer = null; }
    if (other.status === 'uitgedaagd' || other.status === 'wacht') other.status = 'lobby';
    send(other.ws, { t: 'challengeOff', reason });
  }
  send(p.ws, { t: 'challengeOff', reason });
  pushLobby();
}

function startRace(a, b) {
  const id = uid();
  const startAt = Date.now() + COUNTDOWN_MS;
  const race = { id, a: a.id, b: b.id, startAt, results: {} };
  races.set(id, race);
  a.status = b.status = 'race';
  a.raceId = b.raceId = id;
  a.opp = b.id; b.opp = a.id;
  const info = p => ({ id: p.id, naam: p.naam, suit: p.suit, g: p.g, best: p.best });
  send(a.ws, { t: 'raceStart', raceId: id, startAt, now: Date.now(), opponent: info(b) });
  send(b.ws, { t: 'raceStart', raceId: id, startAt, now: Date.now(), opponent: info(a) });
  pushLobby();
}

function finishRace(race) {
  const a = players.get(race.a), b = players.get(race.b);
  const ra = race.results[race.a], rb = race.results[race.b];
  const payload = (me, them, meRes, themRes) => ({
    t: 'raceResult',
    you:  meRes   ? meRes.time   : null,
    them: themRes ? themRes.time : null,
    themNaam: them ? them.naam : 'Tegenstander',
    won: meRes && (!themRes || meRes.time <= themRes.time)
  });
  if (a) { send(a.ws, payload(a, b, ra, rb)); a.status = 'lobby'; a.raceId = null; a.opp = null; }
  if (b) { send(b.ws, payload(b, a, rb, ra)); b.status = 'lobby'; b.raceId = null; b.opp = null; }
  races.delete(race.id);
  pushLobby();
}

wss.on('connection', (ws) => {
  const p = { id: uid(), ws, naam: '', suit: null, g: 'm', best: null,
              status: 'lobby', pendingWith: null, challengeTimer: null,
              raceId: null, opp: null, alive: true };
  players.set(p.id, p);
  send(ws, { t: 'welcome', id: p.id, now: Date.now(), countdown: COUNTDOWN_MS });

  ws.on('pong', () => { p.alive = true; });

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }

    switch (m.t) {
      case 'ping':
        send(ws, { t: 'pong', t0: m.t0, now: Date.now() });
        break;

      case 'hello':
        p.naam = String(m.naam || 'Rijder').slice(0, 16);
        p.suit = m.suit || null;
        p.g    = m.g === 'v' ? 'v' : 'm';
        p.best = typeof m.best === 'number' ? m.best : null;
        pushLobby();
        break;

      case 'profile':                                  // pak/PR gewijzigd
        if (m.suit) p.suit = m.suit;
        if (m.g) p.g = m.g === 'v' ? 'v' : 'm';
        if (typeof m.best === 'number') p.best = m.best;
        pushLobby();
        break;

      case 'challenge': {
        const o = players.get(m.to);
        if (!o || o.id === p.id) return;
        if (o.status !== 'lobby' || p.status !== 'lobby') {
          return send(ws, { t: 'info', msg: 'Die rijder is nu niet vrij.' });
        }
        p.status = 'wacht'; o.status = 'uitgedaagd';
        p.pendingWith = o.id; o.pendingWith = p.id;
        send(o.ws, { t: 'challenged', from: { id: p.id, naam: p.naam, best: p.best } });
        send(ws,   { t: 'challengeSent', to: { id: o.id, naam: o.naam } });
        p.challengeTimer = setTimeout(() => endChallenge(p, 'verlopen'), CHALLENGE_TTL);
        pushLobby();
        break;
      }

      case 'accept': {
        const o = players.get(p.pendingWith);
        if (!o || o.pendingWith !== p.id) return;
        if (p.challengeTimer) { clearTimeout(p.challengeTimer); p.challengeTimer = null; }
        if (o.challengeTimer) { clearTimeout(o.challengeTimer); o.challengeTimer = null; }
        p.pendingWith = o.pendingWith = null;
        startRace(o, p);
        break;
      }

      case 'decline':
        if (p.pendingWith) endChallenge(p, 'geweigerd');
        break;

      case 'cancel':
        if (p.pendingWith) endChallenge(p, 'geannuleerd');
        break;

      case 'pos': {                                    // live positie doorgeven
        const o = players.get(p.opp);
        if (o) send(o.ws, { t: 'opos', d: m.d, v: m.v, en: m.en, lane: m.lane, tt: m.tt });
        break;
      }

      case 'finish': {
        const race = races.get(p.raceId);
        if (!race) return;
        race.results[p.id] = { time: m.time };
        const o = players.get(p.opp);
        if (o) send(o.ws, { t: 'oppFinished', time: m.time, naam: p.naam });
        if (race.results[race.a] && race.results[race.b]) finishRace(race);
        break;
      }

      case 'quit': {                                   // race verlaten
        const race = races.get(p.raceId);
        if (race) { race.results[p.id] = { time: null }; finishRace(race); }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (p.pendingWith) endChallenge(p, 'weg');
    const race = races.get(p.raceId);
    if (race) {
      const o = players.get(p.opp);
      if (o) { send(o.ws, { t: 'oppLeft' }); o.status = 'lobby'; o.raceId = null; o.opp = null; }
      races.delete(race.id);
    }
    players.delete(p.id);
    pushLobby();
  });
});

// dode verbindingen opruimen
setInterval(() => {
  for (const p of players.values()) {
    if (!p.alive) { try { p.ws.terminate(); } catch (e) {} continue; }
    p.alive = false; try { p.ws.ping(); } catch (e) {}
  }
}, 30000);

server.listen(PORT, '0.0.0.0', () => console.log('Schaatssprint draait op http://0.0.0.0:' + PORT));
