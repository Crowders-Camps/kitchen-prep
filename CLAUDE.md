# Kitchen Prep Builder — notes for Claude

Crowders Camps' kitchen prep sheet tool and guest-facing menu. Static pages on GitHub Pages, saved data in this repo, a Cloudflare Worker in between. No build step.

## Layout
- `index.html` — the live prep tool (crowders-camps.github.io/kitchen-prep/). One self-contained file: HTML, CSS, JS.
- `preview/index.html` — next version of the prep tool. Change this first; copy over `index.html` only after the owner approves.
- `menu/index.html` — guest menu (Crowders Camps design system), embedded on Squarespace via iframe. Reads the relay's `/public` feed, falls back to `/live`.
- `worker/worker.js` + `wrangler.jsonc` — the save relay (Cloudflare Worker `kitchen-prep`, https://kitchen-prep.nate-5ff.workers.dev). Cloudflare builds it from `main`.
- Branch `live-data`, file `data/live.json` — every Push live is a commit here. Never edit by hand; use the site's Version history to roll back.

## Data model (live.json `state`)
- `catalog` — the index: `{id, cbi, name, spc (servings per case), unit CS|PAN, size, meal, al[egg,dairy,gluten,sesame,soy], veg, vegan, retired}`.
- `menus` — keyed `"YYYY-MM-DD MEAL"`; lines `{ref (catalog id|null), name, note, gf (allergy prep), ov (prep override, e.g. AS NEEDED)}`.
- `serve`, `loc`, `mealCount`, `off`, `mt` — per-meal campus, kitchen, camper override, off switch, per-campus `{time, note}`.
- `counts` — rg/rs (Ridge campers/staff), sg/ss (Springs), mg/ms (South Mountain), gfr/gfs/gfm.
- `templates` — meal templates `{id, name, meal, lines}`; absent until first edited (page falls back to `STARTER_TEMPLATES`).
- `inv` — Inventory mode; absent until first edited. `c.RIDGE|SPRINGS|SM = {locs:[{id,name,items:[key]}], stock:{key:number}}`, one independent set per campus. `log:[{at, by, c, n (items counted), of (items listed), ch (counts changed)}]`, capped at 400. An item `key` is the index name without its day prefix, uppercased (`(FRIDAY) BACON` → `BACON`), so duplicate index rows count as one product. Every Push live from inventory mode adds a log entry for the campus shown. Never sent to the guest `/public` feed.
- Pushing: when a newer live version arrives, the page merges it with unpublished changes if they touch different parts (each top-level field, each campus's inventory; logs are combined). Only overlapping edits show the conflict choice.

## Rules that must not change
- Prep = ROUNDUP(meal campers ÷ servings per case); To Springs = ROUNDUP(Springs total ÷ servings per case). No servings = AS NEEDED.
- The guest menu shows only items, allergens/diet and meal times — never kitchen notes or counts.
- No camper or staff personal information anywhere in this repo (it is public).
- Kitchens are peanut, tree nut, shellfish and seafood free; that statement stays on the guest menu.

## Testing
Open the page with Playwright, routing `https://kitchen-prep.nate-5ff.workers.dev/**` to a fake relay that serves a copy of `live.json`, so tests never push to the real live version.
