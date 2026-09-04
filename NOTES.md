# NeighborHealth resource map — where things stand

Written 2026-08-12. Everything here is the state at the end of that session.

---

## 1. What this repo is

One static site, deployed two ways:

| File | What it is | Live at |
|---|---|---|
| `index.html` | the resource map (Leaflet + clustering) | `https://neighborhealth-map.onrender.com/` |
| `team.html` | "Our People" team grid, sheet-driven | `…/team.html` |
| `review.html` | approval queue for map listings — §5 | `…/review.html` |
| `team-edit.html` | editor for the team cards — §6 | `…/team-edit.html` |
| `users.html` | who can sign in — §7 | `…/users.html` |
| `config.js` | one setting: the api url | — |
| `api.js` | posts actions to the Apps Script | — |
| `signin.js` | the sign-in card, shared by the three editor pages | — |
| `editor.css` | shared chrome for the three editor pages | — |
| `apps-script/Code.gs` | **the entire back end** — §5 | — |

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

~~**Team photos.**~~ Done — see §6. The three options considered here
(paste Media Library urls, rebuild as a TablePress table, sheet-driven
`team.html`) came down to the third, with a signed-in editor page on top so
nobody edits a sheet by hand either.

## 5. Submissions, accounts and approval

The goal: a **List your organization** button on the map, submissions queue up,
somebody signs in and approves, approved ones land in the Google Sheet the map
reads.

**Written, not yet deployed.** The shape it settled into:

| Piece | Where | What it does |
|---|---|---|
| the form | `index.html`, the existing modal | our own HTML form. POSTs JSON to the api. |
| **the api** | `apps-script/Code.gs` | the only thing that touches the spreadsheet. Public actions: submit a listing, sign in. Everything else needs a session token it issued. |
| the review page | `review.html` | lists pending rows, geocodes in the browser, asks the api to approve |
| the accounts page | `users.html` | admin-only; add people, reset passwords, deactivate |

### Two dead ends, so nobody re-walks them

**Google Forms for intake.** Considered and dropped: hunting `entry.NNN` ids
out of View Source, and a form whose look we don't control, for no gain over a
five-minute Apps Script deploy.

**Google sign-in for the editors.** Built first, then replaced. It required
every editor to have a Google account *on the spreadsheet*, plus a Google Cloud
project and an OAuth client id, and it made "who can edit" the same question as
"who can open the sheet". The ask was plain usernames. That needs something
server-side to check them — a static page cannot, and anything client-side is
theatre — and Apps Script was already there and *is* a server. Doing it this way
also deleted the entire Google Cloud setup step.

### What still has to be done by hand

1. Paste `Code.gs` into the sheet's Apps Script, fill in `SHEET_ID` and
   `NOTIFY`, **run `bootstrap()` once** (it prints a first admin password into
   the log, shown once), then Deploy → Web app, *Execute as: Me*,
   *Who has access: Anyone*.
2. Put the `/exec` url in `config.js` (`API_URL`) and in `index.html`
   (`NH_CONFIG.SUBMIT_URL`) — same url, both places.
3. Push. Sign in, change the admin password on `users.html`, add the real
   people.

Full steps and the action list: `apps-script/README.md`.

### Details worth knowing before touching it

- **After editing `Code.gs`, redeploy via Deploy → *Manage* deployments.**
  "New deployment" mints a different `/exec` url; the pages keep calling the old
  one, which quietly keeps running the old code. This is the most likely way
  this whole thing appears broken.
- **Requests go as `text/plain`.** That is one of the three content types a
  browser sends cross-origin without a preflight, and Apps Script does not
  answer preflights. The body is still JSON — the header is about the browser,
  not the payload. Switching it to `application/json` breaks every editor page.
- **Pending means an empty `status` cell.** New rows are written with `status`
  blank on purpose — don't "improve" Code.gs to write `pending` there, the
  review page would filter it straight back out. Clearing a `status` cell by
  hand puts a row back in the queue.
- **Passwords**: salted, SHA-256 iterated `HASH_ROUNDS` times, checked in the
  script. Failed logins lock a username for 15 minutes after 8 tries. A missing
  username is hashed anyway so the timing doesn't reveal which names are real.
  Good enough to gate editing a staff page; not a bank. Anyone with edit access
  to the spreadsheet can read the Users tab.
- **The role check is on the server.** `users.html` hides its link from
  non-admins, but that is a convenience — `users.list` and `users.save` refuse
  a non-admin token regardless of what the page shows.
- **Approving is written by header name, not position**, so reordering the live
  tab's columns can't silently shift data. Columns the form doesn't collect
  stay blank, `confidence` is `submitted`, `active` is `TRUE`.
- **Geocoding happens in the browser**, not the script, so the reviewer sees a
  miss and can correct the address on the card before anything is written.
  `prepare()` in the map drops any row without `lat`/`lng`.
- The map still can't read the reply to its own POST (it sends `no-cors`), so
  the public form's confirmation is optimistic. The notification email is how a
  server-side failure actually gets noticed.

## 6. The team page

`team.html` used to be eight hardcoded cards with a "how to fill this in"
comment. It now renders from a **Team** tab on the same spreadsheet — one row
per card, in the order the rows sit in — and `team-edit.html` is where a
signed-in person edits them.

| Column | What it is |
|---|---|
| `name` | shown under the photo |
| `role` | the position title, small caps under the name |
| `bio` | one or two sentences; blank is fine, the card just ends |
| `photo` | a Drive file id, or a full url if someone pastes one |
| `icon` | which badge sits on the photo — one of `user stetho cross chat hands heart compass leaf clip` |
| `active` | `FALSE` hides the card without deleting the row; blank means showing |

`team-edit.html` does titles, bios, photo upload, add a position, reorder, and
hide. Setup is the same `API_URL` as the review page, plus publishing the Team
tab as CSV (File → Share → Publish to web → Team → CSV) and pasting that url
into `TEAM_CONFIG.SHEET_URL` in `team.html`. Note the asymmetry, it's
deliberate: the **public** page reads a published CSV so it needs nothing and
nobody, while **editing** goes through the api.

### Things that will bite otherwise

- **A published CSV is cached by Google for about five minutes.** An edit is
  not instant on the site. This looks exactly like a broken save; it isn't.
- **`team.html` falls back to the eight placeholder cards** if `SHEET_URL` is
  blank, the fetch fails, or the tab has a header and nothing else. An empty
  grid is never what anyone meant, so it keeps whatever is on screen. That also
  means "my changes aren't showing" can mean "the fetch failed", not "the sheet
  is wrong" — check the console.
- **Photos go to Drive, not the sheet.** The browser resizes the image and
  hands the api a `data:` url; `Code.gs` decodes it, files it in a folder called
  *NeighborHealth team photos*, and makes it link-readable because the public
  page has to load it. The folder and the files belong to whoever deployed the
  script — not to whoever uploaded them.
- **What's stored is a file id, not a link.** `team.html` builds
  `drive.google.com/thumbnail?id=…&sz=w400` from it. The `/uc?id=` and
  `/file/d/` forms redirect through a consent page for some accounts and render
  as a broken image — don't "fix" the code to use them.
- **Uploads are resized in the browser to 800px JPEG before they leave.** The
  card renders at ~118px; a 5 MB phone photo would only make every visitor's
  load slower.
- **Reordering swaps two rows' contents**, it does not move a row. A real row
  move needs the tab's numeric `sheetId`, and nothing else here needs that id.
  The visible effect is the same. The page reloads after a move because every
  card carries its sheet row number and two of them just changed.
- **The card colours are not in the sheet.** Eight hand-picked ring/fill/pip
  triples cycle by position in `team.html`. A ninth card starts the cycle over.
  This was deliberate — eight more columns to fill in wrong was the alternative.
- Saving a card writes the whole row but **preserves any column this page
  doesn't know about**, so an extra column someone adds for their own notes
  survives.

---

## 7. Accounts

`users.html`, admin only. Add someone, rename them, switch editor/admin,
deactivate, reset a password; plus a "change your own password" card everyone
sees.

- The first admin comes from `bootstrap()` in the Apps Script editor, which
  prints a random password into the execution log **once**. Creating the first
  account has to happen somewhere no password is required, and the script
  editor is the only place already protected by the sheet's own sharing.
- `resetPassword("someone", "a new password")` in the same editor is the way
  back in if everyone is locked out.
- An admin cannot deactivate themselves or drop their own admin role — both
  are one click from a support call with no fix except the script editor.
- Deactivating someone ends their open sessions immediately; so does changing
  their password.
- Passwords are given to people directly. Nothing is emailed, and no account
  is tied to an email address at all.

## 8. Pin colours and the category renames (2026-09-04)

The team asked for pins that match the brand. `GROUP_COLORS` now uses the
January 2024 style guide palette, except Recovery, which keeps its original
violet `#6a4fa3` by request (the brand's Eggplant read too dark). Senior Services is Warm Blue `#50a7ef`, Health is Cobalt
`#1e64af`, Shelter is Salmon, Food is Sunshine, Community Services is
Periwinkle, Mental Health is Forest, MAT is Charcoal. The pale tints (Sky,
Liliac, Pale Pink) are deliberately unused — too light for a pin.

**"Older Adults" is shown as "Senior Services" and "Addiction & Recovery" as
"Recovery Services"** without touching the sheet. `GROUP_ALIASES` in
`index.html` renames the groups at load, so the 345 Council on Aging rows
still say `Older Adults / Council on Aging`, the 457 recovery rows still say
`Addiction & Recovery / …`, and both render fine. The submission form lists `GROUP_COLORS` keys, so new listings arrive
as `Senior Services / …`; both spellings land in the same group. If someone
later bulk-renames the sheet column, nothing breaks — the alias just stops
matching anything.

## 9. The resources editor (2026-09-04)

`resources.html` is the fourth signed-in page: the whole Resources tab,
searchable, with an editor card for one row at a time. Add, edit, delete.
Back end is `resources.list/save/add/delete` in `Code.gs`, which **has to be
redeployed** (Deploy -> Manage deployments -> edit -> new version) before the
page does anything but sign in.

Things worth knowing:

- **The form is built from the sheet's header row.** Known columns get a
  proper control (category picker, textareas, the coordinates finder); any
  column the page has never heard of shows up under "Other columns" as a text
  box, and a save writes back every column it did not touch. Adding a column
  to the sheet needs no code change here.
- **Row numbers are the handle, with a guard.** Every save and delete sends
  `expect`, the name the page saw on that row. If someone else deleted a row
  above it in the meantime, the server sees a different name and refuses
  instead of overwriting the wrong organisation. The page reloads after every
  delete for the same reason.
- **The category picker writes the new names** (Recovery Services, Senior
  Services). It does not rewrite an existing row's older spelling unless the
  category is actually changed, so opening and saving a row is not a mass
  rename. The map shows both spellings under the new label anyway.
- **Coordinates.** Saving a row that has an address but no lat/lng geocodes it
  first (Nominatim, same as the map). A row still without coordinates is saved
  but flagged "No pin" in the list, and the status filter can find them all.
- **ZIPs keep their leading zero.** `writeLiveRow` formats the zip cell as
  text before writing, which is the same trap the import notes in section 1
  warn about, fixed at the source.
- Editors and admins both get the page. Accounts stay admin-only.
