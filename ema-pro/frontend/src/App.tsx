import { useState, useEffect, useRef, useCallback } from 'react'

// ── Config ────────────────────────────────────────────────────────────────
const API  = (import.meta as any).env?.VITE_API_URL  || 'https://ema-pro.onrender.com'
const WS   = (import.meta as any).env?.VITE_WS_URL   || 'ws://ema-pro.onrender.com/ws'
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1d']

// ── Types ──────────────────────────────────────────────────────────────────
interface Candle {
  time: number; open: number; high: number; low: number; close: number; volume: number
  ema9?: number | null; ema15?: number | null
}
interface Signal {
  symbol: string; timeframe: string; direction: 'BUY' | 'SELL' | 'NEUTRAL'
  ema9: number; ema15: number; angle: number; angleOk: boolean
  confirmation: string; confirmationOk: boolean
  entryPrice: number; stopLoss: number; takeProfit: number; riskReward: number
  strength: number; reasons: string[]; timestamp: number
  crossedUp: boolean; crossedDown: boolean; volumeAboveAvg: boolean; atr: number
}
interface Instrument {
  sym: string; name: string; type: string
  price?: number; change?: number; changePct?: number
  signal?: Signal | null
}
interface Quote { price: number; change: number; changePct: number; high: number; low: number }

// ── Helpers ───────────────────────────────────────────────────────────────
const fp = (n?: number | null, d = 2) =>
  n == null || isNaN(n) ? '—' :
  n >= 1000 ? n.toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) :
  n.toFixed(d)

const pct = (n?: number | null) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

// ── TradingView chart helpers ─────────────────────────────────────────────
function toTVSymbol(sym: string): string {
  if (sym.endsWith('-USD')) return `BINANCE:${sym.replace('-USD', 'USDT')}`
  if (sym.endsWith('.NS'))  return `NSE:${sym.replace('.NS', '')}`
  return `NASDAQ:${sym}`
}
function toTVInterval(tf: string): string {
  return { '1m':'1','5m':'5','15m':'15','1h':'60','3h':'180','1d':'D' }[tf] || '15'
}

// ═══════════════════════════════════════════════════════════════════════════
// CHART COMPONENT — TradingView embed with EMA 9/15 only
// ═══════════════════════════════════════════════════════════════════════════
function TradingChart({ symbol, timeframe, signal }: {
  symbol: string; timeframe: string; signal?: Signal | null
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = ''
    const s = document.createElement('script')
    s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'
    s.async = true
    s.innerHTML = JSON.stringify({
      autosize: true,
      symbol: toTVSymbol(symbol),
      interval: toTVInterval(timeframe),
      timezone: 'Asia/Kolkata',
      theme: 'dark',
      style: '1',
      locale: 'en',
      backgroundColor: 'rgba(8,11,15,1)',
      gridColor: 'rgba(30,42,56,0.6)',
      hide_top_toolbar: false,
      hide_legend: false,
      hide_side_toolbar: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      // ONLY EMA 9 & EMA 15 — no other indicators
      studies: [
        {
          id: 'MAExp@tv-basicstudies',
          inputs: { length: 9 },
          override: { 'Plot.color': '#00e676', 'Plot.linewidth': 2 }
        },
        {
          id: 'MAExp@tv-basicstudies',
          inputs: { length: 15 },
          override: { 'Plot.color': '#ff9800', 'Plot.linewidth': 2 }
        },
      ],
      support_host: 'https://www.tradingview.com',
    })
    ref.current.appendChild(s)
    return () => { if (ref.current) ref.current.innerHTML = '' }
  }, [symbol, timeframe])

  const dirCol = signal?.direction === 'BUY' ? 'var(--bull)' : signal?.direction === 'SELL' ? 'var(--bear)' : 'var(--muted)'

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Signal overlay bar above chart */}
      {signal && signal.direction !== 'NEUTRAL' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16, padding: '6px 14px',
          background: signal.direction === 'BUY' ? 'rgba(0,230,118,.06)' : 'rgba(255,61,90,.06)',
          borderBottom: `1px solid ${dirCol}30`, flexShrink: 0
        }}>
          {/* Pulsing dot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: dirCol }} />
            <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: dirCol }}>
              {signal.direction === 'BUY' ? '▲ BUY SIGNAL' : '▼ SELL SIGNAL'}
            </span>
          </div>

          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

          <div style={{ display: 'flex', gap: 20, fontSize: 11 }}>
            <div>
              <span style={{ color: 'var(--muted)' }}>Entry </span>
              <span className="mono" style={{ fontWeight: 700 }}>{fp(signal.entryPrice, 4)}</span>
            </div>
            <div>
              <span style={{ color: 'var(--muted)' }}>SL </span>
              <span className="mono" style={{ color: 'var(--bear)', fontWeight: 700 }}>{fp(signal.stopLoss, 4)}</span>
            </div>
            <div>
              <span style={{ color: 'var(--muted)' }}>TP </span>
              <span className="mono" style={{ color: 'var(--bull)', fontWeight: 700 }}>{fp(signal.takeProfit, 4)}</span>
            </div>
            <div>
              <span style={{ color: 'var(--muted)' }}>RR </span>
              <span className="mono" style={{ color: 'var(--gold)', fontWeight: 700 }}>1:{signal.riskReward.toFixed(1)}</span>
            </div>
            <div>
              <span style={{ color: 'var(--muted)' }}>Angle </span>
              <span className="mono" style={{ color: signal.angleOk ? 'var(--bull)' : 'var(--muted)', fontWeight: 700 }}>{signal.angle.toFixed(1)}°</span>
            </div>
            <div>
              <span style={{ color: 'var(--muted)' }}>Strength </span>
              <span className="mono" style={{ color: signal.strength >= 70 ? 'var(--bull)' : signal.strength >= 40 ? 'var(--gold)' : 'var(--bear)', fontWeight: 700 }}>{signal.strength}%</span>
            </div>
            {signal.confirmationOk && (
              <span style={{ color: 'var(--gold)', fontSize: 10, fontWeight: 700 }}>
                ✓ {signal.confirmation.replace(/_/g, ' ')}
              </span>
            )}
            {(signal.crossedUp || signal.crossedDown) && (
              <span style={{ color: 'var(--gold)', fontSize: 10, fontWeight: 700, animation: 'pulse 1s infinite' }}>
                🔥 FRESH CROSSOVER
              </span>
            )}
          </div>
        </div>
      )}

      {signal && signal.direction === 'NEUTRAL' && (
        <div style={{ padding: '4px 14px', background: 'var(--bg2)', borderBottom: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>
          ⟶ Sideways — EMA15 angle {signal.angle.toFixed(1)}° {'<'} 30° — No trade signal
        </div>
      )}

      <div ref={ref} style={{ flex: 1 }}>
        <div className="tradingview-widget-container__widget" style={{ height: '100%', width: '100%' }} />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// SIGNAL DETAIL PANEL
// ═══════════════════════════════════════════════════════════════════════════
function SignalPanel({ signal, quote }: { signal?: Signal | null; quote?: Quote | null }) {
  if (!signal) return (
    <div style={{ padding: 24, color: 'var(--muted)', textAlign: 'center', fontSize: 12 }}>
      Select a market to see EMA signal
    </div>
  )

  const isBuy  = signal.direction === 'BUY'
  const isSell = signal.direction === 'SELL'
  const dirCol = isBuy ? 'var(--bull)' : isSell ? 'var(--bear)' : 'var(--muted)'
  const strCol = signal.strength >= 70 ? 'var(--bull)' : signal.strength >= 40 ? 'var(--gold)' : 'var(--bear)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, height: '100%', overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ padding: '12px 14px', background: `${dirCol}08`, borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span className="mono" style={{ fontSize: 18, fontWeight: 700, color: dirCol }}>
            {isBuy ? '▲ BUY' : isSell ? '▼ SELL' : '— WAIT'}
          </span>
          {signal.direction !== 'NEUTRAL' && (
            <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span style={{ fontSize: 9, color: 'var(--muted)' }}>STRENGTH</span>
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: strCol }}>{signal.strength}%</span>
            </div>
          )}
        </div>

        {/* Strength bar */}
        {signal.direction !== 'NEUTRAL' && (
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
            <div style={{ height: '100%', width: `${signal.strength}%`, background: strCol, borderRadius: 2, transition: 'width .5s ease' }} />
          </div>
        )}

        <div style={{ fontSize: 10, color: 'var(--muted)' }}>
          {signal.timeframe} · {new Date(signal.timestamp).toLocaleTimeString()}
        </div>
      </div>

      {/* EMA Values */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6, borderLeft: '2px solid var(--bull)' }}>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 3 }}>EMA 9 (Fast)</div>
          <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--bull)' }}>{fp(signal.ema9, 4)}</div>
        </div>
        <div style={{ padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6, borderLeft: '2px solid #ff9800' }}>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 3 }}>EMA 15 (Slow)</div>
          <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: '#ff9800' }}>{fp(signal.ema15, 4)}</div>
        </div>
      </div>

      {/* Entry / SL / TP */}
      {signal.direction !== 'NEUTRAL' && (
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Trade Setup</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(64,196,255,.06)', borderRadius: 5, borderLeft: '2px solid var(--blue)' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>ENTRY</span>
              <span className="mono" style={{ fontWeight: 700 }}>{fp(signal.entryPrice, 4)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(255,61,90,.06)', borderRadius: 5, borderLeft: '2px solid var(--bear)' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>STOP LOSS</span>
              <span className="mono" style={{ fontWeight: 700, color: 'var(--bear)' }}>{fp(signal.stopLoss, 4)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(0,230,118,.06)', borderRadius: 5, borderLeft: '2px solid var(--bull)' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>TAKE PROFIT</span>
              <span className="mono" style={{ fontWeight: 700, color: 'var(--bull)' }}>{fp(signal.takeProfit, 4)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 10px' }}>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>Risk/Reward</span>
              <span className="mono" style={{ fontWeight: 700, color: 'var(--gold)' }}>1:{signal.riskReward.toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Angle + Confirmation */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6 }}>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 3 }}>EMA15 ANGLE</div>
          <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: signal.angleOk ? 'var(--bull)' : 'var(--bear)' }}>
            {signal.angle.toFixed(1)}°
          </div>
          <div style={{ fontSize: 9, color: signal.angleOk ? 'var(--bull)' : 'var(--bear)' }}>
            {signal.angleOk ? '✓ ≥30° valid' : '✗ <30° sideways'}
          </div>
        </div>
        <div style={{ padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6 }}>
          <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 3 }}>CONFIRM CANDLE</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: signal.confirmationOk ? 'var(--bull)' : 'var(--muted)' }}>
            {signal.confirmationOk ? '✓ YES' : '⚠ WAIT'}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text2)' }}>
            {signal.confirmation.replace(/_/g, ' ')}
          </div>
        </div>
      </div>

      {/* Crossover & Volume */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <div style={{
          flex: 1, padding: '6px 10px', borderRadius: 5, textAlign: 'center',
          background: (signal.crossedUp || signal.crossedDown) ? 'rgba(255,215,64,.1)' : 'var(--bg3)',
          border: `1px solid ${(signal.crossedUp || signal.crossedDown) ? 'rgba(255,215,64,.4)' : 'var(--border)'}`
        }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>CROSSOVER</div>
          <div style={{ fontWeight: 700, fontSize: 11, color: (signal.crossedUp || signal.crossedDown) ? 'var(--gold)' : 'var(--muted)' }}>
            {signal.crossedUp ? '🔥 FRESH UP' : signal.crossedDown ? '🔥 FRESH DOWN' : 'Existing'}
          </div>
        </div>
        <div style={{
          flex: 1, padding: '6px 10px', borderRadius: 5, textAlign: 'center',
          background: signal.volumeAboveAvg ? 'rgba(0,230,118,.06)' : 'rgba(255,61,90,.06)',
          border: `1px solid ${signal.volumeAboveAvg ? 'rgba(0,230,118,.2)' : 'rgba(255,61,90,.2)'}`
        }}>
          <div style={{ fontSize: 9, color: 'var(--muted)' }}>VOLUME</div>
          <div style={{ fontWeight: 700, fontSize: 11, color: signal.volumeAboveAvg ? 'var(--bull)' : 'var(--bear)' }}>
            {signal.volumeAboveAvg ? '✓ ABOVE AVG' : '✗ LOW'}
          </div>
        </div>
      </div>

      {/* Reasons */}
      <div style={{ padding: '10px 14px' }}>
        <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>Analysis</div>
        {signal.reasons.map((r, i) => (
          <div key={i} style={{ fontSize: 11, color: r.startsWith('✓') || r.startsWith('🔥') ? 'var(--bull)' : r.startsWith('⚠') ? 'var(--gold)' : 'var(--text2)', marginBottom: 4, lineHeight: 1.5 }}>
            {r}
          </div>
        ))}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MARKETS SIDEBAR
// ═══════════════════════════════════════════════════════════════════════════
function MarketRow({ inst, quote, signal, isSelected, onClick }: {
  inst: Instrument; quote?: Quote; signal?: Signal | null
  isSelected: boolean; onClick: () => void
}) {
  const price  = quote?.price ?? inst.price ?? 0
  const chgPct = quote?.changePct ?? inst.changePct ?? 0
  const isUp   = chgPct >= 0
  const dir    = signal?.direction
  const dirCol = dir === 'BUY' ? 'var(--bull)' : dir === 'SELL' ? 'var(--bear)' : 'transparent'

  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 0,
      padding: '8px 10px',
      background: isSelected ? 'rgba(0,230,118,.06)' : 'transparent',
      borderLeft: `2px solid ${isSelected ? 'var(--bull)' : 'transparent'}`,
      borderBottom: '1px solid var(--border)',
      cursor: 'pointer', transition: 'background .1s',
    }}
      onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--card)' }}
      onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
    >
      {/* Signal indicator */}
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: dir !== 'NEUTRAL' && dir ? dirCol : 'var(--border)', marginRight: 8, flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
          <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: isSelected ? 'var(--bull)' : 'var(--text)' }}>
            {inst.sym.replace('-USD', '').replace('.NS', '')}
          </span>
          <span className="mono" style={{ fontSize: 11, fontWeight: 700 }}>
            {fp(price, price < 1 ? 4 : price < 100 ? 2 : 0)}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 9, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {inst.name}
          </span>
          <span className="mono" style={{ fontSize: 9, fontWeight: 600, color: isUp ? 'var(--bull)' : 'var(--bear)', flexShrink: 0 }}>
            {pct(chgPct)}
          </span>
        </div>
      </div>

      {/* Signal pill */}
      {dir && dir !== 'NEUTRAL' && (
        <div style={{
          marginLeft: 6, padding: '2px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
          color: dirCol, background: `${dirCol}15`, border: `1px solid ${dirCol}40`, flexShrink: 0
        }}>
          {dir}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
export default function App() {
  const [instruments, setInstruments] = useState<Instrument[]>([])
  const [quotes, setQuotes]           = useState<Record<string, Quote>>({})
  const [signals, setSignals]         = useState<Record<string, Signal>>({})
  const [selected, setSelected]       = useState<string>('ETH-USD')
  const [timeframe, setTimeframe]     = useState('15m')
  const [wsOk, setWsOk]              = useState(false)
  const [filter, setFilter]           = useState<'ALL'|'CRYPTO'|'US_STOCK'|'IN_STOCK'|'BUY'|'SELL'>('ALL')
  const [search, setSearch]           = useState('')
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const retryRef = useRef(0)

  // ── Load instruments ────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/instruments`)
      .then(r => r.json())
      .then(d => { setInstruments(d); setLoading(false) })
      .catch(() => setError('Cannot reach backend. Start the server first.'))
  }, [])

  // ── WebSocket ────────────────────────────────────────────────────────────
  // ── WebSocket ────────────────────────────────────────────────────────────
const connect = useCallback(() => {
  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
    return
  }

  console.log("Connecting WS:", WS)

  try {
    const ws = new WebSocket(WS)
    wsRef.current = ws

    ws.onopen = () => {
      console.log("✅ WS Connected")
      setWsOk(true)
      retryRef.current = 0
    }

    ws.onclose = () => {
      console.log("❌ WS Disconnected")
      setWsOk(false)

      if (retryRef.current < 10) {
        retryRef.current++
        setTimeout(() => {
          console.log("🔁 Reconnecting WS...", retryRef.current)
          connect()
        }, 3000)
      }
    }

    ws.onerror = (err) => {
      console.log("⚠️ WS Error", err)
      ws.close()
    }

    ws.onmessage = (ev) => {
      console.log("📩 WS DATA:", ev.data) // 🔥 IMPORTANT DEBUG

      try {
        const msg = JSON.parse(ev.data)

        switch (msg.type) {
          case 'INIT':
            if (msg.instruments) setInstruments(msg.instruments)
            if (msg.quotes) setQuotes(msg.quotes)
            if (msg.signals) setSignals(msg.signals)
            setLoading(false)
            break

          case 'QUOTES':
            setQuotes(prev => ({ ...prev, ...msg.data }))
            break

          case 'SIGNALS':
            setSignals(prev => ({ ...prev, ...msg.data }))
            break

          default:
            console.log("Unknown WS message:", msg)
        }
      } catch (e) {
        console.log("❌ WS Parse Error", e)
      }
    }

  } catch (err) {
    console.log("WS Connection failed", err)
  }
}, [])

  // ── When timeframe changes, fetch signals for that TF ───────────────────
  useEffect(() => {
    fetch(`${API}/api/signals?tf=${timeframe}`)
      .then(r => r.json())
      .then(d => setSignals(s => ({ ...s, ...d })))
      .catch(() => {})
  }, [timeframe])

  // ── Filtered instrument list ────────────────────────────────────────────
  const filtered = instruments.filter(inst => {
    const q = search.toLowerCase()
    if (q && !inst.sym.toLowerCase().includes(q) && !inst.name.toLowerCase().includes(q)) return false
    if (filter === 'ALL') return true
    if (filter === 'BUY'  || filter === 'SELL') return signals[inst.sym]?.direction === filter
    return inst.type === filter
  })

  const selSignal = signals[selected] || null
  const selQuote  = quotes[selected] || null
  const selInst   = instruments.find(i => i.sym === selected)

  // ── Buy/Sell signal counts ────────────────────────────────────────────
  const buyCount  = Object.values(signals).filter(s => s.direction === 'BUY').length
  const sellCount = Object.values(signals).filter(s => s.direction === 'SELL').length

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div style={{ height: 42, background: 'var(--bg2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 14px', gap: 0, flexShrink: 0 }}>
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 24 }}>
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(0,230,118,.15)', border: '1px solid rgba(0,230,118,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📈</div>
          <div>
            <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--bull)', lineHeight: 1 }}>EMA PRO</div>
            <div style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1 }}>9/15 · 30° Strategy</div>
          </div>
        </div>

        {/* Selected symbol info */}
        {selInst && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginRight: 20 }}>
            <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>{selected}</span>
            {selQuote && (
              <>
                <span className="mono" style={{ fontSize: 15, fontWeight: 700 }}>
                  {fp(selQuote.price, selQuote.price < 1 ? 4 : selQuote.price < 100 ? 2 : 0)}
                </span>
                <span className="mono" style={{ fontSize: 12, color: selQuote.changePct >= 0 ? 'var(--bull)' : 'var(--bear)', fontWeight: 700 }}>
                  {pct(selQuote.changePct)}
                </span>
              </>
            )}
          </div>
        )}

        {/* Timeframe selector */}
        <div style={{ display: 'flex', gap: 3, marginRight: 16 }}>
          {TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => setTimeframe(tf)} style={{
              padding: '3px 9px', fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace',
              border: `1px solid ${tf === timeframe ? 'var(--bull)' : 'var(--border)'}`,
              background: tf === timeframe ? 'rgba(0,230,118,.1)' : 'transparent',
              color: tf === timeframe ? 'var(--bull)' : 'var(--muted)',
            }}>{tf}</button>
          ))}
        </div>

        {/* Signal counts */}
        <div style={{ display: 'flex', gap: 8, marginRight: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--bull)' }} />
            <span className="mono" style={{ fontSize: 11, color: 'var(--bull)', fontWeight: 700 }}>{buyCount} BUY</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--bear)' }} />
            <span className="mono" style={{ fontSize: 11, color: 'var(--bear)', fontWeight: 700 }}>{sellCount} SELL</span>
          </div>
        </div>

        {/* WS status */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className={wsOk ? 'pulse' : ''} style={{ width: 7, height: 7, borderRadius: '50%', background: wsOk ? 'var(--bull)' : 'var(--bear)' }} />
          <span className="mono" style={{ fontSize: 9, color: wsOk ? 'var(--bull)' : 'var(--bear)' }}>
            {wsOk ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ── LEFT: Markets list ──────────────────────────────────────────── */}
        <div style={{ width: 220, background: 'var(--bg2)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>

          {/* Search */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              style={{ width: '100%', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, padding: '5px 8px', color: 'var(--text)', fontSize: 11, outline: 'none', fontFamily: 'inherit' }}
            />
          </div>

          {/* Filter tabs */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, padding: '6px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {(['ALL', 'CRYPTO', 'US_STOCK', 'IN_STOCK', 'BUY', 'SELL'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '2px 7px', fontSize: 9, fontWeight: 700, borderRadius: 3, cursor: 'pointer',
                border: `1px solid ${filter === f ? (f === 'BUY' ? 'var(--bull)' : f === 'SELL' ? 'var(--bear)' : 'var(--gold)') : 'var(--border)'}`,
                background: filter === f ? (f === 'BUY' ? 'rgba(0,230,118,.1)' : f === 'SELL' ? 'rgba(255,61,90,.1)' : 'rgba(255,215,64,.08)') : 'transparent',
                color: filter === f ? (f === 'BUY' ? 'var(--bull)' : f === 'SELL' ? 'var(--bear)' : 'var(--gold)') : 'var(--muted)',
              }}>
                {f === 'US_STOCK' ? 'US' : f === 'IN_STOCK' ? 'INDIA' : f}
              </button>
            ))}
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                {error || 'Connecting...'}
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 11 }}>No markets</div>
            ) : filtered.map(inst => (
              <MarketRow
                key={inst.sym}
                inst={inst}
                quote={quotes[inst.sym]}
                signal={signals[inst.sym]}
                isSelected={inst.sym === selected}
                onClick={() => setSelected(inst.sym)}
              />
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '6px 10px', borderTop: '1px solid var(--border)', fontSize: 9, color: 'var(--muted)', flexShrink: 0 }}>
            {filtered.length} markets · EMA 9/15
          </div>
        </div>

        {/* ── CENTER: TradingView Chart ────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          <TradingChart symbol={selected} timeframe={timeframe} signal={selSignal} />
        </div>

        {/* ── RIGHT: Signal Panel ──────────────────────────────────────────── */}
        <div style={{ width: 240, background: 'var(--bg2)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          {/* Panel header */}
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>EMA SIGNAL</div>
            {selInst && <div style={{ fontSize: 10, color: 'var(--text2)' }}>{selInst.name}</div>}
          </div>
          <SignalPanel signal={selSignal} quote={selQuote} />
        </div>
      </div>
    </div>
  )
}

