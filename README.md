# NeighborHealth Community Resource Map

A single-file Leaflet map of Massachusetts community resources, embedded into
WordPress via an iframe.

## What is in here

| file | what it is |
|---|---|
| `index.html` | the resource map |
| `team.html` | the "Our People" grid, rendered from the Team tab |
| `review.html` | queue for approving submitted listings |
| `team-edit.html` | editor for the team cards, with photo upload |
| `users.html` | who can sign in |
| `apps-script/Code.gs` | the back end: intake, accounts, and every edit |
| `config.js` | one setting — the api url |
| `api.js`, `signin.js`, `editor.css` | shared by the three signed-in pages |

The three signed-in pages have no access to the spreadsheet of their own. They
post actions to the Apps Script web app, which checks a username and password
against a Users tab and decides what each session may do. Nobody needs a Google
account. Setup is in `apps-script/README.md`; the reasoning is in `NOTES.md`
§5-§7.

## How it updates

Two things change independently — neither needs a WordPress admin.

| what | where | how |
|---|---|---|
| the resources | a published Google Sheet | edit the sheet |
| the map itself | this repo | push to `main` |

**Data.** `index.html` reads a Google Sheet published as CSV
(File > Share > Publish to web > CSV). Edits appear on the map within about
five minutes — that is Google's cache on the published URL, not the map.

When importing a new CSV into the sheet, use File > Import > Upload and turn
**"Convert text to numbers, dates, and formulas" OFF**. Left on, Sheets turns
ZIP `02118` into `2118` and can reformat the lat/lng decimals.

**The map.** Push to `main` and GitHub Pages redeploys. The WordPress iframe
points at a fixed URL, so the page picks the change up on next load.

## Embedding

```html
<iframe src="https://USER.github.io/REPO/"
        style="width:100%;height:820px;border:0"
        title="Community resource map" loading="lazy"></iframe>
```

An iframe cannot auto-size to cross-origin content, so the height is fixed.

## Configuration

Everything configurable is in the `NH_CONFIG` block at the top of `index.html`:
`SHEET_URL`, map centre and zoom, and the geocoder bounding box.

## Data columns

Read by name, so column order does not matter and extra columns are ignored.
`category` is `Group / Subtype` and drives both the two-level filter and the
pin colours — a group with no colour in `GROUP_COLORS` falls back to grey.

`gender_served` and `age_served` drive the "who needs help" filters. A blank
value means "no restriction stated" and passes every filter — it is never
treated as an exclusion.

`confidence` records provenance: `high` (read off a source page), `low`
(inferred), `parsed` (derived from an existing field), `assumed` (filled by
rule, never verified). Populated is not the same as verified.
