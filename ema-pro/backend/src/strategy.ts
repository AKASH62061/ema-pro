// ─── EMA Strategy Engine ──────────────────────────────────────────────────
// Strategy: EMA 9 & EMA 15 crossover + 30° angle filter
// + Confirmation candle (engulfing / hammer / strong body)
// + Volume confirmation
// + ATR-based dynamic SL/TP (more accurate than fixed prev-candle)
// ─────────────────────────────────────────────────────────────────────────

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Direction = 'BUY' | 'SELL' | 'NEUTRAL'
export type Confirmation =
  | 'BULLISH_ENGULFING' | 'BEARISH_ENGULFING'
  | 'HAMMER' | 'SHOOTING_STAR'
  | 'STRONG_BULL' | 'STRONG_BEAR'
  | 'NONE'

export interface EMASignal {
  symbol:         string
  timeframe:      string
  direction:      Direction
  ema9:           number
  ema15:          number
  angle:          number        // EMA15 angle in degrees
  angleOk:        boolean       // >= 30°
  confirmation:   Confirmation
  confirmationOk: boolean
  entryPrice:     number
  stopLoss:       number
  takeProfit:     number
  riskReward:     number
  strength:       number        // 0–100
  reasons:        string[]
  timestamp:      number
  // crossover info
  crossedUp:      boolean       // fresh crossover up this candle
  crossedDown:    boolean       // fresh crossover down this candle
  volumeAboveAvg: boolean
  atr:            number
}

// ── EMA ──────────────────────────────────────────────────────────────────
export function calcEMA(candles: Candle[], period: number): number[] {
  if (candles.length < period) return []
  const k = 2 / (period + 1)
  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period
  const result: number[] = [ema]
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k)
    result.push(ema)
  }
  return result
}

// ── ATR (Average True Range) ─────────────────────────────────────────────
function calcATR(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0
  const trs: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]
    const cur  = candles[i]
    trs.push(Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low  - prev.close)
    ))
  }
  return trs.slice(-period).reduce((s, v) => s + v, 0) / period
}

// ── Angle of EMA slope ────────────────────────────────────────────────────
function calcAngle(emas: number[], lookback = 5): number {
  if (emas.length < lookback + 1) return 0
  const slice = emas.slice(-lookback - 1)
  const start = slice[0], end = slice[slice.length - 1]
  if (start === 0) return 0
  const slopePct = ((end - start) / start) * 100 / lookback
  return Math.round(Math.atan(slopePct / 0.05) * (180 / Math.PI) * 10) / 10
}

// ── Confirmation candle ───────────────────────────────────────────────────
function detectConfirmation(candles: Candle[], dir: 'BUY' | 'SELL'): Confirmation {
  if (candles.length < 2) return 'NONE'
  const cur  = candles[candles.length - 1]
  const prev = candles[candles.length - 2]
  const body     = Math.abs(cur.close - cur.open)
  const prevBody = Math.abs(prev.close - prev.open)
  const range    = cur.high - cur.low || 0.0001
  const upper    = cur.high  - Math.max(cur.open, cur.close)
  const lower    = Math.min(cur.open, cur.close) - cur.low

  if (dir === 'BUY') {
    if (cur.close > cur.open && prev.close < prev.open && body > prevBody * 0.8 && cur.close > prev.open)
      return 'BULLISH_ENGULFING'
    if (lower >= body * 2 && upper <= body * 0.5)
      return 'HAMMER'
    if (cur.close > cur.open && body / range > 0.6 && (cur.close - cur.low) / range > 0.7)
      return 'STRONG_BULL'
  } else {
    if (cur.close < cur.open && prev.close > prev.open && body > prevBody * 0.8 && cur.close < prev.open)
      return 'BEARISH_ENGULFING'
    if (upper >= body * 2 && lower <= body * 0.5)
      return 'SHOOTING_STAR'
    if (cur.close < cur.open && body / range > 0.6 && (cur.high - cur.close) / range > 0.7)
      return 'STRONG_BEAR'
  }
  return 'NONE'
}

// ── Volume ────────────────────────────────────────────────────────────────
function volumeAboveAvg(candles: Candle[], period = 20): boolean {
  if (candles.length < period + 1) return true
  const avg = candles.slice(-period - 1, -1).reduce((s, c) => s + c.volume, 0) / period
  return avg > 0 ? candles[candles.length - 1].volume >= avg * 0.8 : true
}

// ── Main signal ───────────────────────────────────────────────────────────
export function computeSignal(symbol: string, candles: Candle[], timeframe: string): EMASignal | null {
  if (candles.length < 30) return null

  const ema9arr  = calcEMA(candles, 9)
  const ema15arr = calcEMA(candles, 15)
  if (ema9arr.length < 5 || ema15arr.length < 5) return null

  const ema9      = ema9arr[ema9arr.length - 1]
  const ema15     = ema15arr[ema15arr.length - 1]
  const ema9prev  = ema9arr[ema9arr.length - 2]
  const ema15prev = ema15arr[ema15arr.length - 2]

  // Fresh crossover detection
  const crossedUp   = ema9prev <= ema15prev && ema9 > ema15
  const crossedDown = ema9prev >= ema15prev && ema9 < ema15

  // Angle of EMA15 (the slower line drives direction)
  const lookback = timeframe === '1m' ? 3 : timeframe === '5m' ? 4 : 5
  const angle    = calcAngle(ema15arr, lookback)
  const angleAbs = Math.abs(angle)
  const angleOk  = angleAbs >= 30

  // ATR for dynamic SL
  const atr = calcATR(candles)

  const entryPrice = candles[candles.length - 1].close

  // Direction: EMA9 > EMA15 + angle upward = BUY, reverse = SELL
  let direction: Direction = 'NEUTRAL'
  if (angleOk && ema9 > ema15 && angle > 0) direction = 'BUY'
  if (angleOk && ema9 < ema15 && angle < 0) direction = 'SELL'

  if (direction === 'NEUTRAL') {
    return {
      symbol, timeframe, direction: 'NEUTRAL',
      ema9, ema15, angle, angleOk: false,
      confirmation: 'NONE', confirmationOk: false,
      entryPrice, stopLoss: 0, takeProfit: 0, riskReward: 0,
      strength: 0,
      reasons: [`Angle ${angleAbs.toFixed(1)}° < 30° — sideways, no trade`],
      timestamp: Date.now(),
      crossedUp: false, crossedDown: false,
      volumeAboveAvg: true, atr,
    }
  }

  // Confirmation candle
  const confirmation   = detectConfirmation(candles, direction)
  const confirmationOk = confirmation !== 'NONE'

  // SL: ATR-based (1.5× ATR from entry) — more robust than prev candle
  const slDist   = atr > 0 ? atr * 1.5 : Math.abs(entryPrice - (direction === 'BUY' ? candles[candles.length-2].low : candles[candles.length-2].high))
  const stopLoss = direction === 'BUY'  ? entryPrice - slDist : entryPrice + slDist
  // TP: 2× risk (1:2 RR)
  const takeProfit = direction === 'BUY' ? entryPrice + slDist * 2 : entryPrice - slDist * 2
  const riskReward = 2.0

  const volOk = volumeAboveAvg(candles)

  // Strength score 0–100
  let strength = 0
  strength += Math.min(40, (angleAbs - 30) * 1.5)
  if (confirmationOk) strength += 25
  if (volOk)          strength += 15
  if (crossedUp || crossedDown) strength += 20   // fresh crossover bonus
  strength = Math.round(Math.max(0, Math.min(100, strength)))

  const reasons: string[] = [
    `EMA15 angle ${angle.toFixed(1)}° ✓`,
    `EMA9 ${direction === 'BUY' ? '>' : '<'} EMA15`,
    confirmationOk ? `✓ ${confirmation.replace(/_/g,' ')}` : '⚠ No confirmation yet',
    volOk ? '✓ Volume OK' : '⚠ Low volume',
    (crossedUp || crossedDown) ? '🔥 Fresh crossover!' : 'Existing trend',
  ]

  return {
    symbol, timeframe, direction,
    ema9, ema15, angle, angleOk,
    confirmation, confirmationOk,
    entryPrice, stopLoss, takeProfit, riskReward,
    strength, reasons, timestamp: Date.now(),
    crossedUp, crossedDown,
    volumeAboveAvg: volOk, atr,
  }
}
