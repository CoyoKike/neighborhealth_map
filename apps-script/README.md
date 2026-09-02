# The back end — setup

`Code.gs` is the only thing in this project that touches the spreadsheet.
Deployed as a web app it does three jobs: takes public listing submissions,
checks usernames and passwords, and serves the editor pages their data.

The pages on Render have no access of their own. They post actions here.

## 1. Add the script to the sheet

1. Open the Google Sheet the map reads.
2. **Extensions → Apps Script.**
3. Delete whatever is in `Code.gs` and paste in this folder's `Code.gs`.
4. Fill in the two constants at the top:

   | Constant | What it is |
   |---|---|
   | `SHEET_ID` | the long id in the sheet's URL, between `/d/` and `/edit` |
   | `NOTIFY` | who gets told a listing arrived — blank turns the email off |

   The tab names below them (`Submissions`, `Resources`, `Team`, `Users`) only
   need touching if yours are named differently. `Resources` must match the tab
   the map publishes as CSV.
5. Save.

## 2. Make the first account

Pick **`bootstrap`** in the function dropdown and press **Run**. Google will
ask you to authorize the script — it needs to edit the sheet, put photos in
Drive, and send the notification mail as you.

It creates the tabs it needs and prints a username and password into the
execution log (**View → Logs**):

```
username: admin
password: <14 random characters>
```

**That password is shown once.** Copy it. Sign in with it and change it on
`users.html`, then add the real people.

Locked out later? Run `resetPassword("someone", "a new password")` from the
same editor. That is the only way back in, and it is deliberately behind the
spreadsheet's own sharing.

## 3. Deploy it

**Deploy → New deployment → Web app**

- Execute as: **Me**
- Who has access: **Anyone**

"Anyone" is what lets a member of the public submit a listing, and what lets
your editors reach the sign-in action without a Google account. It does not
make the spreadsheet public — every action decides for itself whether it needs
a session, and everything past sign-in refuses without one.

Copy the `/exec` URL.

> **After any later edit to `Code.gs`, use Deploy → *Manage* deployments and
> edit the existing one.** "New deployment" issues a *different* `/exec` url and
> the pages keep calling the old one, which still runs the old code. This is the
> single most common way this setup breaks.

## 4. Point the pages at it

In `config.js`:

```js
API_URL: 'https://script.google.com/macros/s/AKfy…/exec'
```

and in `index.html`, the same url:

```js
SUBMIT_URL: 'https://script.google.com/macros/s/AKfy…/exec'
```

Commit, push. The **List your organization** button appears on the map, and
`review.html`, `team-edit.html` and `users.html` come to life.

## The actions

| action | needs a session | what it does |
|---|---|---|
| `submit` | no | appends a listing to Submissions with an empty status |
| `login` | no | checks the Users tab, returns a session token |
| `logout`, `session`, `me.password` | yes | the signed-in person's own account |
| `team.list/save/add/move/photo` | yes | the staff cards |
| `queue.list/decide` | yes | the review queue; approving appends to the live tab |
| `users.list/save` | admin | accounts |

## Accounts

The **Users** tab holds `username, display_name, role, active, salt, hash,
rounds, created, last_login`. Two roles: `editor` can review listings and edit
the team page, `admin` can also manage accounts.

Passwords are salted and hashed with SHA-256 iterated `HASH_ROUNDS` times, and
the hash is checked here — it never reaches the browser and neither does the
salt. A login attempt against a username that does not exist is hashed anyway,
so a wrong username and a wrong password take the same time to come back.
Eight wrong passwords in a row locks that username for fifteen minutes.

This is good enough to decide who may edit a staff page. It is not a bank.
**Tell people not to reuse a password that matters** — anyone with edit access
to the spreadsheet can read the Users tab, and the hash rounds are limited by
how slow Apps Script is.

Sessions are kept in script properties, not on a tab, and last 12 hours.
Deactivating an account ends its open sessions immediately.

## Known limits

- The map can't read the reply to its own submission POST — it sends
  `no-cors` and shows its confirmation optimistically, so a submission that
  fails server-side still looks fine to the sender. The notification email is
  how you'd actually notice. The editor pages *do* read replies; they send the
  same `text/plain` body, which is what keeps the browser from trying a
  preflight Apps Script would not answer.
- `MailApp` is capped at 100 recipients/day on consumer accounts.
- Apps Script runs everything as whoever deployed it, so uploaded photos are
  owned by that account's Drive.
