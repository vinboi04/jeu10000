const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const SESSION_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 heures

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_stats (
      player_key TEXT PRIMARY KEY,
      display_name TEXT,
      data JSONB
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS session_data (
      player_key TEXT PRIMARY KEY,
      f_count INTEGER DEFAULT 0,
      o_count INTEGER DEFAULT 0,
      last_game TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('DB ready');
}
initDb().catch(err => console.error('DB init error:', err));

app.use(express.json());
app.use(express.static(path.join(__dirname, '.')));

// GET all stats
app.get('/api/stats', async (req, res) => {
  try {
    const result = await pool.query('SELECT player_key, display_name, data FROM player_stats');
    const stats = {};
    result.rows.forEach(row => {
      stats[row.player_key] = { ...row.data, displayName: row.display_name };
    });
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST stats — le client envoie les totaux corrects, le serveur remplace
app.post('/api/stats', async (req, res) => {
  try {
    const stats = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const key of Object.keys(stats)) {
        const s = stats[key];
        const { displayName, ...data } = s;
        await client.query(
          `INSERT INTO player_stats (player_key, display_name, data)
           VALUES ($1, $2, $3)
           ON CONFLICT (player_key) DO UPDATE SET display_name = $2, data = $3`,
          [key, displayName || key, JSON.stringify(data)]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE one player
app.delete('/api/stats/:key', async (req, res) => {
  try {
    await pool.query('DELETE FROM player_stats WHERE player_key = $1', [req.params.key]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE all stats
app.delete('/api/stats', async (req, res) => {
  try {
    await pool.query('DELETE FROM player_stats');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET session data (F et O partagés + auto-reset après 4h)
app.get('/api/session', async (req, res) => {
  try {
    const result = await pool.query('SELECT player_key, f_count, o_count, last_game FROM session_data');
    const session = {};
    const now = Date.now();
    result.rows.forEach(row => {
      const lastGame = new Date(row.last_game).getTime();
      // Auto-reset si plus de 4h sans partie
      if (now - lastGame > SESSION_TIMEOUT_MS) {
        session[row.player_key] = { fCount: 0, oCount: 0 };
      } else {
        session[row.player_key] = { fCount: row.f_count, oCount: row.o_count };
      }
    });
    res.json(session);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST session data (mettre à jour F et O après une partie)
app.post('/api/session', async (req, res) => {
  try {
    const session = req.body; // { playerKey: { fCount, oCount } }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const key of Object.keys(session)) {
        const { fCount, oCount } = session[key];
        await client.query(
          `INSERT INTO session_data (player_key, f_count, o_count, last_game)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (player_key) DO UPDATE SET f_count = $2, o_count = $3, last_game = NOW()`,
          [key, fCount || 0, oCount || 0]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE session (fin de session manuelle)
app.delete('/api/session', async (req, res) => {
  try {
    await pool.query('DELETE FROM session_data');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Jeu 10000 tourne sur le port ${PORT}`);
});
