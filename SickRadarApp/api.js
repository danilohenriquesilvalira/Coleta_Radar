// api.js - Simple Express server to expose Redis data
const express = require('express');
const redis = require('redis');
const { promisify } = require('util');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Redis Configuration - Match your backend settings
const REDIS_CONFIG = {
  host: 'localhost',
  port: 6379,
  password: '',
  prefix: 'radar_sick'
};

// Connect to Redis
const client = redis.createClient({
  host: REDIS_CONFIG.host,
  port: REDIS_CONFIG.port,
  password: REDIS_CONFIG.password
});

// Promisify Redis commands
const getAsync = promisify(client.get).bind(client);
const zrangeAsync = promisify(client.zrange).bind(client);
const zrevrangeAsync = promisify(client.zrevrange).bind(client);

// Error handling for Redis
client.on('error', (err) => {
  console.error('Redis error:', err);
});

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Get latest radar status
app.get('/api/status', async (req, res) => {
  try {
    const status = await getAsync(`${REDIS_CONFIG.prefix}:status`);
    const timestamp = await getAsync(`${REDIS_CONFIG.prefix}:timestamp`);
    res.json({ status, timestamp });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get current velocity and position data
app.get('/api/current', async (req, res) => {
  try {
    const data = {
      positions: [],
      velocities: [],
      timestamp: await getAsync(`${REDIS_CONFIG.prefix}:timestamp`)
    };

    // Get positions
    for (let i = 1; i <= 7; i++) {
      const pos = await getAsync(`${REDIS_CONFIG.prefix}:pos${i}`);
      data.positions.push(parseFloat(pos));
    }

    // Get velocities
    for (let i = 1; i <= 7; i++) {
      const vel = await getAsync(`${REDIS_CONFIG.prefix}:vel${i}`);
      data.velocities.push(parseFloat(vel));
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get recent velocity changes
app.get('/api/velocity-changes', async (req, res) => {
  try {
    const keys = await zrevrangeAsync(`${REDIS_CONFIG.prefix}:velocity_changes`, 0, 49);
    const changes = [];
    
    for (const key of keys) {
      const change = await getAsync(key);
      if (change) {
        changes.push(JSON.parse(change));
      }
    }
    
    res.json(changes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get velocity history for a specific velocity
app.get('/api/velocity-history/:index', async (req, res) => {
  try {
    const { index } = req.params;
    if (index < 1 || index > 7) {
      return res.status(400).json({ error: 'Invalid velocity index. Must be between 1 and 7.' });
    }
    
    const historyData = await zrangeAsync(`${REDIS_CONFIG.prefix}:vel${index}:history`, 0, -1, 'WITHSCORES');
    const history = [];
    
    // Convert the flat array to pairs of [value, timestamp]
    for (let i = 0; i < historyData.length; i += 2) {
      history.push({
        value: parseFloat(historyData[i]),
        timestamp: parseInt(historyData[i+1])
      });
    }
    
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get latest update
app.get('/api/latest-update', async (req, res) => {
  try {
    const latestUpdate = await getAsync(`${REDIS_CONFIG.prefix}:latest_update`);
    res.json(JSON.parse(latestUpdate || '{}'));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`API server listening on port ${PORT}`);
});