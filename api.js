/**
 * The client half of apps-script/Code.gs, shared by the signed-in pages
 * (review.html, team-edit.html, users.html).
 *
 * These pages have no access to the spreadsheet of their own. Every read and
 * every write is an action posted to the Apps Script web app, which decides
 * for itself whether that action needs a session. Nothing secret is in this
 * file or any page that loads it — the api url is not a credential, it is an
 * address, and every action past sign-in is refused without a token.
 *
 * Why the requests look the way they do: the body goes as text/plain. That is
 * one of the three content types a browser will send cross-origin without a
 * preflight OPTIONS request, and Apps Script does not answer preflights. The
 * body is still JSON — the header is about the browser, not the payload.
 *
 * Plain script, not a module, so the pages still work opened over file://.
 */
window.NH = (function () {
  'use strict';

  var KEY = 'nh.session';           // localStorage: the token and who it belongs to
  var cfg = { url: '' };
  var session = null;

  try { session = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (err) { session = null; }

  function configure(opts) { cfg.url = (opts && opts.url) || ''; }
  function configured() { return !!cfg.url; }

  function remember(s) {
    session = s;
    try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); }
    catch (err) { /* private mode: the session just won't survive a reload */ }
  }

  /**
   * Posts one action. Resolves with the payload, rejects with an Error whose
   * .auth is true when the session is the problem — pages use that to drop
   * back to the sign-in screen instead of showing a red message nobody can act
   * on.
   */
  function call(action, payload) {
    if (!cfg.url) return Promise.reject(new Error('The api url is not set in config.js.'));

    var body = Object.assign({ action: action }, payload || {});
    if (session && session.token) body.token = session.token;

    return fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    })
    .then(function (r) {
      return r.text().then(function (t) {
        var j;
        try { j = JSON.parse(t); }
        catch (err) {
          // Apps Script answers with an HTML error page when the deployment is
          // wrong — which is the single most likely thing to be wrong at setup
          // time, so say so rather than printing "unexpected token <".
          throw new Error('The api did not answer with data. Check that the web app is ' +
                          'deployed with access set to "Anyone", and that API_URL ends in /exec.');
        }
        if (!j.ok) {
          var e = new Error(j.error || 'That did not work.');
          if (j.auth === false) { e.auth = true; remember(null); }
          throw e;
        }
        return j;
      });
    });
  }

  function login(username, password) {
    return call('login', { username: username, password: password }).then(function (j) {
      remember({ token: j.token, user: j.user });
      return j.user;
    });
  }

  function logout() {
    var p = session ? call('logout', {}).catch(function () {}) : Promise.resolve();
    remember(null);
    return p;
  }

  /** Checks a remembered token is still good, so a reload doesn't ask again. */
  function resume() {
    if (!session || !session.token) return Promise.resolve(null);
    return call('session', {})
      .then(function (j) { remember({ token: session.token, user: j.user }); return j.user; })
      .catch(function () { remember(null); return null; });
  }

  return {
    configure: configure,
    configured: configured,
    call: call,
    login: login,
    logout: logout,
    resume: resume,
    get user() { return session && session.user; },
    get signedIn() { return !!(session && session.token); }
  };
})();
