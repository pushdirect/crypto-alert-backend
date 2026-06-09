// index.js — PushDirect crypto alert system entry point
// Free stack: Binance WebSocket + CoinGecko keyless API + in-memory state

const AlertEngine  = require('./engine/alertEngine');
const BinanceIngest = require('./ingest/binance');
const CoinGeckoIngest = require('./ingest/coingecko');
const SSEServer    = require('./server/sse');

const PORT = process.env.PORT || 3001;

console.log('='.repeat(50));
console.log(' PushDirect Crypto Alert System');
console.log(' Free tier: Binance WS + CoinGecko keyless');
console.log('='.repeat(50));

// 1. Alert engine (stateless event processor)
const engine = new AlertEngine();

// 2. Data ingest modules
const binance   = new BinanceIngest(engine);
const coingecko = new CoinGeckoIngest(engine);

// 3. SSE broadcast server
const server = new SSEServer(engine);

// Start everything
binance.start();
coingecko.start();
server.listen(PORT);

// Log connected clients periodically
setInterval(() => {
  console.log(`[Status] ${server.clients.size} SSE clients | ${engine.history.length} alerts in history`);
}, 5 * 60 * 1000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Shutdown] SIGTERM received');
  binance.stop();
  coingecko.stop();
  process.exit(0);
});
