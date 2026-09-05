const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const { createDatabase, seedDatabase, dbRun, dbGet, dbAll, saveDb } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'golf-matcher-dev-secret-change-in-production';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Server Factory ───────────────────────────────────────────────────────────

async function startServer() {
  const db = await createDatabase();
  seedDatabase(db);

  // ─── Auth Routes ────────────────────────────────────────────────────────────

  app.post('/api/auth/register', (req, res) => {
    const { email, password, name, city, state, handicap } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    try {
      const hash = bcrypt.hashSync(password, 10);
      const result = dbRun(db,
        `INSERT INTO users (email, password_hash, name, city, state, handicap) VALUES (?, ?, ?, ?, ?, ?)`,
        [email.toLowerCase().trim(), hash, name.trim(), city || '', (state || '').toUpperCase(), handicap || 0]
      );
      saveDb(db);
      const token = jwt.sign({ id: result.lastInsertRowid, email }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user: { id: result.lastInsertRowid, email, name } });
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Email is already registered' });
      }
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    const user = dbGet(db, 'SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  });

  // ─── Profile Routes ──────────────────────────────────────────────────────────

  app.get('/api/me', requireAuth, (req, res) => {
    const user = dbGet(db,
      `SELECT id, email, name, handicap, city, state, zip_code, bio, playing_frequency, skill_level FROM users WHERE id = ?`,
      [req.user.id]
    );
    const courses = dbAll(db, 'SELECT id, course_name, city FROM preferred_courses WHERE user_id = ?', [req.user.id]);
    res.json({ ...user, preferred_courses: courses });
  });

  app.put('/api/me', requireAuth, (req, res) => {
    const { name, handicap, city, state, zip_code, bio, playing_frequency, skill_level, preferred_courses } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    dbRun(db,
      `UPDATE users SET name=?, handicap=?, city=?, state=?, zip_code=?, bio=?, playing_frequency=?, skill_level=? WHERE id=?`,
      [name.trim(), handicap || 0, city || '', (state || '').toUpperCase(), zip_code || '', bio || '', playing_frequency || 'weekly', skill_level || 'intermediate', req.user.id]
    );

    if (Array.isArray(preferred_courses)) {
      dbRun(db, 'DELETE FROM preferred_courses WHERE user_id = ?', [req.user.id]);
      for (const c of preferred_courses) {
        if (c && c.name && c.name.trim()) {
          dbRun(db, 'INSERT OR IGNORE INTO preferred_courses (user_id, course_name, city) VALUES (?, ?, ?)',
            [req.user.id, c.name.trim(), c.city || '']);
        }
      }
    }

    saveDb(db);
    res.json({ success: true });
  });

  // ─── Player Discovery ─────────────────────────────────────────────────────────

  app.get('/api/players', requireAuth, (req, res) => {
    const { city, state, min_handicap, max_handicap, playing_frequency } = req.query;

    let query = `
      SELECT u.id, u.name, u.handicap, u.city, u.state, u.bio, u.playing_frequency, u.skill_level,
        GROUP_CONCAT(pc.course_name, '||') as courses
      FROM users u
      LEFT JOIN preferred_courses pc ON u.id = pc.user_id
      WHERE u.id != ?
    `;
    const params = [req.user.id];

    if (city) { query += ' AND LOWER(u.city) LIKE ?'; params.push(`%${city.toLowerCase()}%`); }
    if (state) { query += ' AND LOWER(u.state) LIKE ?'; params.push(`%${state.toLowerCase()}%`); }
    if (min_handicap !== undefined && min_handicap !== '') { query += ' AND u.handicap >= ?'; params.push(parseFloat(min_handicap)); }
    if (max_handicap !== undefined && max_handicap !== '') { query += ' AND u.handicap <= ?'; params.push(parseFloat(max_handicap)); }
    if (playing_frequency) { query += ' AND u.playing_frequency = ?'; params.push(playing_frequency); }

    query += ' GROUP BY u.id ORDER BY u.name ASC';

    const players = dbAll(db, query, params).map(p => ({
      ...p,
      preferred_courses: p.courses ? p.courses.split('||').map(name => ({ name })) : []
    }));

    res.json(players);
  });

  app.get('/api/players/:id', requireAuth, (req, res) => {
    const player = dbGet(db,
      `SELECT id, name, handicap, city, state, bio, playing_frequency, skill_level FROM users WHERE id = ?`,
      [req.params.id]
    );
    if (!player) return res.status(404).json({ error: 'Player not found' });
    const courses = dbAll(db, 'SELECT id, course_name, city FROM preferred_courses WHERE user_id = ?', [req.params.id]);
    res.json({ ...player, preferred_courses: courses });
  });

  // ─── Connection Routes ────────────────────────────────────────────────────────

  app.post('/api/connections', requireAuth, (req, res) => {
    const { receiver_id, message } = req.body;
    if (!receiver_id) return res.status(400).json({ error: 'receiver_id is required' });
    if (Number(receiver_id) === req.user.id) return res.status(400).json({ error: 'Cannot connect with yourself' });
    try {
      const result = dbRun(db,
        'INSERT INTO connections (requester_id, receiver_id, message) VALUES (?, ?, ?)',
        [req.user.id, receiver_id, message || '']
      );
      saveDb(db);
      res.json({ id: result.lastInsertRowid, status: 'pending' });
    } catch {
      res.status(400).json({ error: 'Connection request already sent to this player' });
    }
  });

  app.get('/api/connections', requireAuth, (req, res) => {
    const sent = dbAll(db,
      `SELECT c.*, u.name as receiver_name, u.handicap as receiver_handicap, u.city as receiver_city
       FROM connections c JOIN users u ON c.receiver_id = u.id
       WHERE c.requester_id = ? ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    const received = dbAll(db,
      `SELECT c.*, u.name as requester_name, u.handicap as requester_handicap, u.city as requester_city
       FROM connections c JOIN users u ON c.requester_id = u.id
       WHERE c.receiver_id = ? ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    res.json({ sent, received });
  });

  app.put('/api/connections/:id', requireAuth, (req, res) => {
    const { status } = req.body;
    if (!['accepted', 'declined'].includes(status)) return res.status(400).json({ error: 'Status must be accepted or declined' });
    const result = dbRun(db,
      'UPDATE connections SET status = ? WHERE id = ? AND receiver_id = ?',
      [status, req.params.id, req.user.id]
    );
    if (!result.changes) return res.status(404).json({ error: 'Connection not found' });
    saveDb(db);
    res.json({ success: true });
  });

  // ─── Frontend Fallback ────────────────────────────────────────────────────────

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`\n⛳ GolfMatch running at http://localhost:${PORT}\n`);
  });
}

startServer().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
