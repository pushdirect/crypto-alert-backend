// ingest/binance.js
// Connects to Binance public market data WebSocket (no API key required)
// wss://data-stream.binance.vision is the free, no-auth endpoint

const WebSocket = require('ws');
const { ASSETS } = require('../config/assets');

const WS_BASE = 'wss://data-stream.binance.vision/stream';
const RECONNECT_BASE_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;
const RECONNECT_INTERVAL = 23 * 60 * 60 * 1000; // Binance closes at 24h

class BinanceIngest {
  constructor(engine) {
    this.engine = engine;
    this.ws = null;
    this.reconnectDelay = RECONNECT_BASE_DELAY;
    this.reconnectTimer = null;
    this.cycleTimer = null;
  }

  start() {
    console.log('[Binance] Starting WebSocket ingest...');
    this._connect();
  }

  _buildStreamUrl() {
    // Subscribe to 1h klines for all tracked assets
    // Also subscribe to 1m klines for BTC/ETH for faster signals
    const streams = [
      ...ASSETS.map(a => `${a.binanceSymbol}@kline_1h`),
      'btcusdt@kline_1m',
      'ethusdt@kline_1m',
      'solusdt@kline_1m',
    ].join('/');

    return `${WS_BASE}?streams=${streams}`;
  }

  _connect() {
    const url = this._buildStreamUrl();
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      console.log('[Binance] Connected');
      this.reconnectDelay = RECONNECT_BASE_DELAY;

      // Schedule proactive reconnect before 24h Binance timeout
      this.cycleTimer = setTimeout(() => {
        console.log('[Binance] Proactive reconnect (23h cycle)');
        this.ws.terminate();
      }, RECONNECT_INTERVAL);
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (!msg.stream || !msg.data) return;
        this._handleMessage(msg.stream, msg.data);
      } catch (e) {
        // ignore parse errors
      }
    });

    this.ws.on('ping', (data) => {
      // Binance requires pong response within 1 minute
      this.ws.pong(data);
    });

    this.ws.on('close', (code, reason) => {
      clearTimeout(this.cycleTimer);
      console.log(`[Binance] Disconnected (${code}). Reconnecting in ${this.reconnectDelay}ms`);
      this.reconnectTimer = setTimeout(() => this._connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_RECONNECT_DELAY);
    });

    this.ws.on('error', (err) => {
      console.error('[Binance] WS error:', err.message);
      this.ws.terminate();
    });
  }

  _handleMessage(stream, data) {
    // Only process closed (completed) candles
    if (stream.includes('@kline')) {
      const k = data.k;
      if (!k.x) return; // x = isClosed

      const asset = k.s.replace('USDT', '').toUpperCase();
      const interval = k.i;

      this.engine.processEvent({
        source: 'binance',
        type: interval === '1h' ? 'kline_1h' : 'kline_1m',
        asset,
        interval,
        open:   parseFloat(k.o),
        high:   parseFloat(k.h),
        low:    parseFloat(k.l),
        close:  parseFloat(k.c),
        volume: parseFloat(k.v),
        trades: k.n,
        ts:     k.T,
      });
    }
  }

  stop() {
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.cycleTimer);
    if (this.ws) this.ws.terminate();
  }
}

module.exports = BinanceIngest;
