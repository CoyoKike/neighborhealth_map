/**
 * NeighborHealth resource map — the whole back end.
 *
 * This is a bound Apps Script deployed as a web app. It is the only thing that
 * touches the spreadsheet: the pages on Render hold no credentials and have no
 * access of their own, they just call actions here over HTTPS.
 *
 * It does three jobs:
 *
 *   1. Intake      — the public "list your organization" form posts here and
 *                    the row lands on the Submissions tab, pending. No login.
 *   2. Accounts    — usernames and passwords kept on a Users tab, checked here.
 *                    Nobody needs a Google account.
 *   3. Editing     — the review queue, the team page and the live resource
 *                    list itself, gated on a session token this script issued.
 *
 * ---------------------------------------------------------------------------
 * SETUP
 *
 *   1. Fill in SHEET_ID and NOTIFY below. Save.
 *   2. Run  bootstrap()  once from the editor (pick it in the function
 *      dropdown, press Run). It creates the tabs and prints a first admin
 *      username and password into the execution log. Change that password
 *      once you are signed in.
 *   3. Deploy > New deployment > Web app
 *        Execute as:      Me
 *        Who has access:  Anyone
 *      "Anyone" is what lets a member of the public submit a listing without a
 *      Google account, and what lets your editors sign in with a username. It
 *      does not make the spreadsheet public — every action below decides for
 *      itself whether it needs a session.
 *   4. Paste the /exec url into API_URL in config.js, and into
 *      NH_CONFIG.SUBMIT_URL in index.html.
 *
 * ---------------------------------------------------------------------------
 * ON THE PASSWORDS
 *
 * Stored salted and hashed, never in the clear, and the hash is iterated to
 * make guessing expensive. It is good enough to decide who may edit a staff
 * page. It is not a bank. Tell people not to reuse a password that matters,
 * and keep the spreadsheet shared with as few Google accounts as possible —
 * anyone with edit access to the sheet can read the Users tab directly.
 */

// ---------------------------------------------------------------- config
var SHEET_ID  = 'PUT_THE_SPREADSHEET_ID_HERE';   // the long id in the sheet's URL
var NOTIFY    = 'enriquegpsic@gmail.com';        // told when a listing arrives; blank to turn off

var QUEUE_TAB = 'Submissions';
var LIVE_TAB  = 'Resources';
var TEAM_TAB  = 'Team';
var USERS_TAB = 'Users';

var PHOTO_FOLDER  = 'NeighborHealth team photos';
var SESSION_HOURS = 12;

// Iterating the hash is what makes a stolen Users tab expensive to crack.
// Apps Script is slow, so this is a compromise: high enough to matter, low
// enough that signing in stays under a second. Raising it invalidates nothing —
// the round count is stored with each hash.
var HASH_ROUNDS = 1200;

// Lock an account after this many wrong passwords in a row.
var MAX_FAILS     = 8;
var LOCK_MINUTES  = 15;

var QUEUE_HEADERS = [
  'submitted', 'status', 'name', 'group', 'type', 'street', 'city',
  'state', 'zip', 'phone', 'website', 'hours', 'gender_served', 'age_served',
  'notes', 'submitter_name', 'submitter_email', 'decided', 'decided_by'
];
// The columns a reviewer may change on a pending submission before approving.
var QUEUE_EDITABLE = ['name', 'group', 'type', 'street', 'city', 'state', 'zip', 'phone',
                      'website', 'hours', 'gender_served', 'age_served', 'notes'];
var TEAM_HEADERS  = ['name', 'role', 'bio', 'photo', 'icon', 'color', 'active'];
var USERS_HEADERS = ['username', 'display_name', 'role', 'active',
                     'salt', 'hash', 'rounds', 'created', 'last_login'];

// ------------------------------------------------------------------ entry
function doPost(e) {
  var out;
  try {
    out = route(JSON.parse((e && e.postData && e.postData.contents) || '{}'));
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return json(out);
}

// Nothing to serve — the pages live on Render, not here.
function doGet() {
  return HtmlService.createHtmlOutput(
    '<div style="font:400 16px/1.6 -apple-system,Segoe UI,sans-serif;' +
    'color:#16202b;max-width:460px;margin:14vh auto;text-align:center">' +
    'This is an API endpoint, not a page.</div>'
  );
}

/**
 * Everything above the session check is reachable by anyone with the url.
 * Everything below it needs a token this script issued. Adding an action means
 * deciding, deliberately, which side of that line it goes on.
 */
function route(req) {
  var action = String(req.action || '');

  if (action === 'submit') return actSubmit(req);
  if (action === 'login')  return actLogin(req);

  var user = sessionUser(req.token);
  if (!user) return { ok: false, error: 'Your session has ended. Sign in again.', auth: false };

  switch (action) {
    case 'session':       return { ok: true, user: user };
    case 'logout':        return actLogout(req.token);
    case 'me.password':   return actOwnPassword(user, req);

    case 'team.list':     return actTeamList();
    case 'team.save':     return actTeamSave(req);
    case 'team.add':      return actTeamAdd();
    case 'team.move':     return actTeamMove(req);
    case 'team.delete':   return actTeamDelete(req);
    case 'team.photo':    return actTeamPhoto(req);

    case 'queue.list':    return actQueueList();
    case 'queue.decide':  return actQueueDecide(user, req);

    case 'resources.list':   return actResList();
    case 'resources.save':   return actResSave(req);
    case 'resources.add':    return actResAdd(req);
    case 'resources.delete': return actResDelete(req);

    case 'users.list':    return needAdmin(user) || actUsersList();
    case 'users.save':    return needAdmin(user) || actUsersSave(user, req);
  }
  return { ok: false, error: 'Unknown action: ' + action };
}

function needAdmin(user) {
  return user.role === 'admin' ? null : { ok: false, error: 'That needs an admin account.' };
}

// ---------------------------------------------------------------- intake
function actSubmit(req) {
  if (!req.name || !req.street || !req.city) {
    return { ok: false, error: 'missing required fields' };
  }

  var q = tab(QUEUE_TAB, QUEUE_HEADERS);
  // Written by header name so the tab's column order is free to change.
  q.appendRow(byHeader(headerOf(q), {
    submitted:       new Date(),
    status:          '',            // empty IS pending — see review.html
    name:            str(req.name),
    group:           str(req.group),
    type:            str(req.type),
    street:          str(req.street),
    city:            str(req.city),
    state:           str(req.state) || 'MA',
    zip:             str(req.zip),
    phone:           str(req.phone),
    website:         str(req.website),
    hours:           str(req.hours),
    gender_served:   str(req.gender_served),
    age_served:      str(req.age_served),
    notes:           str(req.notes),
    submitter_name:  str(req.submitter_name),
    submitter_email: str(req.submitter_email)
  }));

  if (NOTIFY) {
    try {
      MailApp.sendEmail({
        to: NOTIFY,
        subject: 'Map listing to review: ' + str(req.name),
        htmlBody: noticeEmail(req)
      });
    } catch (err) {
      // A mail quota problem must not lose the submission, which is already
      // safely on the tab by now.
    }
  }
  return { ok: true };
}

// -------------------------------------------------------------- accounts
function actLogin(req) {
  var username = str(req.username).toLowerCase();
  var password = String(req.password || '');
  if (!username || !password) return { ok: false, error: 'Enter a username and a password.' };

  var locked = lockRemaining(username);
  if (locked > 0) {
    return { ok: false, error: 'Too many wrong passwords. Try again in ' + locked + ' minutes.' };
  }

  var u = tab(USERS_TAB, USERS_HEADERS);
  var head = headerOf(u), rows = dataOf(u);
  var i = indexOfUser(head, rows, username);

  // Hash even when there is no such user, so a wrong username and a wrong
  // password take the same time to come back. Otherwise the timing tells an
  // attacker which usernames are real.
  var rec = i > -1 ? recordOf(head, rows[i]) : { salt: 'x', hash: 'x', rounds: HASH_ROUNDS };
  var ok = i > -1 &&
           String(rec.active).toUpperCase() !== 'FALSE' &&
           hashPassword(password, rec.salt, Number(rec.rounds) || HASH_ROUNDS) === rec.hash;

  if (!ok) {
    noteFailure(username);
    return { ok: false, error: 'That username and password do not match.' };
  }

  clearFailures(username);
  setCell(u, head, i, 'last_login', new Date());

  var user = { username: rec.username, name: rec.display_name || rec.username, role: rec.role || 'editor' };
  return { ok: true, token: newSession(user), user: user };
}

function actLogout(token) {
  props().deleteProperty('sess_' + token);
  return { ok: true };
}

function actOwnPassword(user, req) {
  var current = String(req.current || ''), next = String(req.password || '');
  if (next.length < 10) return { ok: false, error: 'Use at least 10 characters.' };

  var u = tab(USERS_TAB, USERS_HEADERS);
  var head = headerOf(u), rows = dataOf(u);
  var i = indexOfUser(head, rows, user.username);
  if (i < 0) return { ok: false, error: 'That account no longer exists.' };

  var rec = recordOf(head, rows[i]);
  if (hashPassword(current, rec.salt, Number(rec.rounds) || HASH_ROUNDS) !== rec.hash) {
    return { ok: false, error: 'That is not your current password.' };
  }
  writePassword(u, head, i, next);
  return { ok: true };
}

function actUsersList() {
  var u = tab(USERS_TAB, USERS_HEADERS);
  var head = headerOf(u);
  return {
    ok: true,
    users: dataOf(u).map(function (row) {
      var r = recordOf(head, row);
      // The salt and the hash never leave this script.
      return {
        username: r.username, name: r.display_name, role: r.role || 'editor',
        active: String(r.active).toUpperCase() !== 'FALSE',
        created: fmt(r.created), last_login: fmt(r.last_login)
      };
    }).filter(function (r) { return r.username; })
  };
}

function actUsersSave(actor, req) {
  var username = str(req.username).toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    return { ok: false, error: 'Usernames are 3-32 characters: letters, numbers, dot, dash, underscore.' };
  }

  var u = tab(USERS_TAB, USERS_HEADERS);
  var head = headerOf(u), rows = dataOf(u);
  var i = indexOfUser(head, rows, username);
  var isNew = i < 0;

  if (isNew && String(req.password || '').length < 10) {
    return { ok: false, error: 'A new account needs a password of at least 10 characters.' };
  }

  // An admin locking themselves out is a support call with no fix short of
  // the script editor, so refuse the two moves that would do it.
  if (!isNew && username === actor.username) {
    if (req.active === false) return { ok: false, error: 'You cannot deactivate your own account.' };
    if (req.role && req.role !== 'admin') return { ok: false, error: 'You cannot remove your own admin role.' };
  }

  if (isNew) {
    u.appendRow(byHeader(head, {
      username: username,
      display_name: str(req.name) || username,
      role: req.role === 'admin' ? 'admin' : 'editor',
      active: 'TRUE',
      created: new Date()
    }));
    rows = dataOf(u);
    i = indexOfUser(head, rows, username);
  } else {
    setCell(u, head, i, 'display_name', str(req.name) || username);
    if (req.role)  setCell(u, head, i, 'role', req.role === 'admin' ? 'admin' : 'editor');
    if (req.active !== undefined) setCell(u, head, i, 'active', req.active ? 'TRUE' : 'FALSE');
  }

  if (req.password) {
    if (String(req.password).length < 10) return { ok: false, error: 'Use at least 10 characters.' };
    writePassword(u, head, i, String(req.password));
    clearFailures(username);
  }
  if (req.active === false) dropSessionsFor(username);

  return { ok: true };
}

// ------------------------------------------------------------------ team
function actTeamList() {
  var t = tab(TEAM_TAB, TEAM_HEADERS);
  ensureColumns(t, TEAM_HEADERS);
  return { ok: true, head: headerOf(t), rows: dataOf(t) };
}

function actTeamSave(req) {
  var t = tab(TEAM_TAB, TEAM_HEADERS);
  var head = headerOf(t);
  var row = Number(req.row);
  if (!(row >= 2) || row > t.getLastRow()) return { ok: false, error: 'No such row.' };

  var current = t.getRange(row, 1, 1, head.length).getValues()[0];
  // Anything in a column this app does not know about is written back
  // untouched — a save must not blank a column somebody added themselves.
  var vals = head.map(function (h, i) {
    var k = fold(h);
    return Object.prototype.hasOwnProperty.call(req.values || {}, k) ? req.values[k] : current[i];
  });
  t.getRange(row, 1, 1, vals.length).setValues([vals]);
  return { ok: true, values: vals };
}

function actTeamAdd() {
  var t = tab(TEAM_TAB, TEAM_HEADERS);
  var head = headerOf(t);
  var vals = byHeader(head, { active: 'TRUE', icon: 'user' });
  t.appendRow(vals);
  return { ok: true, row: t.getLastRow(), values: vals };
}

/**
 * Swaps a row with its neighbour rather than moving it. A real move needs the
 * tab's numeric sheet id and a different API; the visible result is the same.
 */
function actTeamMove(req) {
  var t = tab(TEAM_TAB, TEAM_HEADERS);
  var head = headerOf(t);
  var a = Number(req.row);
  var b = req.dir === 'up' ? a - 1 : a + 1;
  if (!(a >= 2) || !(b >= 2) || a > t.getLastRow() || b > t.getLastRow()) {
    return { ok: false, error: 'That card is already at the end.' };
  }
  var ra = t.getRange(a, 1, 1, head.length), rb = t.getRange(b, 1, 1, head.length);
  var va = ra.getValues()[0], vb = rb.getValues()[0];
  ra.setValues([vb]);
  rb.setValues([va]);
  return { ok: true };
}

/**
 * Removes a card outright. Hiding a person is what `active` is for -- this is
 * for a position that should never have existed, so it deletes the row and the
 * ones below it shift up. The page reloads its list afterwards rather than
 * trying to renumber in place, because every row index past this one moves.
 *
 * The photo is deliberately left in Drive. It may be the same file another row
 * points at, and an orphaned image costs nothing next to deleting one that is
 * still in use somewhere.
 */
function actTeamDelete(req) {
  var t = tab(TEAM_TAB, TEAM_HEADERS);
  var row = Number(req.row);
  if (!(row >= 2) || row > t.getLastRow()) return { ok: false, error: 'No such row.' };
  if (t.getLastRow() < 2) return { ok: false, error: 'Nothing to remove.' };
  t.deleteRow(row);
  return { ok: true };
}

/**
 * Takes a data: url from the browser, which has already resized the image, and
 * files it in a Drive folder owned by whoever deployed this script. The photo
 * is made link-readable because the public team page has to load it.
 */
function actTeamPhoto(req) {
  var m = /^data:([^;]+);base64,(.+)$/.exec(String(req.dataUrl || ''));
  if (!m) return { ok: false, error: 'That did not arrive as an image.' };

  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > 4 * 1024 * 1024) return { ok: false, error: 'That image is too large.' };

  var blob = Utilities.newBlob(bytes, m[1], str(req.filename) || 'photo.jpg');
  var file = photoFolder().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, id: file.getId() };
}

function photoFolder() {
  var it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
}

// ----------------------------------------------------------------- queue
function actQueueList() {
  var q = tab(QUEUE_TAB, QUEUE_HEADERS);
  ensureColumns(q, QUEUE_HEADERS);
  return { ok: true, head: headerOf(q), rows: dataOf(q) };
}

function actQueueDecide(user, req) {
  var q = tab(QUEUE_TAB, QUEUE_HEADERS);
  var head = headerOf(q);
  var row = Number(req.row);
  if (!(row >= 2) || row > q.getLastRow()) return { ok: false, error: 'No such row.' };

  var current = q.getRange(row, 1, 1, head.length).getValues()[0];
  var rec = recordOf(head, current);
  if (str(rec.status)) return { ok: false, error: 'That one was already ' + rec.status + '.' };

  if (req.decision === 'approved') {
    var lat = Number(req.lat), lng = Number(req.lng);
    if (!isFinite(lat) || !isFinite(lng)) return { ok: false, error: 'No coordinates for that address.' };

    // The reviewer may have corrected the listing on the card. Those edits go
    // back onto the Submissions row first, so the record of what was approved
    // matches what went live. Only the listing's own fields can be changed
    // this way — status, dates and who decided stay the script's business.
    if (req.values) {
      var edits = {};
      QUEUE_EDITABLE.forEach(function (k) {
        var fk = fold(k);
        if (Object.prototype.hasOwnProperty.call(req.values, fk)) edits[fk] = req.values[fk];
      });
      current = mergeValues(head, current, edits);
      q.getRange(row, 1, 1, current.length).setValues([current]);
      rec = recordOf(head, current);
    }
    appendLive(rec, lat, lng);
  } else if (req.decision !== 'rejected') {
    return { ok: false, error: 'Unknown decision.' };
  }

  setCell(q, head, row - 2, 'status', req.decision);
  setCell(q, head, row - 2, 'decided', new Date());
  setCell(q, head, row - 2, 'decided_by', user.username);
  return { ok: true };
}

/**
 * Written by header name, not position, so reordering the live tab cannot
 * silently shift data into the wrong column. Columns the form does not collect
 * stay blank; confidence marks these apart from the scraped rows.
 */
function appendLive(rec, lat, lng) {
  var live = liveTab();
  var head = headerOf(live);
  var vals = byHeader(head, {
    name:          str(rec.name),
    category:      [str(rec.group), str(rec.type)].filter(String).join(' / '),
    street:        str(rec.street),
    city:          str(rec.city),
    state:         str(rec.state) || 'MA',
    zip:           str(rec.zip),
    lat:           lat,
    lng:           lng,
    phone:         str(rec.phone),
    website:       str(rec.website),
    hours:         str(rec.hours),
    notes:         str(rec.notes),
    gender_served: str(rec.gender_served),
    age_served:    str(rec.age_served),
    confidence:    'submitted',
    active:        'TRUE'
  });
  live.appendRow(vals);
  writeLiveRow(live, head, live.getLastRow(), vals);   // zip as text, lat/lng as numbers
}

// ------------------------------------------------------------- resources
//
// The live tab the map publishes, edited in place from resources.html. Unlike
// the queue nothing here is staged: a save is on the public map as soon as
// Google's published-CSV cache turns over, about five minutes.
//
// Row numbers are the handle, as on the team page, so the page reloads after a
// delete. On top of that every save and delete carries `expect`, the name the
// page believes is on that row: if someone else deleted a row above it in the
// meantime the numbers have shifted, and the write is refused rather than
// landing on a different organisation.

function liveTab() {
  var live = book().getSheetByName(LIVE_TAB);
  if (!live) throw new Error('No tab named ' + LIVE_TAB);
  return live;
}

function actResList() {
  var live = liveTab();
  return { ok: true, head: headerOf(live), rows: dataOf(live) };
}

function actResSave(req) {
  var live = liveTab();
  var head = headerOf(live);
  var row = Number(req.row);
  if (!(row >= 2) || row > live.getLastRow()) return { ok: false, error: 'No such row.' };

  var current = live.getRange(row, 1, 1, head.length).getValues()[0];
  var shifted = rowShifted(head, current, req.expect);
  if (shifted) return shifted;

  var vals = mergeValues(head, current, req.values);
  if (!str(vals[colOf(head, 'name')])) return { ok: false, error: 'A resource needs a name.' };
  writeLiveRow(live, head, row, vals);
  return { ok: true, values: vals };
}

function actResAdd(req) {
  var live = liveTab();
  var head = headerOf(live);
  var blank = head.map(function () { return ''; });
  var given = Object.assign({ active: 'TRUE', confidence: 'editor' }, req.values || {});
  var vals = mergeValues(head, blank, given);
  if (!str(vals[colOf(head, 'name')])) return { ok: false, error: 'A resource needs a name.' };

  live.appendRow(vals);
  var row = live.getLastRow();
  writeLiveRow(live, head, row, vals);           // re-write so zip keeps its leading zero
  return { ok: true, row: row, values: vals };
}

function actResDelete(req) {
  var live = liveTab();
  var head = headerOf(live);
  var row = Number(req.row);
  if (!(row >= 2) || row > live.getLastRow()) return { ok: false, error: 'No such row.' };

  var current = live.getRange(row, 1, 1, head.length).getValues()[0];
  var shifted = rowShifted(head, current, req.expect);
  if (shifted) return shifted;

  live.deleteRow(row);
  return { ok: true };
}

/**
 * Anything in a column the page does not know about is written back
 * untouched, same rule as the team page. Keys arrive folded (lower case,
 * punctuation collapsed to spaces) so `gender_served` and `Gender Served`
 * are the same column.
 */
function mergeValues(head, current, values) {
  values = values || {};
  return head.map(function (h, i) {
    var k = fold(h);
    return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : current[i];
  });
}

function rowShifted(head, current, expect) {
  if (expect == null) return null;
  var c = colOf(head, 'name');
  if (c < 0) return null;
  if (str(current[c]) === str(expect)) return null;
  return { ok: false, error: 'That row has changed since the list loaded (it now reads "' +
                             str(current[c]) + '"). Reload and try again.' };
}

/**
 * Sheets turns a ZIP like 02118 into the number 2118 the moment it is written
 * into an automatically formatted cell — the same trap the import notes warn
 * about. Formatting the zip cell as text first keeps the zero. lat and lng go
 * in as numbers so the map's parseFloat has nothing to guess at.
 */
function writeLiveRow(live, head, row, vals) {
  var zc = colOf(head, 'zip');
  if (zc > -1) {
    live.getRange(row, zc + 1).setNumberFormat('@');
    var z = str(vals[zc]);
    if (/^\d{1,4}$/.test(z)) z = ('00000' + z).slice(-5);
    vals[zc] = z;
  }
  ['lat', 'lng'].forEach(function (k) {
    var c = colOf(head, k);
    if (c < 0) return;
    var n = parseFloat(vals[c]);
    vals[c] = isFinite(n) ? n : '';
  });
  live.getRange(row, 1, 1, vals.length).setValues([vals]);
}

// -------------------------------------------------------------- sessions
//
// Sessions live in script properties, not on a tab: they are short-lived, they
// are nobody's business, and they should not be sitting in a spreadsheet
// anyone with edit access can read.
function props() { return PropertiesService.getScriptProperties(); }

function newSession(user) {
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  props().setProperty('sess_' + token, JSON.stringify({
    u: user.username, n: user.name, r: user.role,
    exp: Date.now() + SESSION_HOURS * 3600 * 1000
  }));
  sweepSessions();
  return token;
}

function sessionUser(token) {
  if (!token) return null;
  var raw = props().getProperty('sess_' + String(token));
  if (!raw) return null;
  var s;
  try { s = JSON.parse(raw); } catch (err) { return null; }
  if (!s.exp || s.exp < Date.now()) {
    props().deleteProperty('sess_' + token);
    return null;
  }
  return { username: s.u, name: s.n, role: s.r };
}

function dropSessionsFor(username) {
  var all = props().getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sess_') !== 0) return;
    try { if (JSON.parse(all[k]).u === username) props().deleteProperty(k); } catch (err) {}
  });
}

function sweepSessions() {
  var all = props().getProperties(), now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('sess_') !== 0) return;
    try { if (JSON.parse(all[k]).exp < now) props().deleteProperty(k); }
    catch (err) { props().deleteProperty(k); }
  });
}

// ------------------------------------------------------------- passwords
function hashPassword(password, salt, rounds) {
  var h = String(salt) + '|' + String(password);
  for (var i = 0; i < rounds; i++) {
    h = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  }
  return h;
}

function writePassword(sheet, head, i, password) {
  var salt = Utilities.getUuid();
  setCell(sheet, head, i, 'salt', salt);
  setCell(sheet, head, i, 'rounds', HASH_ROUNDS);
  setCell(sheet, head, i, 'hash', hashPassword(password, salt, HASH_ROUNDS));
}

function lockRemaining(username) {
  var raw = props().getProperty('fail_' + username);
  if (!raw) return 0;
  var f = JSON.parse(raw);
  if (f.n < MAX_FAILS) return 0;
  var left = f.at + LOCK_MINUTES * 60000 - Date.now();
  if (left <= 0) { props().deleteProperty('fail_' + username); return 0; }
  return Math.ceil(left / 60000);
}

function noteFailure(username) {
  var raw = props().getProperty('fail_' + username);
  var f = raw ? JSON.parse(raw) : { n: 0, at: 0 };
  f.n++; f.at = Date.now();
  props().setProperty('fail_' + username, JSON.stringify(f));
}

function clearFailures(username) { props().deleteProperty('fail_' + username); }

// --------------------------------------------------------------- sheets
function book() { return SpreadsheetApp.openById(SHEET_ID); }

function tab(name, headers) {
  var ss = book();
  var s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.appendRow(headers);
    s.setFrozenRows(1);
  } else if (s.getLastRow() === 0) {
    s.appendRow(headers);
    s.setFrozenRows(1);
  }
  return s;
}

function headerOf(sheet) {
  return sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
              .getValues()[0].map(function (h) { return String(h).trim(); });
}

function dataOf(sheet) {
  var n = sheet.getLastRow() - 1;
  if (n < 1) return [];
  return sheet.getRange(2, 1, n, Math.max(1, sheet.getLastColumn())).getValues();
}

/** Adds any missing column on the right rather than writing into the wrong one. */
function ensureColumns(sheet, headers) {
  var head = headerOf(sheet);
  var missing = headers.filter(function (h) { return colOf(head, h) < 0; });
  if (!missing.length) return;
  sheet.getRange(1, head.length + 1, 1, missing.length).setValues([missing]);
}

function fold(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

function colOf(head, want) {
  var w = fold(want), i;
  for (i = 0; i < head.length; i++) if (fold(head[i]) === w) return i;
  for (i = 0; i < head.length; i++) if (fold(head[i]).indexOf(w) === 0) return i;
  return -1;
}

function byHeader(head, values) {
  return head.map(function (h) {
    var k = fold(h);
    return Object.prototype.hasOwnProperty.call(values, k) ? values[k] : '';
  });
}

function recordOf(head, row) {
  var o = {};
  head.forEach(function (h, i) { o[fold(h)] = row[i]; });
  return o;
}

/** i is the 0-based data row, so the sheet row is i + 2. */
function setCell(sheet, head, i, key, value) {
  var c = colOf(head, key);
  if (c < 0) return;
  sheet.getRange(i + 2, c + 1).setValue(value);
}

function indexOfUser(head, rows, username) {
  var c = colOf(head, 'username');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][c]).trim().toLowerCase() === username) return i;
  }
  return -1;
}

// --------------------------------------------------------------- helpers
function str(v) { return v == null ? '' : String(v).trim(); }
function fmt(d) { return d instanceof Date ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : str(d); }

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
                       .setMimeType(ContentService.MimeType.JSON);
}

function noticeEmail(d) {
  var rows = [
    ['Name',     d.name],
    ['Category', [str(d.group), str(d.type)].filter(String).join(' / ')],
    ['Address',  [str(d.street), str(d.city), (str(d.state) || 'MA') + ' ' + str(d.zip)].filter(String).join(', ')],
    ['Phone',    d.phone],
    ['Website',  d.website],
    ['Hours',    d.hours],
    ['Serves',   [str(d.gender_served), str(d.age_served)].filter(String).join(' · ')],
    ['Notes',    d.notes],
    ['Sent by',  [str(d.submitter_name), str(d.submitter_email)].filter(String).join(' — ')]
  ].filter(function (r) { return str(r[1]); });

  var table = rows.map(function (r) {
    return '<tr>' +
      '<td style="padding:5px 14px 5px 0;color:#5a6672;font-size:13px;white-space:nowrap;vertical-align:top">' + esc(r[0]) + '</td>' +
      '<td style="padding:5px 0;font-size:13px;color:#16202b">' + esc(r[1]) + '</td>' +
    '</tr>';
  }).join('');

  return '' +
    '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px">' +
      '<p style="font-size:15px;color:#16202b">Someone asked to be listed on the resource map.</p>' +
      '<table style="border-collapse:collapse;margin:14px 0 22px">' + table + '</table>' +
      '<a href="https://neighborhealth-map.onrender.com/review.html" ' +
         'style="display:inline-block;padding:11px 22px;border-radius:999px;' +
         'font:600 14px/1 -apple-system,Segoe UI,sans-serif;text-decoration:none;' +
         'color:#fff;background:#1c75bc">Open the review queue</a>' +
      '<p style="font-size:12px;color:#8b95a1;margin-top:22px">' +
        'Nothing is on the map until someone approves it there.' +
      '</p>' +
    '</div>';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ------------------------------------------------------------- bootstrap
//
// Run once from the editor. Creating the first admin has to happen somewhere
// no password is required, and the script editor is the only place that is
// already protected by the sheet's own sharing.
function bootstrap() {
  tab(QUEUE_TAB, QUEUE_HEADERS);
  tab(TEAM_TAB,  TEAM_HEADERS);
  var u = tab(USERS_TAB, USERS_HEADERS);
  var head = headerOf(u);

  if (dataOf(u).length) {
    Logger.log('Users tab already has accounts. Nothing changed. ' +
               'Use resetPassword("someone", "a new password") if you are locked out.');
    return;
  }

  var password = Utilities.getUuid().replace(/-/g, '').slice(0, 14);
  u.appendRow(byHeader(head, {
    username: 'admin', display_name: 'Administrator', role: 'admin',
    active: 'TRUE', created: new Date()
  }));
  writePassword(u, head, 0, password);

  Logger.log('Created the first account.\n\n  username: admin\n  password: ' + password +
             '\n\nSign in at review.html or team-edit.html and change it. ' +
             'This password is only shown here, once.');
}

/** For when somebody is locked out. Run from the editor. */
function resetPassword(username, password) {
  if (!username || String(password || '').length < 10) {
    Logger.log('resetPassword("username", "at least 10 characters")');
    return;
  }
  var u = tab(USERS_TAB, USERS_HEADERS);
  var head = headerOf(u), rows = dataOf(u);
  var i = indexOfUser(head, rows, String(username).toLowerCase());
  if (i < 0) { Logger.log('No account called ' + username); return; }
  writePassword(u, head, i, String(password));
  clearFailures(String(username).toLowerCase());
  dropSessionsFor(String(username).toLowerCase());
  Logger.log('Password changed for ' + username + ', and any open session ended.');
}
