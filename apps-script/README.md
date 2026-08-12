# "List your organization" — setup

The button on the map is hidden until `NH_CONFIG.SUBMIT_URL` in `index.html`
has a value. Getting that URL takes about five minutes, once.

## 1. Add the script to the sheet

1. Open the Google Sheet the map reads.
2. **Extensions → Apps Script.**
3. Delete whatever is in `Code.gs` and paste in this folder's `Code.gs`.
4. Fill in the four constants at the top:

   | Constant | What it is |
   |---|---|
   | `SHEET_ID` | the long id in the sheet's URL, between `/d/` and `/edit` |
   | `LIVE_TAB` | the tab the map publishes as CSV — must match exactly |
   | `QUEUE_TAB` | leave as `Submissions`; it gets created on the first entry |
   | `REVIEWER` | who gets the approve email |

5. Save.

## 2. Deploy it

**Deploy → New deployment → Web app**

- Execute as: **Me**
- Who has access: **Anyone**

Google will ask you to authorize it — it needs to edit the sheet and send mail
as you. Copy the `/exec` URL it gives you at the end.

## 3. Turn the button on

In `index.html`, put that URL in `NH_CONFIG`:

```js
SUBMIT_URL: 'https://script.google.com/macros/s/AKfy…/exec'
```

Commit, push, done — the button appears on the next load.

## How it behaves

A submission appends a `pending` row to the **Submissions** tab and emails the
reviewer. The email has **Approve & add** and **Reject**.

Approving geocodes the street address and appends a row to the live tab, keyed
by that tab's own header names — so reordering columns there won't break it.
Rows the map needs but the form doesn't collect (`intake`, `beds`,
`source_url`, the `_note` fields) are left blank; `confidence` is set to
`submitted` so these are easy to tell apart from the scraped rows, and `active`
to `TRUE`.

If the address can't be geocoded nothing is added and the email link says so —
fix the address in the Submissions tab and add the row by hand.

Each link works once. A second click reports the decision already made.

## Known limits

- The map can't read the response to its own POST. Apps Script answers a
  cross-origin POST with a redirect browsers won't expose, so the form shows
  its confirmation optimistically. A submission that fails server-side still
  looks successful to the person who sent it — watch the Submissions tab.
- `MailApp` is capped at 100 recipients/day on consumer accounts. Not a
  realistic ceiling here, but that's the limit.
