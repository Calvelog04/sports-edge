# MintPicks

Find soft sportsbook prices vs a probability model using **live** FanDuel/DraftKings/BetMGM odds, ESPN context, and weather.

## Rules of this app

- **Leagues:** MLB, NFL, NCAAF, NBA, NCAAB, NHL
- **No demo/fake games** — if a league has no upcoming book markets, the slate is empty
- FanDuel has no public API — live lines come from [The Odds API](https://the-odds-api.com)
- **ESPN** — scoreboard/injuries plus team history and player season stats for the model
- **Weather** — Weather Underground (`WU_API_KEY` via api.weather.com) preferred; Open-Meteo fallback

## Setup

```bash
cp .env.example .env.local
```

```env
ODDS_API_KEY=your_odds_key
WU_API_KEY=your_wunderground_key
```

Weather Underground keys are issued to Personal Weather Station owners at
[wunderground.com/member/api-keys](https://www.wunderground.com/member/api-keys).
UI attribution: “Data provided by Weather Underground”.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) (or the port Next prints).

Without `ODDS_API_KEY`, the UI shows a setup message and **zero games**.

## Pages

- `/` — edge list for one pro league
- `/calendar` — month / week calendar of live edges
