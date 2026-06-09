// engine/alertEngine.js
// Processes market events, applies rules, emits alerts

const { RULES, SEVERITY } = require('../config/assets');
const EventEmitter = require('events');

class AlertEngine extends EventEmitter {
  constructor() {
    super();
    // Per-asset state: rolling price/volume history
    this.state = {};
    // Cooldown tracking: Map<cooldownKey, expiresAt>
    this.cooldowns = new Map();
    // Alert history (in-memory, last 100)
    this.history = [];
  }

  // Called by ingest modules with normalised market events
  processEvent(event) {
    const { asset, type } = event;

    if (!this.state[asset]) {
      this.state[asset] = {
        prices: [],       // { price, ts }
        volumes: [],      // rolling 1h volumes
        baselineVol: null,
      };
    }

    const s = this.state[asset];

    if (type === 'kline_1h') {
      s.prices.push({ price: event.close, open: event.open, high: event.high, low: event.low, ts: event.ts });
      s.volumes.push(event.volume);
      if (s.prices.length > 168) s.prices.shift();  // 7 days
      if (s.volumes.length > 168) s.volumes.shift();
      if (s.volumes.length >= 24) {
        s.baselineVol = s.volumes.slice(-24).reduce((a, b) => a + b, 0) / 24;
      }

      this._checkPriceBreakout(asset, event, s);
      this._checkVolumeSpike(asset, event, s);
      this._checkVolatility(asset, event, s);
    }

    if (type === 'price_update') {
      // From CoinGecko — use for multi-timeframe % changes
      this._checkCoinGeckoSignals(asset, event);
    }

    if (type === 'trending') {
      this._fireAlert({
        type: 'trending',
        asset: event.coins.slice(0, 3).join(', '),
        severity: 'low',
        title: `Trending: ${event.coins.slice(0, 3).join(' · ')}`,
        body: `These coins are trending on CoinGecko right now — social volume spiking.`,
        data: { coins: event.coins },
        source: 'coingecko',
      });
    }
  }

  _checkPriceBreakout(asset, event, s) {
    const { open, close } = event;
    if (!open || !close) return;
    const pctChange = ((close - open) / open) * 100;
    const dir = pctChange > 0 ? '▲' : '▼';

    // Check rules from highest to lowest — fire only the most severe applicable
    const sorted = [...RULES.priceBreakout].sort((a, b) => b.pct - a.pct);
    for (const rule of sorted) {
      if (Math.abs(pctChange) >= rule.pct) {
        const ck = `${asset}:price:${rule.pct}`;
        if (this._onCooldown(ck)) return;
        this._setCooldown(ck, rule.cooldownMs);
        const price = close.toLocaleString('en-US', { maximumFractionDigits: 4 });
        this._fireAlert({
          type: 'price_breakout',
          asset,
          severity: rule.severity,
          title: `${asset} ${dir} ${Math.abs(pctChange).toFixed(1)}% in ${rule.window}`,
          body: `${asset} moved ${dir} ${Math.abs(pctChange).toFixed(1)}% to $${price} with confirmed volume on the ${rule.window} candle.`,
          data: { pctChange, price: close, open, window: rule.window },
          source: 'binance',
        });
        return;
      }
    }
  }

  _checkVolumeSpike(asset, event, s) {
    if (!s.baselineVol || s.baselineVol === 0) return;
    const multiplier = event.volume / s.baselineVol;

    const sorted = [...RULES.volumeSpike].sort((a, b) => b.multiplier - a.multiplier);
    for (const rule of sorted) {
      if (multiplier >= rule.multiplier) {
        const ck = `${asset}:volume:${rule.multiplier}`;
        if (this._onCooldown(ck)) return;
        this._setCooldown(ck, rule.cooldownMs);
        this._fireAlert({
          type: 'volume_spike',
          asset,
          severity: rule.severity,
          title: `${asset} volume ${multiplier.toFixed(1)}× average`,
          body: `${asset} trading volume is ${multiplier.toFixed(1)}× the 24h average — historically precedes significant price moves.`,
          data: { volume: event.volume, baseline: s.baselineVol, multiplier },
          source: 'binance',
        });
        return;
      }
    }
  }

  _checkVolatility(asset, event, s) {
    const { high, low, close } = event;
    if (!high || !low || !close) return;
    const rangePct = ((high - low) / close) * 100;

    const sorted = [...RULES.volatility.thresholds].sort((a, b) => b.pct - a.pct);
    for (const rule of sorted) {
      if (rangePct >= rule.pct) {
        const ck = `${asset}:volatility:${rule.pct}`;
        if (this._onCooldown(ck)) return;
        this._setCooldown(ck, rule.cooldownMs);
        this._fireAlert({
          type: 'volatility_spike',
          asset,
          severity: rule.severity,
          title: `${asset} volatility spike — ${rangePct.toFixed(1)}% candle range`,
          body: `${asset} high-low range hit ${rangePct.toFixed(1)}% on the last candle — unusually high volatility detected.`,
          data: { high, low, close, rangePct },
          source: 'binance',
        });
        return;
      }
    }
  }

  _checkCoinGeckoSignals(asset, event) {
    // Multi-timeframe signals from CoinGecko REST data
    const { change_1h, change_24h } = event;

    // 1h move check (CoinGecko data, not Binance kline)
    if (change_1h !== undefined && change_1h !== null) {
      if (Math.abs(change_1h) >= 5) {
        const ck = `${asset}:cg_1h:5`;
        if (!this._onCooldown(ck)) {
          this._setCooldown(ck, 60 * 60 * 1000);
          const dir = change_1h > 0 ? '▲' : '▼';
          this._fireAlert({
            type: 'price_breakout',
            asset,
            severity: Math.abs(change_1h) >= 10 ? 'high' : 'medium',
            title: `${asset} ${dir} ${Math.abs(change_1h).toFixed(1)}% in 1h`,
            body: `${asset} is ${dir === '▲' ? 'up' : 'down'} ${Math.abs(change_1h).toFixed(1)}% in the last hour. Current price: $${event.price_usd?.toLocaleString('en-US', { maximumFractionDigits: 4 })}.`,
            data: { change_1h, price: event.price_usd },
            source: 'coingecko',
          });
        }
      }
    }
  }

  _fireAlert(alert) {
    const enriched = {
      ...alert,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ts: new Date().toISOString(),
      severity_config: SEVERITY[alert.severity],
    };
    this.history.unshift(enriched);
    if (this.history.length > 100) this.history.pop();
    this.emit('alert', enriched);
    console.log(`[Alert] ${enriched.severity.toUpperCase().padEnd(8)} ${enriched.title}`);
  }

  _onCooldown(key) {
    return this.cooldowns.has(key) && Date.now() < this.cooldowns.get(key);
  }

  _setCooldown(key, durationMs) {
    this.cooldowns.set(key, Date.now() + durationMs);
  }

  getHistory(limit = 50) {
    return this.history.slice(0, limit);
  }
}

module.exports = AlertEngine;
