/**
 * Schaatssprint — lobbyserver
 * Node 18+, enige dependency: ws
 *
 *   npm install
 *   node server.js
 *
 * Serveert /public, boarding-ads admin, en WebSocket-lobby.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const PUB  = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const ADS_FILE = path.join(DATA, 'ads.json');
const ADS_DIR = path.join(PUB, 'ads');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'schaatsadmin';
const COUNTDOWN_MS = 10000;
const CHALLENGE_TTL = 25000;
const MAX_UPLOAD = 3.5 * 1024 * 1024; // ~3.5MB

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp',
  '.gif':'image/gif', '.svg':'image/svg+xml', '.ico':'image/x-icon',
  '.webmanifest':'application/manifest+json'
};

const DEFAULT_ADS = [
  { t: "McDonald's", bg: '#d62300', fg: '#ffc72c' },
  { t: 'Ziggo', bg: '#f36f21', fg: '#ffffff' },
  { t: 'KPN', bg: '#0aa14b', fg: '#ffffff' },
  { t: 'DE FUUT', bg: '#0b3d5c', fg: '#ffd166' },
  { t: 'MENUKIEZEN.NL', bg: '#101820', fg: '#4fd0ff' },
  { t: 'VEENENDAAL', bg: '#f2f2f2', fg: '#c8102e' }
];

const EXT_FROM_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

function ensureDirs() {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(ADS_DIR)) fs.mkdirSync(ADS_DIR, { recursive: true });
  if (!fs.existsSync(ADS_FILE)) {
    fs.writeFileSync(ADS_FILE, JSON.stringify(DEFAULT_ADS, null, 2));
  }
}

function normalizeAd(a) {
  if (!a || typeof a !== 'object') return null;
  const t = String(a.t || '').trim().slice(0, 32);
  const img = typeof a.img === 'string' && a.img.startsWith('/ads/')
    ? a.img.replace(/[^a-zA-Z0-9/._-]/g, '').slice(0, 120)
    : '';
  if (!t && !img) return null;
  return {
    t: t || 'SPONSOR',
    bg: /^#[0-9a-fA-F]{3,8}$/.test(a.bg) ? a.bg : '#101820',
    fg: /^#[0-9a-fA-F]{3,8}$/.test(a.fg) ? a.fg : '#ffffff',
    ...(img ? { img } : {})
  };
}

function readAds() {
  ensureDirs();
  try {
    const raw = JSON.parse(fs.readFileSync(ADS_FILE, 'utf8'));
    if (!Array.isArray(raw)) return DEFAULT_ADS.slice();
    return raw.map(normalizeAd).filter(Boolean);
  } catch (e) {
    return DEFAULT_ADS.slice();
  }
}

function writeAds(ads) {
  ensureDirs();
  fs.writeFileSync(ADS_FILE, JSON.stringify(ads, null, 2));
}

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(obj));
}

function readBody(req, max = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > max) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function checkAdmin(req) {
  const h = req.headers['x-admin-password'] || '';
  const auth = req.headers.authorization || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  return h === ADMIN_PASSWORD || bearer === ADMIN_PASSWORD;
}

function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Niet gevonden'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  let p = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password, Authorization'
    });
    return res.end();
  }

  if (p === '/api/ads' && req.method === 'GET') {
    return json(res, 200, { ads: readAds() });
  }

  if (p === '/api/ads' && req.method === 'PUT') {
    if (!checkAdmin(req)) return json(res, 401, { error: 'Onjuist wachtwoord' });
    try {
      const body = JSON.parse(await readBody(req, 1e6));
      const list = Array.isArray(body.ads) ? body.ads : (Array.isArray(body) ? body : null);
      if (!list) return json(res, 400, { error: 'Verwacht { ads: [...] }' });
      if (list.length < 1) return json(res, 400, { error: 'Minimaal 1 boarding-ad' });
      if (list.length > 24) return json(res, 400, { error: 'Maximaal 24 ads' });
      const ads = list.map(normalizeAd).filter(Boolean);
      if (!ads.length) return json(res, 400, { error: 'Geen geldige ads' });
      writeAds(ads);
      return json(res, 200, { ok: true, ads });
    } catch (e) {
      return json(res, 400, { error: 'Ongeldige JSON' });
    }
  }

  if (p === '/api/ads/upload' && req.method === 'POST') {
    if (!checkAdmin(req)) return json(res, 401, { error: 'Onjuist wachtwoord' });
    try {
      ensureDirs();
      const body = JSON.parse(await readBody(req));
      const dataUrl = String(body.data || '');
      const m = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
      if (!m) return json(res, 400, { error: 'Alleen PNG, JPG, WebP of GIF (als data-URL)' });
      const mime = m[1].toLowerCase().replace('image/jpg', 'image/jpeg');
      const ext = EXT_FROM_MIME[mime];
      if (!ext) return json(res, 400, { error: 'Onbekend image-type' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length < 32) return json(res, 400, { error: 'Bestand te klein' });
      if (buf.length > MAX_UPLOAD) return json(res, 400, { error: 'Max 3 MB per afbeelding' });
      const name = 'ad-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex') + ext;
      const file = path.join(ADS_DIR, name);
      fs.writeFileSync(file, buf);
      return json(res, 200, { ok: true, img: '/ads/' + name });
    } catch (e) {
      return json(res, 400, { error: e.message === 'body too large' ? 'Bestand te groot (max 3 MB)' : 'Upload mislukt' });
    }
  }

  if (p === '/api/admin/login' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req, 1e5));
      if (body.password === ADMIN_PASSWORD) return json(res, 200, { ok: true });
      return json(res, 401, { error: 'Onjuist wachtwoord' });
    } catch (e) {
      return json(res, 400, { error: 'Ongeldige JSON' });
    }
  }

  if (p === '/admin' || p === '/admin/') p = '/admin.html';
  if (p === '/') p = '/index.html';

  const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(PUB, safe);
  if (!file.startsWith(PUB)) { res.writeHead(403); return res.end('nope'); }
  serveFile(res, file);
});

const wss = new WebSocketServer({ server });

/** @type {Map<string, Player>} */
const players = new Map();
const races   = new Map();
/** @type {Map<string, {hostId:string, guestId:string|null, timer:any}>} */
const invites = new Map();
let seq = 0;
const uid = () => (++seq).toString(36) + Math.random().toString(36).slice(2, 7);
const inviteCode = () => Math.random().toString(36).slice(2, 8);

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

function clearInviteFor(playerId) {
  for (const [code, inv] of invites) {
    if (inv.hostId === playerId || inv.guestId === playerId) {
      if (inv.timer) clearTimeout(inv.timer);
      invites.delete(code);
      const host = players.get(inv.hostId);
      const guest = inv.guestId ? players.get(inv.guestId) : null;
      if (host && host.inviteCode === code) host.inviteCode = null;
      if (guest && guest.inviteCode === code) guest.inviteCode = null;
    }
  }
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
  clearInviteFor(a.id);
  clearInviteFor(b.id);
  const id = uid();
  const startAt = Date.now() + COUNTDOWN_MS;
  const race = { id, a: a.id, b: b.id, startAt, results: {} };
  races.set(id, race);
  a.status = b.status = 'race';
  a.raceId = b.raceId = id;
  a.opp = b.id; b.opp = a.id;
  a.pendingWith = b.pendingWith = null;
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
              raceId: null, opp: null, alive: true, inviteCode: null };
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

      case 'profile':
        if (m.suit) p.suit = m.suit;
        if (m.g) p.g = m.g === 'v' ? 'v' : 'm';
        if (typeof m.best === 'number') p.best = m.best;
        pushLobby();
        break;

      case 'inviteCreate': {
        if (!p.naam) return send(ws, { t: 'inviteError', msg: 'Vul eerst je naam in.' });
        if (p.status !== 'lobby') return send(ws, { t: 'inviteError', msg: 'Je bent nu niet vrij.' });
        clearInviteFor(p.id);
        const code = inviteCode();
        const inv = {
          hostId: p.id,
          guestId: null,
          timer: setTimeout(() => {
            invites.delete(code);
            if (p.inviteCode === code) {
              p.inviteCode = null;
              send(p.ws, { t: 'inviteError', msg: 'Deel-link verlopen.' });
            }
          }, 10 * 60 * 1000)
        };
        invites.set(code, inv);
        p.inviteCode = code;
        send(ws, { t: 'inviteCreated', code });
        break;
      }

      case 'inviteCancel': {
        clearInviteFor(p.id);
        break;
      }

      case 'inviteJoin': {
        const code = String(m.code || '').slice(0, 16);
        const inv = invites.get(code);
        if (!inv) return send(ws, { t: 'inviteError', msg: 'Deze uitnodiging bestaat niet (meer).' });
        const host = players.get(inv.hostId);
        if (!host) {
          invites.delete(code);
          return send(ws, { t: 'inviteError', msg: 'De host is offline.' });
        }
        if (host.id === p.id) return send(ws, { t: 'inviteError', msg: 'Je kunt je eigen link niet openen.' });
        if (!p.naam) return send(ws, { t: 'inviteError', msg: 'Vul eerst je naam in.' });
        if (p.status !== 'lobby' || host.status !== 'lobby') {
          return send(ws, { t: 'inviteError', msg: 'Iemand is nu niet vrij voor een race.' });
        }
        if (inv.guestId && inv.guestId !== p.id) {
          return send(ws, { t: 'inviteError', msg: 'Dit potje is al vol.' });
        }
        inv.guestId = p.id;
        p.inviteCode = code;
        host.inviteCode = code;
        send(ws, { t: 'inviteWaiting', hostNaam: host.naam });
        send(host.ws, { t: 'info', msg: p.naam + ' heeft je link geopend — race start!' });
        startRace(host, p);
        break;
      }

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
        clearInviteFor(p.id);
        break;

      case 'pos': {
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

      case 'quit': {
        const race = races.get(p.raceId);
        if (race) { race.results[p.id] = { time: null }; finishRace(race); }
        break;
      }
    }
  });

  ws.on('close', () => {
    clearInviteFor(p.id);
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

setInterval(() => {
  for (const p of players.values()) {
    if (!p.alive) { try { p.ws.terminate(); } catch (e) {} continue; }
    p.alive = false; try { p.ws.ping(); } catch (e) {}
  }
}, 30000);

ensureDirs();
server.listen(PORT, '0.0.0.0', () => console.log('Schaatssprint draait op http://0.0.0.0:' + PORT));
