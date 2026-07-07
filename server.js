const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_stats (
      player_key TEXT PRIMARY KEY,
      display_name TEXT,
      data JSONB
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

// POST update stats (merge intelligent)
app.post('/api/stats', async (req, res) => {
  try {
    const stats = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const key of Object.keys(stats)) {
        const s = stats[key];
        const { displayName, ...incoming } = s;
        const existing = await client.query(
          'SELECT data FROM player_stats WHERE player_key = $1',
          [key]
        );
        let merged;
        if (existing.rows.length === 0) {
          merged = incoming;
        } else {
          const old = existing.rows[0].data;
          merged = {
            wins:            (old.wins            || 0) + (incoming.wins            || 0),
            games:           (old.games           || 0) + (incoming.games           || 0),
            poopTotal:       (old.poopTotal        || 0) + (incoming.poopTotal       || 0),
            poopLastGame:    incoming.poopLastGame  || 0,
            xTotal:          (old.xTotal           || 0) + (incoming.xTotal          || 0),
            xLastGame:       incoming.xLastGame     || 0,
            fTotal:          (old.fTotal           || 0) + (incoming.fTotal          || 0),
            fLastGame:       incoming.fLastGame     || 0,
            oTotal:          (old.oTotal           || 0) + (incoming.oTotal          || 0),
            oLastGame:       incoming.oLastGame     || 0,
            causedPenalties: (old.causedPenalties  || 0) + (incoming.causedPenalties || 0),
            perfectWins:     (old.perfectWins      || 0) + (incoming.perfectWins     || 0),
            bestTurn:        Math.max(old.bestTurn || 0, incoming.bestTurn || 0),
          };
        }
        await client.query(
          `INSERT INTO player_stats (player_key, display_name, data)
           VALUES ($1, $2, $3)
           ON CONFLICT (player_key) DO UPDATE SET display_name = $2, data = $3`,
          [key, displayName || key, JSON.stringify(merged)]
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Jeu 10000 tourne sur le port ${PORT}`);
});
