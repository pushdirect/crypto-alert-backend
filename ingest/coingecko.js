// ingest/coingecko.js
// Uses CoinGecko keyless public API — no key required
// Rate: 5-15 calls/min shared pool. We poll every 2 minutes to stay safe.
// Gets: multi-timeframe % changes, trending coins, market data

const { COINGECKO_IDS, ASSETS } = require('../config/assets');

const BASE_URL = 'https://api.coingecko.com/api/v3';
const PRICE_POLL_INTERVAL  = 2 * 60 * 1000;  // 2 minutes
const TREND_POLL_INTERVAL  = 10 * 60 * 1000; // 10 minutes

// Map coingecko id → symbol
const ID_TO_SYMBOL = {};
for (const a of ASSETS) ID_TO_SYMBOL[a.coingekoId] = a.symbol;

class CoinGeckoIngest {
  constructor(engine) {
    this.engine = engine;
    this.priceTimer = null;
    this.trendTimer = null;
  }

  start() {
    console.log('[CoinGecko] Starting poller...');
    // Stagger the first call so we don't hit rate limits on startup
    setTimeout(() => this._pollPrices(), 5000);
    setTimeout(() => this._pollTrending(), 15000);
  }

  async _pollPrices() {
    try {
      const url = `${BASE_URL}/simple/price`
        + `?ids=${COINGECKO_IDS}`
        + `&vs_currencies=usd`
        + `&include_24hr_change=true`
        + `&include_1hr_change=true`
        + `&include_24hr_vol=true`
        + `&include_market_cap=true`;

      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        if (res.status === 429) {
          console.warn('[CoinGecko] Rate limited — backing off 2 min');
          this.priceTimer = setTimeout(() => this._pollPrices(), 2 * 60 * 1000);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      for (const [id, metrics] of Object.entries(data)) {
        const symbol = ID_TO_SYMBOL[id];
        if (!symbol) continue;

        this.engine.processEvent({
          source: 'coingecko',
          type: 'price_update',
          asset: symbol,
          price_usd:   metrics.usd,
          change_1h:   metrics.usd_1h_change,
          change_24h:  metrics.usd_24h_change,
          volume_24h:  metrics.usd_24h_vol,
          market_cap:  metrics.usd_market_cap,
          ts: Date.now(),
        });
      }

      console.log(`[CoinGecko] Prices updated for ${Object.keys(data).length} assets`);
    } catch (err) {
      console.error('[CoinGecko] Price poll error:', err.message);
    }

    this.priceTimer = setTimeout(() => this._pollPrices(), PRICE_POLL_INTERVAL);
  }

  async _pollTrending() {
    try {
      const res = await fetch(`${BASE_URL}/search/trending`, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const coins = (data.coins || []).slice(0, 7).map(c => {
        const it = c.item || {};
        const dd = it.data || {};
        return {
          symbol:    (it.symbol || '').toUpperCase(),
          name:      it.name || it.symbol || '',
          rank:      (typeof it.market_cap_rank === 'number') ? it.market_cap_rank : null,
          price:     (typeof dd.price === 'number') ? dd.price : null,
          change24h: (dd.price_change_percentage_24h && typeof dd.price_change_percentage_24h.usd === 'number')
                       ? dd.price_change_percentage_24h.usd : null,
          volume:    dd.total_volume || null,   // pre-formatted "$..." string from CoinGecko
          marketCap: dd.market_cap || null,
        };
      }).filter(c => c.symbol);

      if (coins.length > 0) {
        this.engine.processEvent({
          source: 'coingecko',
          type: 'trending',
          coins,
          ts: Date.now(),
        });
        console.log(`[CoinGecko] Trending: ${coins.map(c => c.symbol).join(', ')}`);
      }
    } catch (err) {
      console.error('[CoinGecko] Trending poll error:', err.message);
    }

    this.trendTimer = setTimeout(() => this._pollTrending(), TREND_POLL_INTERVAL);
  }

  stop() {
    clearTimeout(this.priceTimer);
    clearTimeout(this.trendTimer);
  }
}

module.exports = CoinGeckoIngest;
