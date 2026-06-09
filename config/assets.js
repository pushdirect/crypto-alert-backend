// config/assets.js
// All assets tracked and alert thresholds

const ASSETS = [
  { symbol: 'BTC',  binanceSymbol: 'btcusdt',  coingekoId: 'bitcoin',  name: 'Bitcoin' },
  { symbol: 'ETH',  binanceSymbol: 'ethusdt',  coingekoId: 'ethereum', name: 'Ethereum' },
  { symbol: 'SOL',  binanceSymbol: 'solusdt',  coingekoId: 'solana',   name: 'Solana' },
  { symbol: 'BNB',  binanceSymbol: 'bnbusdt',  coingekoId: 'binancecoin', name: 'BNB' },
  { symbol: 'XRP',  binanceSymbol: 'xrpusdt',  coingekoId: 'ripple',   name: 'XRP' },
  { symbol: 'ADA',  binanceSymbol: 'adausdt',  coingekoId: 'cardano',  name: 'Cardano' },
  { symbol: 'AVAX', binanceSymbol: 'avaxusdt', coingekoId: 'avalanche-2', name: 'Avalanche' },
  { symbol: 'DOGE', binanceSymbol: 'dogeusdt', coingekoId: 'dogecoin', name: 'Dogecoin' },
  { symbol: 'LINK', binanceSymbol: 'linkusdt', coingekoId: 'chainlink', name: 'Chainlink' },
  { symbol: 'DOT',  binanceSymbol: 'dotusdt',  coingekoId: 'polkadot', name: 'Polkadot' },
];

const COINGECKO_IDS = ASSETS.map(a => a.coingekoId).join(',');

// Alert rules
const RULES = {
  priceBreakout: [
    { pct: 3,  window: '1h',  severity: 'medium', cooldownMs: 30 * 60 * 1000 },
    { pct: 5,  window: '1h',  severity: 'high',   cooldownMs: 60 * 60 * 1000 },
    { pct: 8,  window: '4h',  severity: 'high',   cooldownMs: 2 * 60 * 60 * 1000 },
    { pct: 12, window: '24h', severity: 'critical', cooldownMs: 4 * 60 * 60 * 1000 },
  ],
  volumeSpike: [
    { multiplier: 2,  severity: 'low',    cooldownMs: 60 * 60 * 1000 },
    { multiplier: 3,  severity: 'medium', cooldownMs: 60 * 60 * 1000 },
    { multiplier: 5,  severity: 'high',   cooldownMs: 2 * 60 * 60 * 1000 },
    { multiplier: 10, severity: 'critical', cooldownMs: 4 * 60 * 60 * 1000 },
  ],
  volatility: {
    // ATR-based: fire when candle range > X% of price
    thresholds: [
      { pct: 2,  severity: 'low',    cooldownMs: 30 * 60 * 1000 },
      { pct: 4,  severity: 'medium', cooldownMs: 60 * 60 * 1000 },
      { pct: 7,  severity: 'high',   cooldownMs: 2 * 60 * 60 * 1000 },
    ],
  },
};

// Severity config for UI
const SEVERITY = {
  low:      { color: '#9a8f7e', emoji: '📊', label: 'Signal' },
  medium:   { color: '#c9aa82', emoji: '⚡', label: 'Alert' },
  high:     { color: '#f97316', emoji: '🔥', label: 'Strong' },
  critical: { color: '#e07b6a', emoji: '🚨', label: 'Critical' },
};

module.exports = { ASSETS, COINGECKO_IDS, RULES, SEVERITY };
