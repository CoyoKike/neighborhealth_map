# NeighborHealth resource map — where things stand

Written 2026-08-12. Everything here is the state at the end of that session.

---

## 1. What this repo is

One static site, deployed two ways:

| File | What it is | Live at |
|---|---|---|
| `index.html` | the resource map (Leaflet + clustering) | `https://neighborhealth-map.onrender.com/` |
| `team.html` | "Our People" team grid, 8 placeholder cards | `https://neighborhealth-map.onrender.com/team.html` |
| `apps-script/` | an approval backend we **decided not to use** — see §5 | — |

Pushing to `main` on `github.com/CoyoKike/neighborhealth_map` auto-deploys to
Render. GitHub Pages serves the same repo.

Data is **not** in this repo. `index.html` fetches a published Google Sheet CSV
at load — the URL is `NH_CONFIG.SHEET_URL` at the top of the file. Editing the
sheet changes the map with no push.

### Unpushed work

`a4e2e30` (the submission form) was committed but **not pushed**. It's inert
either way — the button hides itself until `NH_CONFIG.SUBMIT_URL` is set — but
see §5 before pushing it, because we changed direction on how that should work.

```
cd C:\Users\eponce\repos\neighborhealth-map
git push origin main
```

---

## 2. Changes made this session

**Category colours.** `GROUP_COLORS` in `index.html`. Addiction & Recovery was
the same blue as the site accent so it read as "uncategorised" — now violet
`#6a4fa3`. Community Services moved off plum to slate blue `#3a6ea5` to stay
distinct from it.

**Cluster bubbles** took their colour from the pins they contain instead of a
hardcoded blue. Markers carry `nhColor`; `iconCreateFunction` uses whichever
category the cluster holds most of. Filtered to one category — how people
actually use it — that's exactly the pin colour.

**Two categories were rendering grey.** `GROUP_COLORS` keyed `Healthcare`, but
the sheet says `Health`, and `Older Adults` had no entry at all — so every
community health centre and every Council on Aging fell through to the `#5a6672`
fallback. That's most of the directory. Health is now teal, Older Adults burnt
orange `#c2661c`.

**A blank band above the map and a scrollbar** turned out to be one bug: the
icon-sprite `<svg class="sr">` sits *outside* `<div class="nh">`, but the
visually-hidden rule was scoped `.nh .sr`, so it never matched. The sprite
rendered at an SVG's default 300×150 and pushed the whole app down. Selector is
now just `.sr`. Only obvious once embedded in an iframe.

**The floating List/Map pill is gone.** It swapped the map out from under you.
Narrow layouts (`@container max-width: 880px`) now keep the map and dock a
**Show list / Hide list** bar under it that expands the results to 300px.

**`team.html` is new.** Static, 8 role cards, photo placeholders. Fill it in by
editing the file — see the comment block at the top. Not yet wired to anything.

---

## 3. Embedding into WordPress — the part that took all day

The WordPress account is **Editor level**, not admin: no Plugins, Appearance,
Settings, or Users menus. That constrains everything below.

### The theme strips iframes

The page body is ACF Flexible Content ("Content Bands"). Of ~17 band types only
**`WYSIWYG Band / Visual Editor`** takes free-form HTML — the rest are fixed
fields. But pasting an `<iframe>` into it doesn't work: the tag is in the
database and in the editor, and gone from the rendered HTML. Something in the
theme or a security plugin filters it on output. Not fixable from this account.

### The workaround that does work: TablePress

TablePress prints cell contents itself, so it never passes through that filter.

1. **TablePress → Add New Table**, 1 row × 1 column.
2. Put the iframe in the single cell, **on one line, with no newline after it**
   (a trailing newline becomes a literal `<br>` under the map).
3. **Table Options → Table Header: `0`** rows. Left at 1, the cell renders as a
   `<th>` and the theme paints header cells brand blue — that was the "blue
   frame" around the map.
4. Uncheck **Enable Visitor Features** (kills the search box and
   "50 entries per page" dropdown), plus Alternating Row Colors and Row Hover
   Highlighting.
5. Copy the shortcode (`[table id=2 /]`) and paste **that** into the WYSIWYG
   band's **Text** tab — not Visual. Visual entity-escapes it and the code
   prints as literal text on the page.

The map is table **id=2**.

```html
<iframe src="https://neighborhealth-map.onrender.com/" title="NeighborHealth community resource map" loading="lazy" style="width:100%;height:80vh;min-height:560px;border:0;border-radius:12px;display:block"></iframe>
```

For the team page, same recipe with a new table and a taller fixed height,
since that page's content doesn't fill a viewport:

```html
<iframe src="https://neighborhealth-map.onrender.com/team.html" title="Our people" loading="lazy" style="width:100%;height:1250px;border:0;display:block"></iframe>
```

### The sidebar Menu is tabs

On the Recovery Services page the "Menu" in the right sidebar (Intro to Recovery
Services / Model of care / Services / … / Resources / Locations / Contact us) is
a set of `tab-pane` divs. **A band renders into whichever pane it sits in**, and
inactive panes are `display:none`.

This cost about an hour: a band placed after the `Resources` band was invisible
because the *Intro* tab was the one open. It was in the right place the whole
time. If a band "doesn't render", click through the Menu before assuming
anything is broken.

Diagnostic that found it, pasted in the browser console (Chrome needs you to
type `allow pasting` first):

```js
const f=document.querySelector('iframe[src*="onrender"]');console.log(f.getBoundingClientRect());let p=f;while(p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||!p.offsetHeight)console.log(p.className||p.tagName,s.display,s.visibility,p.offsetHeight)}
```

### Other things worth knowing

- The **Edit** link under the table is TablePress showing it to logged-in users
  who can edit that table. The public never sees it.
- `www.neighborhealth.com` sends `permissions-policy: geolocation=(self)`, so
  the map's "use my location" button can't work inside the iframe — a parent
  can't delegate what the header withholds. Address search is unaffected. This
  turned out not to matter; noted so nobody re-investigates it.
- CSP is `default-src … *`, so cross-origin framing is allowed. Not a problem.
- The site's REST API returns `401 rest_authentication_error` to anonymous
  requests — it's locked down, so nothing public can read WordPress data.

---

## 4. Known-but-unfixed

**The legend is hidden in the embed.** `.nh-legend` is `display:none` under
880px, and the WordPress content column is ~700px, so the map runs in compact
mode and nobody sees which colour means what. After a day spent on those
colours, that's worth fixing — either show the legend in compact mode, or put
the map in a full-width band instead of the sidebar template.

**Team photos.** The team wants to upload photos in WordPress and have
`team.html` pick them up. Nothing links the two yet. Options discussed:

- Paste Media Library URLs into `team.html` — works, but requires a push per
  change and someone comfortable editing HTML. Rejected.
- Rebuild the section as a TablePress table so the Media picker does it — works
  and is no-code, but loses the card design. Rejected.
- Sheet-driven `team.html`, same pattern as the map. Not decided.

---

## 5. Submissions and approval — direction changed, nothing built yet

The goal: a **List your organization** button on the map, submissions get
reviewed, approved ones land in the Google Sheet the map reads.

### What's in the repo now (commit `a4e2e30`, unpushed)

- A toolbar button + modal form in `index.html`, hidden unless
  `NH_CONFIG.SUBMIT_URL` is set.
- `apps-script/Code.gs` — a Google Apps Script web app that queues submissions
  and emails Approve/Reject links, geocoding on approve.

**The form UI is worth keeping. The Apps Script approach was dropped.**

### What we decided instead

Keep everything static on Render. Both halves are plain HTTP from the browser,
no server and nothing secret in the HTML:

1. **Submissions** POST directly to a **Google Form**'s `formResponse` URL.
   Anonymous, no credentials, answers land in the Form's linked sheet.
2. **Approval** is a new page, roughly `/review.html`, using Google Sign-In.
   The reviewer signs in with their own Google account and the browser calls the
   Sheets API with *their* token to read pending rows and append approved ones.
   Access control is just who the sheet is shared with — Google enforces it.

I had claimed a static page couldn't do this. That was wrong; the browser-side
OAuth path works and needs no backend.

### Next steps, in order

1. **Create the Google Form** with the listing fields (organisation name,
   category, service type, street, city, ZIP, phone, website, hours, who it
   serves, ages served, description, submitter name, submitter email). Then grab
   its `formResponse` URL and the `entry.NNNNN` id for each field — those get
   hardcoded into `index.html`.
2. **Create an OAuth Client ID** (Google Cloud → Credentials → Web application)
   with the Render origin as an authorised JavaScript origin. The client ID is
   public and safe to commit.
3. Rewire the modal's submit handler from `SUBMIT_URL` to the Form endpoint.
4. Build `review.html`.
5. Approved rows need `lat`/`lng` — `prepare()` drops any row without them. The
   Apps Script geocoded on approve; the review page will need to do the same,
   via `NH_CONFIG.GEOCODE_URL` (Nominatim), before it appends.

`apps-script/` can be deleted once the new path works. It's left in place
because it's a complete, working fallback if the client-side route stalls.
