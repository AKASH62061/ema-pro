# EMA PRO — 9/15 Strategy Trading Dashboard

Clean, focused trading tool. No paper trading, no option chain.
Just live market prices + EMA 9/15 signals telling you exactly when to enter and exit.

---

## What it does

- **Live prices** — Crypto via Binance (free, no key), US Stocks via Finnhub (free key), Indian stocks via NSE
- **EMA 9/15 signals** — Works on any timeframe you select (1m, 5m, 15m, 1h, 1d)
- **Entry, Stop Loss, Take Profit** shown on the signal panel and chart overlay bar
- **Signal strength** (0–100) based on: angle, confirmation candle, volume, fresh crossover
- **TradingView chart** — Only EMA 9 (green) and EMA 15 (orange) drawn, no clutter
- **Fresh crossover alert** — When EMA9 crosses EMA15 right now, it highlights 🔥

## Strategy Logic

```
BUY  when: EMA9 > EMA15  AND  EMA15 angle ≥ +30°  AND  confirmation candle
SELL when: EMA9 < EMA15  AND  EMA15 angle ≤ -30°  AND  confirmation candle
WAIT when: angle < 30° (sideways, no trade)

Stop Loss:  1.5× ATR below/above entry  (dynamic, adapts to volatility)
Take Profit: 2× risk  (1:2 risk-reward always)

Confirmation candles:
  BUY  → Bullish Engulfing / Hammer / Strong Bull candle
  SELL → Bearish Engulfing / Shooting Star / Strong Bear candle
```

---

## Deploy (GitHub → Vercel + Render)

### Step 1: Get a free Finnhub API key (for US stocks)
1. Go to https://finnhub.io → Sign up → copy your API key
2. Without this key, only crypto works (Binance needs no key)

### Step 2: Push to GitHub
```
git init
git add .
git commit -m "initial"
git remote add origin https://github.com/YOUR_USER/ema-pro.git
git push -u origin main
```

### Step 3: Deploy Backend on Render
1. render.com → New → Web Service → Connect GitHub repo
2. Root Directory: `backend`
3. Build: `npm install && npm run build`
4. Start: `npm start`
5. Environment Variables:
   - `NODE_ENV` = `production`
   - `PORT` = `10000`
   - `FINNHUB_KEY` = your key from step 1
6. Deploy → copy the URL (e.g. `https://ema-pro-backend.onrender.com`)

> ⚠️ Free Render tier sleeps after 15 min. Upgrade to Starter ($7/mo) for always-on.
> Or visit https://your-backend.onrender.com/api/health to wake it manually.

### Step 4: Deploy Frontend on Vercel
1. vercel.com → New Project → Import GitHub repo
2. Root Directory: `frontend`
3. Framework: Vite
4. Environment Variables:
   - `VITE_API_URL` = `https://ema-pro-backend.onrender.com`  (your Render URL)
   - `VITE_WS_URL`  = `wss://ema-pro-backend.onrender.com/ws`
5. Deploy → done!

### Every future update:
```
git add . && git commit -m "update" && git push
```
Vercel and Render both auto-redeploy on push.

---

## Local Development

```bash
# Install everything
npm run install:all

# Run both backend + frontend together
npm run dev

# Frontend: http://localhost:5173
# Backend:  http://localhost:3001
# Health:   http://localhost:3001/api/health
```

---

## Data sources

| Market | Source | Key needed? |
|--------|---------|-------------|
| Crypto (BTC, ETH, SOL...) | Binance public API | ❌ No |
| US Stocks (AAPL, NVDA...) | Finnhub free tier | ✅ Free key |
| Indian stocks (NSE) | NSE public endpoint | ❌ No (may rate-limit) |
