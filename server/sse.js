// server/sse.js
// SSE server — streams alerts to browser clients
// Each connected client gets new alerts in real time via EventSource

const express = require('express');
const cors = require('cors');

class SSEServer {
  constructor(engine) {
    this.engine = engine;
    this.clients = new Set();
    this.app = express();
    this._setup();
  }

  _setup() {
    const app = this.app;

    // Allow requests from pushdirect.network and localhost for dev
    app.use(cors({
      origin: [
        'https://pushdirect.network',
        'https://www.pushdirect.network',
        'http://localhost:3000',
        'http://127.0.0.1:5500',
      ],
      methods: ['GET'],
    }));

    // Health check — used by Railway/Render/Fly.io
    app.get('/health', (req, res) => res.json({ ok: true, clients: this.clients.size }));

    // Current prices / latest state endpoint
    app.get('/api/state', (req, res) => {
      const state = {};
      for (const [asset, data] of Object.entries(this.engine.state)) {
        const latest = data.prices[data.prices.length - 1];
        state[asset] = {
          price: latest?.price,
          baselineVol: data.baselineVol,
          priceHistory: data.prices.slice(-24).map(p => p.price), // last 24h
        };
      }
      res.json(state);
    });

    // Alert history endpoint
    app.get('/api/alerts', (req, res) => {
      const limit = Math.min(parseInt(req.query.limit) || 50, 100);
      const asset = req.query.asset;
      let alerts = this.engine.getHistory(100);
      if (asset) alerts = alerts.filter(a => a.asset === asset || a.asset.includes(asset));
      res.json(alerts.slice(0, limit));
    });

    // SSE stream endpoint
    app.get('/stream', (req, res) => {
      // Required SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering
      res.flushHeaders();

      // Send last 20 alerts immediately so client has something to show
      const history = this.engine.getHistory(20);
      if (history.length > 0) {
        res.write(`event: history\ndata: ${JSON.stringify(history)}\n\n`);
      }

      // Send current state
      const state = {};
      for (const [asset, data] of Object.entries(this.engine.state)) {
        const latest = data.prices[data.prices.length - 1];
        if (latest) state[asset] = { price: latest.price };
      }
      if (Object.keys(state).length > 0) {
        res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
      }

      // Heartbeat every 25s — keeps connection alive through Cloudflare / proxies
      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 25000);

      // Register client
      this.clients.add(res);

      req.on('close', () => {
        clearInterval(heartbeat);
        this.clients.delete(res);
      });
    });

    // Wire alert engine → broadcast to all clients
    this.engine.on('alert', (alert) => {
      const payload = `event: alert\ndata: ${JSON.stringify(alert)}\n\n`;
      for (const client of this.clients) {
        try {
          client.write(payload);
        } catch (e) {
          this.clients.delete(client);
        }
      }
    });
  }

  listen(port = 3001) {
    this.app.listen(port, () => {
      console.log(`[SSE] Server listening on port ${port}`);
      console.log(`[SSE] Stream endpoint: http://localhost:${port}/stream`);
    });
  }
}

module.exports = SSEServer;
