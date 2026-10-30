# Kitchen Prep Builder

Interactive camp kitchen prep sheet tool. Set Ridge, Springs and South Mountain headcounts, build each meal from the case-count index, and export printable PDF prep sheets.

Prep = ROUNDUP(meal campers ÷ servings per case). Send to Springs = ROUNDUP(Springs total ÷ servings per case).

## Files

- `index.html` – the live site.
- `preview/index.html` – the next version, for review before it replaces `index.html`.
- `worker/worker.js` – the save relay. It runs on Cloudflare Workers and commits each "Push live" to `data/live.json` on the `live-data` branch, so every version is kept in this repo's history.

## Shared live version

Anyone with the site link can edit. Edits stay on that person's device until they press **Push live** (or turn on **Publish as I edit**). Every push is a commit on the `live-data` branch, and the site's **Version history** panel can load any earlier version so it can be pushed back.

## Links to a specific view

Add tokens after `#`, separated by dots:

- Day: `mon` … `sun`, `today`, or `index`
- Campus: `ridge`, `springs`, `sm` (South Mountain)
- Meals: `breakfast`, `lunch`, `dinner` (any combination)
- `view` for the read-only kitchen view

Example: `…/kitchen-prep/#today.sm.lunch.view`

## Guest menu

- `menu/index.html` – the public, guest-facing menu (Crowders Camps design system). It reads the live version through the relay's `/public` address, which leaves out kitchen notes and case counts and refreshes within about a minute of each Push live.
- Link options: `?camp=ridge`, `?camp=springs` or `?camp=south-mountain`, and `?date=2026-11-14`.
- Brand fonts and logos for the menu live in `menu/assets/`.
