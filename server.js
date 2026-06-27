const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Create the stats table if it doesn't exist
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

// POST update stats (merge/replace full stats object)
app.post('/api/stats', async (req, res) => {
  try {
    const stats = req.body; // { key: { ...statObject, displayName } }
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
