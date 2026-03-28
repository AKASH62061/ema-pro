import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import cors from 'cors'
import dotenv from 'dotenv'
import {
  INSTRUMENTS, fetchBinanceQuote, fetchBinanceCandles,
  fetchFinnhubQuote, fetchFinnhubCandles, fetchNSEQuote,
  Candle, Quote
} from './markets'
import { computeSignal, calcEMA, EMASignal } from './strategy'

dotenv.config()

const FINNHUB_KEY = process.env.FINNHUB_KEY || ''
const PORT = parseInt(process.env.PORT || '3001')

const app = express()
const srv = createServer(app)
const wss = new WebSocketServer({ server: srv, path: '/ws' })

app.use(cors({ origin: '*' }))
app.use(express.json())

// ── In-memory state ───────────────────────────────────────────────────────
const quotes    = new Map<string, Quote>()
const candles   = new Map<string, Map<string, Candle[]>>()  // sym → tf → candles
const signals   = new Map<string, EMASignal>()

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1d']
const DEFAULT_TF = '15m'

// ── Init candle storage ───────────────────────────────────────────────────
for (const inst of INSTRUMENTS) {
  const m = new Map<string, Candle[]>()
  for (const tf of TIMEFRAMES) m.set(tf, [])
  candles.set(inst.sym, m)
}

// ── Fetch initial candles for all crypto ─────────────────────────────────
async function initCryptoCandles() {
  const cryptos = INSTRUMENTS.filter(i => i.type === 'CRYPTO')
  for (const inst of cryptos) {
    for (const tf of TIMEFRAMES) {
      try {
        const c = await fetchBinanceCandles(inst.sym, tf, 200)
        if (c.length) candles.get(inst.sym)?.set(tf, c)
        await delay(100)
      } catch {}
    }
    console.log(`[init] ${inst.sym} candles loaded`)
  }
}

// ── Fetch stock candles (Finnhub) ─────────────────────────────────────────
async function initStockCandles() {
  if (!FINNHUB_KEY) return
  const stocks = INSTRUMENTS.filter(i => i.type === 'US_STOCK')
  for (const inst of stocks) {
    for (const tf of ['5m', '15m', '1h', '1d']) {
      try {
        const c = await fetchFinnhubCandles(inst.sym, tf, FINNHUB_KEY, 200)
        if (c.length) candles.get(inst.sym)?.set(tf, c)
        await delay(300)
      } catch {}
    }
  }
}

// ── Recompute all signals ─────────────────────────────────────────────────
function recomputeSignals(tf = DEFAULT_TF) {
  for (const inst of INSTRUMENTS) {
    const c = candles.get(inst.sym)?.get(tf) || []
    const sig = computeSignal(inst.sym, c, tf)
    if (sig) signals.set(inst.sym, sig)
  }
}

// ── Live price updates: crypto every 3s ───────────────────────────────────
async function updateCryptoPrices() {
  const cryptos = INSTRUMENTS.filter(i => i.type === 'CRYPTO')
  for (const inst of cryptos) {
    try {
      const q = await fetchBinanceQuote(inst.sym)
      if (q) quotes.set(inst.sym, q)
      await delay(150)
    } catch {}
  }
  broadcast({ type: 'QUOTES', data: Object.fromEntries(quotes) })
}

// ── Live candle update: append/update last candle from Binance ────────────
async function updateCryptoCandles() {
  const cryptos = INSTRUMENTS.filter(i => i.type === 'CRYPTO')
  for (const inst of cryptos) {
    try {
      const latest = await fetchBinanceCandles(inst.sym, DEFAULT_TF, 5)
      if (!latest.length) continue
      const existing = candles.get(inst.sym)?.get(DEFAULT_TF) || []
      if (!existing.length) continue
      // Replace last candle or append
      const last = existing[existing.length - 1]
      const newLast = latest[latest.length - 1]
      if (newLast.time === last.time) {
        existing[existing.length - 1] = newLast
      } else if (newLast.time > last.time) {
        existing.push(newLast)
        if (existing.length > 500) existing.splice(0, 1)
      }
      candles.get(inst.sym)?.set(DEFAULT_TF, existing)
    } catch {}
  }
  // Recompute signals and broadcast
  recomputeSignals(DEFAULT_TF)
  broadcast({ type: 'SIGNALS', data: Object.fromEntries(signals) })
}

// ── Stock price update every 60s ──────────────────────────────────────────
async function updateStockPrices() {
  if (!FINNHUB_KEY) return
  const stocks = INSTRUMENTS.filter(i => i.type === 'US_STOCK')
  for (const inst of stocks) {
    try {
      const q = await fetchFinnhubQuote(inst.sym, FINNHUB_KEY)
      if (q) quotes.set(inst.sym, q)
      await delay(500)
    } catch {}
  }
}

// ── NSE Indian stocks every 15s ───────────────────────────────────────────
async function updateNSEPrices() {
  const indian = INSTRUMENTS.filter(i => i.type === 'IN_STOCK' || i.type === 'IN_INDEX')
  for (const inst of indian) {
    try {
      const q = await fetchNSEQuote(inst.baseSym || inst.sym)
      if (q) quotes.set(inst.sym, q)
      await delay(500)
    } catch {}
  }
}

// ── WebSocket broadcast ───────────────────────────────────────────────────
function broadcast(msg: any) {
  const payload = JSON.stringify(msg)
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload) })
}

wss.on('connection', (ws) => {
  // Send snapshot on connect
  ws.send(JSON.stringify({
    type: 'INIT',
    quotes: Object.fromEntries(quotes),
    signals: Object.fromEntries(signals),
    instruments: INSTRUMENTS,
  }))
})

// ── REST API ──────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({
  status: 'ok', uptime: process.uptime(),
  symbols: INSTRUMENTS.length,
  finnhubEnabled: !!FINNHUB_KEY,
  quotes: quotes.size,
}))

app.get('/api/instruments', (_, res) => {
  const result = INSTRUMENTS.map(inst => ({
    ...inst,
    ...quotes.get(inst.sym),
    signal: signals.get(inst.sym) || null,
  }))
  res.json(result)
})

app.get('/api/quotes', (_, res) => res.json(Object.fromEntries(quotes)))

app.get('/api/signals', (req, res) => {
  const tf = (req.query.tf as string) || DEFAULT_TF
  // recompute for requested TF on demand
  const result: Record<string, EMASignal> = {}
  for (const inst of INSTRUMENTS) {
    const c = candles.get(inst.sym)?.get(tf) || []
    const sig = computeSignal(inst.sym, c, tf)
    if (sig) result[inst.sym] = sig
  }
  res.json(result)
})

app.get('/api/candles/:sym', async (req, res) => {
  const sym = req.params.sym
  const tf  = (req.query.tf as string) || DEFAULT_TF

  // Try cache first
  let c = candles.get(sym)?.get(tf) || []

  // If cache empty, fetch now
  if (!c.length) {
    const inst = INSTRUMENTS.find(i => i.sym === sym)
    if (inst?.type === 'CRYPTO') {
      c = await fetchBinanceCandles(sym, tf, 200)
      candles.get(sym)?.set(tf, c)
    } else if (inst?.type === 'US_STOCK' && FINNHUB_KEY) {
      c = await fetchFinnhubCandles(sym, tf, FINNHUB_KEY, 200)
      candles.get(sym)?.set(tf, c)
    }
  }

  // Compute EMA arrays to send alongside
  const ema9arr  = calcEMA(c, 9)
  const ema15arr = calcEMA(c, 15)

  // Align: EMA arrays are shorter (by period-1)
  const offset9  = c.length - ema9arr.length
  const offset15 = c.length - ema15arr.length

  const enriched = c.map((candle, i) => ({
    ...candle,
    ema9:  i >= offset9  ? ema9arr[i - offset9]   : null,
    ema15: i >= offset15 ? ema15arr[i - offset15] : null,
  }))

  const sig = computeSignal(sym, c, tf)
  res.json({ candles: enriched, signal: sig })
})

// ── Start ─────────────────────────────────────────────────────────────────
function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  console.log('[server] Starting EMA Pro backend...')

  // Load candles
  await initCryptoCandles()
  initStockCandles().catch(() => {}) // don't await
  updateNSEPrices().catch(() => {})

  // Compute initial signals
  recomputeSignals(DEFAULT_TF)

  // Schedule updates
  setInterval(updateCryptoPrices,  3_000)    // quotes every 3s
  setInterval(updateCryptoCandles, 15_000)   // candles + signals every 15s
  setInterval(updateStockPrices,   60_000)   // stocks every 60s
  setInterval(updateNSEPrices,     30_000)   // NSE every 30s

  srv.listen(PORT, () => console.log(`[server] Listening on port ${PORT}`))
}

main().catch(console.error)
