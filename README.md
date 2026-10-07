# Cricket Draft

A live, browser-based cricket auction game for 2–7 friends. The host selects a country, an ODI, T20I, Test, or IPL format, and a shared starting budget from 20 to 100 credits. Everyone bids on the same cricketers and drafts five unique players.

The opening screen explains the **2010+ era**: a player qualifies regardless of debut year if they appeared for their country in the five years before the catalog was built. A player must also have at least five recorded international appearances overall and two in that five-year window. The catalog contains 102 countries and 2,880 cricketers; a country appears in the room selector only when the chosen format has enough eligible players for at least two complete teams. The room-size selector then limits the game to the number that pool can support, up to seven.

Any five-player lineup is legal. When every team is complete, the results reveal a **10% perfect-balance bonus** for exactly two batsmen, two bowlers, and one all-rounder. The bonus is deliberately not shown during the auction. Score ties are broken by credits remaining and then base score; exact ties share a rank.

## Run locally

Requires Node.js 20+ and a browser with internet access for the PeerJS signaling service and web fonts.

```sh
npm run dev
```

Open `http://localhost:3041` in one tab, create a room, and join its link or six-character code from other tabs/devices. The host tab must stay open: it holds the authoritative game state. A disconnected guest may rejoin with the same tab's session token; the auction pauses while a guest is offline.

```sh
npm test
npm run build
```

`npm run build` creates a static `dist/` directory. `vercel.json` is configured to serve it on Vercel; no application server or database is needed after deployment. The local development server binds to `127.0.0.1`, so use a deployment to play across devices that cannot reach the same computer.

## Data and scoring

The checked-in `src/data/catalog.json` is built from [Cricsheet match data](https://cricsheet.org/downloads/) and its [player register](https://cricsheet.org/register/), with some full-name and role corrections for well-known players. Cricsheet data is [openly licensed](https://cricsheet.org/licensing/); retain the attribution in the app when redistributing this project.

Ratings are **Cricket Draft scores, not official ICC rating points or published ICC rankings**. Each format's 1–100 score combines recorded batting and bowling performance (runs, averages, strike rate, wickets, economy, and match volume), then blends 80% of that performance score with 20% of a relative rank percentile in the catalog. All-rounder performance uses both batting and bowling. IPL scoring uses IPL match data but still requires recent international eligibility for the player's selected country. These scores are used only for final results; the player auction card shows name and role, not rating, rank, detailed statistics, or a data-update date.

To refresh the catalog, download Cricsheet's men's T20I, ODI, Test, and IPL JSON ZIPs and its `people.csv` and `names.csv` player-register files into a working directory, naming them `cricket-t20.zip`, `cricket-odi.zip`, `cricket-test.zip`, `cricket-ipl.zip`, `cricket-people.csv`, and `cricket-names.csv`. Then run:

```sh
python3 scripts/build-catalog.py --data-dir /path/to/downloads --as-of YYYY-MM-DD
```

The five-year eligibility window is calculated from `--as-of`; it does not update automatically in a deployed build. Cricsheet coverage is not guaranteed to include every match or country, so smaller format pools may not support a seven-player room.

## Project layout

- `src/game.js`: auction rules and final scoring.
- `src/room.js`: host-authoritative peer-to-peer rooms and reconnects.
- `src/app.js`, `src/styles.css`: responsive interface.
- `src/resultCard.js`: downloadable PNG leaderboard.
- `scripts/build-catalog.py`: catalog generator.
- `tests/game.test.mjs`: game-rule tests.

The stadium hero image in `public/stadium-hero.png` is generated artwork. Player portraits are intentionally not included; player cards use typographic avatars rather than unlicensed photographs.
