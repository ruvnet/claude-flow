const express = require('express');
const { getSystemInfo, calculateMetrics } = require('./utils');
const ApiService = require('./services/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Initialize API service
const apiService = new ApiService();

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Swarm Test Project',
    version: '1.0.0',
    created: 'By GitHub Branch Project Swarm',
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    system: getSystemInfo(),
  });
});

app.get('/metrics', async (req, res) => {
  const metrics = await calculateMetrics();
  res.json(metrics);
});

app.get('/api/data', async (req, res) => {
  try {
    const data = await apiService.fetchData();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

module.exports = app;
