// ─── Market Data ──────────────────────────────────────────────────────────
// Crypto  → Binance public REST (no key, reliable)
// Stocks  → Finnhub free tier (FINNHUB_KEY env var required)
// Indian stocks → NSE unofficial endpoint (best-effort)
// ─────────────────────────────────────────────────────────────────────────

import https from 'https'

export interface Candle {
  time: number; open: number; high: number; low: number; close: number; volume: number
}
export interface Quote {
  symbol: string; price: number; change: number; changePct: number
  high: number; low: number; open: number; volume: number; timestamp: number
}

function get(url: string, headers: Record<string,string> = {}): Promise<string> {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', ...headers }, timeout: 7000 }, r => {
      if ((r.statusCode === 301 || r.statusCode === 302) && r.headers.location)
        return get(r.headers.location, headers).then(res, rej)
      let d = ''
      r.on('data', c => d += c)
      r.on('end', () => res(d))
    })
    req.on('error', rej)
    req.on('timeout', () => { req.destroy(); rej(new Error('Timeout')) })
  })
}

// ── BINANCE: live crypto quotes ───────────────────────────────────────────
export async function fetchBinanceQuote(symbol: string): Promise<Quote | null> {
  // symbol like BTC-USD → BTCUSDT
  const binSym = symbol.replace('-USD', 'USDT').replace('-', '')
  try {
    const data = JSON.parse(await get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${binSym}`))
    if (!data.lastPrice) return null
    const price = parseFloat(data.lastPrice)
    const open  = parseFloat(data.openPrice)
    return {
      symbol, price,
      change: price - open, changePct: parseFloat(data.priceChangePercent),
      high: parseFloat(data.highPrice), low: parseFloat(data.lowPrice),
      open, volume: parseFloat(data.volume), timestamp: Date.now(),
    }
  } catch { return null }
}

// ── BINANCE: historical candles ───────────────────────────────────────────
export async function fetchBinanceCandles(symbol: string, interval: string, limit = 200): Promise<Candle[]> {
  const binSym = symbol.replace('-USD', 'USDT').replace('-', '')
  // interval map: 1m→1m, 5m→5m, 15m→15m, 1h→1h, 3h→3h, 1d→1d
  const intMap: Record<string,string> = { '1m':'1m','5m':'5m','15m':'15m','1h':'1h','3h':'3h','1d':'1d' }
  const binInterval = intMap[interval] || '15m'
  try {
    const raw: any[][] = JSON.parse(await get(
      `https://api.binance.com/api/v3/klines?symbol=${binSym}&interval=${binInterval}&limit=${limit}`
    ))
    return raw.map(r => ({
      time: r[0], open: parseFloat(r[1]), high: parseFloat(r[2]),
      low: parseFloat(r[3]), close: parseFloat(r[4]), volume: parseFloat(r[5]),
    }))
  } catch { return [] }
}

// ── FINNHUB: stock quote (free, needs key) ────────────────────────────────
export async function fetchFinnhubQuote(symbol: string, apiKey: string): Promise<Quote | null> {
  try {
    const data = JSON.parse(await get(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`
    ))
    if (!data.c || data.c === 0) return null
    return {
      symbol, price: data.c,
      change: data.d ?? 0, changePct: data.dp ?? 0,
      high: data.h, low: data.l, open: data.o,
      volume: 0, timestamp: Date.now(),
    }
  } catch { return null }
}

// ── FINNHUB: historical candles ───────────────────────────────────────────
export async function fetchFinnhubCandles(symbol: string, interval: string, apiKey: string, limit = 200): Promise<Candle[]> {
  const resMap: Record<string,string> = { '1m':'1','5m':'5','15m':'15','1h':'60','1d':'D' }
  const res = resMap[interval] || '15'
  const to   = Math.floor(Date.now() / 1000)
  // go back enough bars
  const minsPer: Record<string,number> = { '1':'1','5':5,'15':15,'60':60,'D':1440 }
  const mins = minsPer[res] || 15
  const from = to - mins * 60 * limit
  try {
    const data = JSON.parse(await get(
      `https://finnhub.io/api/v1/stock/candle?symbol=${symbol}&resolution=${res}&from=${from}&to=${to}&token=${apiKey}`
    ))
    if (data.s !== 'ok' || !data.c) return []
    return data.t.map((t: number, i: number) => ({
      time: t * 1000, open: data.o[i], high: data.h[i],
      low: data.l[i], close: data.c[i], volume: data.v[i],
    }))
  } catch { return [] }
}

// ── NSE India: best-effort quotes ────────────────────────────────────────
// Uses public NSE website data — no key needed but may rate-limit
export async function fetchNSEQuote(nseSym: string): Promise<Quote | null> {
  // nseSym like RELIANCE, TCS etc (without .NS)
  try {
    const raw = await get(
      `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(nseSym)}`,
      { 'Accept': 'application/json', 'Referer': 'https://www.nseindia.com/' }
    )
    const d = JSON.parse(raw)
    const price = d?.priceInfo?.lastPrice ?? 0
    if (!price) return null
    return {
      symbol: nseSym + '.NS', price,
      change: d?.priceInfo?.change ?? 0,
      changePct: d?.priceInfo?.pChange ?? 0,
      high: d?.priceInfo?.intraDayHighLow?.max ?? price,
      low:  d?.priceInfo?.intraDayHighLow?.min ?? price,
      open: d?.priceInfo?.open ?? price,
      volume: d?.securityInfo?.totalTradedVolume ?? 0,
      timestamp: Date.now(),
    }
  } catch { return null }
}

// ── Instrument list ───────────────────────────────────────────────────────
export interface Instrument {
  sym: string; name: string; type: 'CRYPTO' | 'US_STOCK' | 'IN_STOCK' | 'IN_INDEX'
  baseSym?: string // Binance/Finnhub symbol
}

export const INSTRUMENTS: Instrument[] = [
  // Crypto — Binance (always works)
  { sym:'BTC-USD',  name:'Bitcoin',          type:'CRYPTO' },
  { sym:'ETH-USD',  name:'Ethereum',         type:'CRYPTO' },
  { sym:'SOL-USD',  name:'Solana',           type:'CRYPTO' },
  { sym:'BNB-USD',  name:'BNB',              type:'CRYPTO' },
  { sym:'XRP-USD',  name:'XRP',              type:'CRYPTO' },
  { sym:'ADA-USD',  name:'Cardano',          type:'CRYPTO' },
  { sym:'AVAX-USD', name:'Avalanche',        type:'CRYPTO' },
  { sym:'DOGE-USD', name:'Dogecoin',         type:'CRYPTO' },
  { sym:'MATIC-USD',name:'Polygon',          type:'CRYPTO' },
  { sym:'LINK-USD', name:'Chainlink',        type:'CRYPTO' },
  // US Stocks — Finnhub (needs FINNHUB_KEY)
  { sym:'AAPL',  name:'Apple Inc.',          type:'US_STOCK' },
  { sym:'MSFT',  name:'Microsoft',           type:'US_STOCK' },
  { sym:'NVDA',  name:'Nvidia',              type:'US_STOCK' },
  { sym:'TSLA',  name:'Tesla',               type:'US_STOCK' },
  { sym:'AMZN',  name:'Amazon',              type:'US_STOCK' },
  { sym:'GOOGL', name:'Alphabet',            type:'US_STOCK' },
  { sym:'META',  name:'Meta Platforms',      type:'US_STOCK' },
  { sym:'AMD',   name:'AMD',                 type:'US_STOCK' },
  { sym:'SPY',   name:'S&P 500 ETF',         type:'US_STOCK' },
  { sym:'QQQ',   name:'Nasdaq 100 ETF',      type:'US_STOCK' },
  // Indian stocks — NSE best-effort
  { sym:'RELIANCE.NS', name:'Reliance Industries', type:'IN_STOCK', baseSym:'RELIANCE' },
  { sym:'TCS.NS',      name:'Tata Consultancy',    type:'IN_STOCK', baseSym:'TCS' },
  { sym:'INFY.NS',     name:'Infosys',             type:'IN_STOCK', baseSym:'INFY' },
  { sym:'HDFCBANK.NS', name:'HDFC Bank',           type:'IN_STOCK', baseSym:'HDFCBANK' },
  { sym:'ICICIBANK.NS',name:'ICICI Bank',          type:'IN_STOCK', baseSym:'ICICIBANK' },
  { sym:'TATAMOTORS.NS',name:'Tata Motors',        type:'IN_STOCK', baseSym:'TATAMOTORS' },
  { sym:'WIPRO.NS',    name:'Wipro',               type:'IN_STOCK', baseSym:'WIPRO' },
  { sym:'SBIN.NS',     name:'State Bank of India', type:'IN_STOCK', baseSym:'SBIN' },
  { sym:'NIFTY50.NS',  name:'Nifty 50 Index',      type:'IN_INDEX', baseSym:'NIFTY 50' },
  { sym:'BANKNIFTY.NS',name:'Bank Nifty Index',    type:'IN_INDEX', baseSym:'BANKNIFTY' },
]
