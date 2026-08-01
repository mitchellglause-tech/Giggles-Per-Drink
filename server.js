const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { customAlphabet } = require('nanoid');

const roomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dataDir = process.env.DATA_DIR || __dirname;
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, 'gpd.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS profiles (
  name TEXT PRIMARY KEY,
  avatar TEXT NOT NULL,
  lifetime_points REAL NOT NULL DEFAULT 0,
  nights_played INTEGER NOT NULL DEFAULT 0,
  best_night REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  giggle_score REAL NOT NULL DEFAULT 0,
  drink_units REAL NOT NULL DEFAULT 0,
  shots INTEGER NOT NULL DEFAULT 0,
  beers INTEGER NOT NULL DEFAULT 0,
  wines INTEGER NOT NULL DEFAULT 0,
  cocktails INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE TABLE IF NOT EXISTS participants (
  room_code TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL,
  points REAL NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_code, name)
);

CREATE TABLE IF NOT EXISTS nights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  date INTEGER NOT NULL,
  gpd REAL NOT NULL,
  owner TEXT NOT NULL,
  mvp TEXT,
  giggle_score REAL NOT NULL,
  drink_units REAL NOT NULL
);
`);

// ---------- helpers ----------

const AVATARS = ['🦊','🐸','🦄','🐙','🦉','🐯','🐨','🦁','🐵','🐺','🐰','🐧','🦖','🐢','🦋','🐝','🦩','🐳','🦀','🐼'];

function avatarFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATARS[hash % AVATARS.length];
}

function getOrCreateProfile(name) {
  const clean = String(name || '').trim().slice(0, 24);
  if (!clean) return null;
  let profile = db.prepare('SELECT * FROM profiles WHERE name = ?').get(clean);
  if (!profile) {
    const avatar = avatarFor(clean);
    db.prepare('INSERT INTO profiles (name, avatar, lifetime_points, nights_played, best_night, created_at) VALUES (?,?,0,0,0,?)')
      .run(clean, avatar, Date.now());
    profile = db.prepare('SELECT * FROM profiles WHERE name = ?').get(clean);
  }
  return profile;
}

function roomState(code) {
  const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(code);
  if (!room) return null;
  const participants = db.prepare('SELECT name, avatar, points FROM participants WHERE room_code = ? ORDER BY points DESC').all(code);
  const gpd = room.drink_units > 0 ? room.giggle_score / room.drink_units : 0;
  const ageMs = Date.now() - room.created_at;
  const hours = Math.max(ageMs / 3600000, 1 / 60);
  const giggles_per_hour = room.giggle_score / hours;
  return {
    code: room.code,
    owner: room.owner,
    status: room.status,
    giggle_score: room.giggle_score,
    drink_units: room.drink_units,
    shots: room.shots,
    beers: room.beers,
    wines: room.wines,
    cocktails: room.cocktails,
    gpd: Math.round(gpd * 100) / 100,
    giggles_per_hour: Math.round(giggles_per_hour * 10) / 10,
    created_at: room.created_at,
    participants
  };
}

// ---------- profile ----------

app.post('/api/profile', (req, res) => {
  const profile = getOrCreateProfile(req.body.name);
  if (!profile) return res.status(400).json({ error: 'Name required' });
  res.json(profile);
});

// ---------- rooms ----------

app.post('/api/rooms', (req, res) => {
  const owner = String(req.body.owner || '').trim().slice(0, 24);
  if (!owner) return res.status(400).json({ error: 'Owner name required' });
  getOrCreateProfile(owner);

  let code;
  for (let i = 0; i < 8; i++) {
    const candidate = roomCode();
    const exists = db.prepare('SELECT 1 FROM rooms WHERE code = ?').get(candidate);
    if (!exists) { code = candidate; break; }
  }
  if (!code) return res.status(500).json({ error: 'Could not allocate room code' });

  db.prepare('INSERT INTO rooms (code, owner, status, created_at) VALUES (?,?,\'active\',?)')
    .run(code, owner, Date.now());

  res.json(roomState(code));
});

app.get('/api/rooms/:code', (req, res) => {
  const state = roomState(req.params.code.toUpperCase());
  if (!state) return res.status(404).json({ error: 'Room not found' });
  res.json(state);
});

app.post('/api/rooms/:code/join', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.status !== 'active') return res.status(400).json({ error: 'This tab has been closed out' });

  const name = String(req.body.name || '').trim().slice(0, 24);
  if (!name) return res.status(400).json({ error: 'Name required' });
  const profile = getOrCreateProfile(name);

  const existing = db.prepare('SELECT * FROM participants WHERE room_code = ? AND name = ?').get(code, name);
  if (!existing) {
    db.prepare('INSERT INTO participants (room_code, name, avatar, points, joined_at) VALUES (?,?,?,0,?)')
      .run(code, name, profile.avatar, Date.now());
  }
  res.json({ ...roomState(code), is_owner: room.owner === name });
});

app.post('/api/rooms/:code/drink', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.status !== 'active') return res.status(400).json({ error: 'This tab has been closed out' });
  if (req.body.name !== room.owner) return res.status(403).json({ error: 'Only the owner logs drinks' });

  const kinds = {
    beer: { units: 1, col: 'beers' },
    wine: { units: 1, col: 'wines' },
    shot: { units: 1, col: 'shots' },
    cocktail: { units: 1.5, col: 'cocktails' }
  };
  const kind = kinds[req.body.type];
  if (!kind) return res.status(400).json({ error: 'Unknown drink type' });

  db.prepare(`UPDATE rooms SET drink_units = drink_units + ?, ${kind.col} = ${kind.col} + 1 WHERE code = ?`)
    .run(kind.units, code);

  res.json(roomState(code));
});

app.post('/api/rooms/:code/giggle', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.status !== 'active') return res.status(400).json({ error: 'This tab has been closed out' });

  const tiers = { chuckle: 0.5, giggle: 1.0, cackle: 2.0, wheeze: 3.0, legendary: 5.0 };
  const points = tiers[req.body.tier];
  if (points === undefined) return res.status(400).json({ error: 'Unknown giggle tier' });

  const name = String(req.body.name || '').trim().slice(0, 24);
  const participant = db.prepare('SELECT * FROM participants WHERE room_code = ? AND name = ?').get(code, name);
  if (!participant) return res.status(400).json({ error: 'Join the tab before logging giggles' });

  db.prepare('UPDATE participants SET points = points + ? WHERE room_code = ? AND name = ?').run(points, code, name);
  db.prepare('UPDATE rooms SET giggle_score = giggle_score + ? WHERE code = ?').run(points, code);

  res.json(roomState(code));
});

app.post('/api/rooms/:code/close', (req, res) => {
  const code = req.params.code.toUpperCase();
  const room = db.prepare('SELECT * FROM rooms WHERE code = ?').get(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (req.body.name !== room.owner) return res.status(403).json({ error: 'Only the owner can close the tab' });
  if (room.status !== 'active') return res.json(roomState(code));

  const participants = db.prepare('SELECT * FROM participants WHERE room_code = ? ORDER BY points DESC').all(code);
  const mvp = participants.length ? participants[0].name : null;
  const gpd = room.drink_units > 0 ? room.giggle_score / room.drink_units : 0;

  db.prepare('UPDATE rooms SET status = \'closed\', closed_at = ? WHERE code = ?').run(Date.now(), code);
  db.prepare('INSERT INTO nights (room_code, date, gpd, owner, mvp, giggle_score, drink_units) VALUES (?,?,?,?,?,?,?)')
    .run(code, Date.now(), gpd, room.owner, mvp, room.giggle_score, room.drink_units);

  const bump = db.prepare('UPDATE profiles SET lifetime_points = lifetime_points + ?, nights_played = nights_played + 1, best_night = MAX(best_night, ?) WHERE name = ?');
  for (const p of participants) {
    getOrCreateProfile(p.name);
    bump.run(p.points, p.points, p.name);
  }
  // owner also gets a "night played" credit even with 0 giggle points logged themselves
  if (!participants.find(p => p.name === room.owner)) {
    getOrCreateProfile(room.owner);
    db.prepare('UPDATE profiles SET nights_played = nights_played + 1 WHERE name = ?').run(room.owner);
  }

  res.json(roomState(code));
});

// ---------- leaderboard ----------

app.get('/api/leaderboard/nights', (req, res) => {
  const rows = db.prepare('SELECT * FROM nights ORDER BY gpd DESC LIMIT 50').all();
  res.json(rows);
});

app.get('/api/leaderboard/friends', (req, res) => {
  const rows = db.prepare('SELECT * FROM profiles ORDER BY lifetime_points DESC LIMIT 50').all();
  res.json(rows);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`GPD listening on port ${PORT}`));
