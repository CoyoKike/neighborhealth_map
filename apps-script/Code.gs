/**
 * NeighborHealth resource map — "list your organization" intake.
 *
 * Flow:
 *   1. The map POSTs a submission here.               -> doPost
 *   2. The row lands in the Submissions tab, pending, and the reviewer
 *      gets an email with Approve / Reject links.
 *   3. Approve geocodes the address and appends the row to the live tab
 *      the map publishes, so it shows up on the next load.  -> doGet
 *
 * Fill in the four constants below, then Deploy > New deployment >
 * Web app, "Execute as: Me", "Who has access: Anyone". Paste the /exec URL
 * into NH_CONFIG.SUBMIT_URL in index.html.
 */

// ---------------------------------------------------------------- config
var SHEET_ID  = 'PUT_THE_SPREADSHEET_ID_HERE';   // the long id in the sheet's URL
var LIVE_TAB  = 'Resources';                     // tab the map publishes as CSV
var QUEUE_TAB = 'Submissions';                   // created automatically
var REVIEWER  = 'enriquegpsic@gmail.com';

// Queue columns, in order. Only edit if you also update rowToRecord().
var QUEUE_HEADERS = [
  'submitted', 'status', 'token', 'name', 'group', 'type', 'street', 'city',
  'state', 'zip', 'phone', 'website', 'hours', 'gender_served', 'age_served',
  'notes', 'submitter_name', 'submitter_email', 'decided'
];

// ---------------------------------------------------------------- intake
function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);

    if (!d.name || !d.street || !d.city) return json({ ok: false, error: 'missing required fields' });

    var q = queueSheet();
    var token = Utilities.getUuid();

    q.appendRow([
      new Date(), 'pending', token,
      str(d.name), str(d.group), str(d.type), str(d.street), str(d.city),
      str(d.state) || 'MA', str(d.zip), str(d.phone), str(d.website), str(d.hours),
      str(d.gender_served), str(d.age_served), str(d.notes),
      str(d.submitter_name), str(d.submitter_email), ''
    ]);

    MailApp.sendEmail({
      to: REVIEWER,
      subject: 'Map listing to review: ' + str(d.name),
      htmlBody: reviewEmail(d, token)
    });

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// ------------------------------------------------------------- decisions
function doGet(e) {
  var action = (e.parameter.action || '').toLowerCase();
  var token  = e.parameter.token || '';
  if (action !== 'approve' && action !== 'reject') return page('Nothing to do here.');
  if (!token) return page('That link is missing its token.');

  var q = queueSheet();
  var values = q.getDataRange().getValues();
  var head = values[0];
  var tokenCol = head.indexOf('token');
  var statusCol = head.indexOf('status');

  for (var r = 1; r < values.length; r++) {
    if (values[r][tokenCol] !== token) continue;

    var current = values[r][statusCol];
    if (current !== 'pending') {
      return page('Already ' + current + '. Nothing changed.');
    }

    var rec = rowToRecord(head, values[r]);

    if (action === 'reject') {
      q.getRange(r + 1, statusCol + 1).setValue('rejected');
      q.getRange(r + 1, head.indexOf('decided') + 1).setValue(new Date());
      return page('Rejected — "' + rec.name + '" was not added.');
    }

    var point = geocode(rec);
    if (!point) {
      return page('Could not find coordinates for that address, so nothing was added. ' +
                  'Fix the address in the Submissions tab and add the row by hand.');
    }

    appendToLive(rec, point);
    q.getRange(r + 1, statusCol + 1).setValue('approved');
    q.getRange(r + 1, head.indexOf('decided') + 1).setValue(new Date());
    return page('Approved — "' + rec.name + '" is on the map.');
  }

  return page('No submission matches that link.');
}

// --------------------------------------------------------------- helpers
function queueSheet() {
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var q = ss.getSheetByName(QUEUE_TAB);
  if (!q) {
    q = ss.insertSheet(QUEUE_TAB);
    q.appendRow(QUEUE_HEADERS);
    q.setFrozenRows(1);
  } else if (q.getLastRow() === 0) {
    q.appendRow(QUEUE_HEADERS);
    q.setFrozenRows(1);
  }
  return q;
}

function rowToRecord(head, row) {
  var o = {};
  head.forEach(function (h, i) { o[String(h).trim()] = row[i]; });
  return o;
}

function fullAddress(rec) {
  return [rec.street, rec.city, ((rec.state || 'MA') + ' ' + (rec.zip || '')).trim()]
           .filter(String).join(', ');
}

function geocode(rec) {
  try {
    var res = Maps.newGeocoder().setRegion('us').geocode(fullAddress(rec));
    if (!res || res.status !== 'OK' || !res.results.length) return null;
    var loc = res.results[0].geometry.location;
    return { lat: loc.lat, lng: loc.lng };
  } catch (err) {
    return null;
  }
}

/**
 * Written by header name, not position — the live tab's column order can
 * change without breaking this, and any column we don't know stays blank.
 */
function appendToLive(rec, point) {
  var live = SpreadsheetApp.openById(SHEET_ID).getSheetByName(LIVE_TAB);
  if (!live) throw new Error('No tab named ' + LIVE_TAB);

  var head = live.getRange(1, 1, 1, live.getLastColumn()).getValues()[0];

  var vals = {
    name:          rec.name,
    category:      [rec.group, rec.type].filter(String).join(' / '),
    street:        rec.street,
    city:          rec.city,
    state:         rec.state || 'MA',
    zip:           rec.zip,
    lat:           point.lat,
    lng:           point.lng,
    phone:         rec.phone,
    website:       rec.website,
    hours:         rec.hours,
    notes:         rec.notes,
    gender_served: rec.gender_served,
    age_served:    rec.age_served,
    confidence:    'submitted',
    active:        'TRUE'
  };

  live.appendRow(head.map(function (h) {
    var k = String(h).trim();
    return vals.hasOwnProperty(k) ? vals[k] : '';
  }));
}

function reviewEmail(d, token) {
  var base = ScriptApp.getService().getUrl();
  var rows = [
    ['Name',      d.name],
    ['Category',  [d.group, d.type].filter(String).join(' / ')],
    ['Address',   fullAddress(d)],
    ['Phone',     d.phone],
    ['Website',   d.website],
    ['Hours',     d.hours],
    ['Serves',    [d.gender_served, d.age_served].filter(String).join(' · ')],
    ['Notes',     d.notes],
    ['Sent by',   [d.submitter_name, d.submitter_email].filter(String).join(' — ')]
  ].filter(function (r) { return r[1]; });

  var table = rows.map(function (r) {
    return '<tr>' +
      '<td style="padding:5px 14px 5px 0;color:#5a6672;font-size:13px;white-space:nowrap;vertical-align:top">' + esc(r[0]) + '</td>' +
      '<td style="padding:5px 0;font-size:13px;color:#16202b">' + esc(r[1]) + '</td>' +
    '</tr>';
  }).join('');

  var btn = 'display:inline-block;padding:11px 22px;border-radius:999px;' +
            'font:600 14px/1 -apple-system,Segoe UI,sans-serif;text-decoration:none;color:#fff;';

  return '' +
    '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px">' +
      '<p style="font-size:15px;color:#16202b">Someone asked to be listed on the resource map.</p>' +
      '<table style="border-collapse:collapse;margin:14px 0 22px">' + table + '</table>' +
      '<a href="' + base + '?action=approve&token=' + token + '" style="' + btn + 'background:#2a8c7a">Approve &amp; add</a>' +
      '&nbsp;&nbsp;' +
      '<a href="' + base + '?action=reject&token=' + token + '" style="' + btn + 'background:#a83e5b">Reject</a>' +
      '<p style="font-size:12px;color:#8b95a1;margin-top:22px">' +
        'Approving geocodes the address and appends it to the ' + esc(LIVE_TAB) + ' tab.' +
      '</p>' +
    '</div>';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function str(v) { return v == null ? '' : String(v).trim(); }

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
                       .setMimeType(ContentService.MimeType.JSON);
}

function page(msg) {
  return HtmlService.createHtmlOutput(
    '<div style="font:400 16px/1.6 -apple-system,Segoe UI,sans-serif;' +
    'color:#16202b;max-width:460px;margin:14vh auto;text-align:center">' +
    esc(msg) + '</div>'
  );
}
