/**
 * The sign-in screen and the little "message in the middle of the page" state,
 * shared by review.html, team-edit.html and users.html so all three behave the
 * same way when a session ends.
 *
 * There is no access control in this file. It collects a username and a
 * password and hands them to the api; the Apps Script decides. Hiding a button
 * here would stop nobody.
 */
window.NHUI = (function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** A centred message, optionally with one button. */
  function state(el, title, body, btnLabel, onBtn) {
    el.hidden = false;
    el.className = 'state';
    el.innerHTML = '<h2>' + esc(title) + '</h2>' +
      (body ? '<p>' + esc(body) + '</p>' : '') +
      (btnLabel ? '<button class="btn" type="button">' + esc(btnLabel) + '</button>' : '');
    if (btnLabel) el.querySelector('button').addEventListener('click', onBtn);
  }

  /**
   * Renders the sign-in card into el and calls onDone(user) once the api has
   * accepted. Failures stay on the card with the message the server gave —
   * "wrong password" and "locked for 12 minutes" are different things and the
   * person typing needs to know which one they hit.
   */
  function signIn(el, opts, onDone) {
    opts = opts || {};
    el.hidden = false;
    el.className = 'signin';
    el.innerHTML =
      '<form class="signin-card" autocomplete="on">' +
        '<h2>' + esc(opts.title || 'Sign in') + '</h2>' +
        (opts.blurb ? '<p>' + esc(opts.blurb) + '</p>' : '') +
        '<div class="f">' +
          '<label for="nhU">Username</label>' +
          '<input id="nhU" name="username" type="text" autocomplete="username" ' +
                 'autocapitalize="off" spellcheck="false" required>' +
        '</div>' +
        '<div class="f">' +
          '<label for="nhP">Password</label>' +
          '<input id="nhP" name="password" type="password" autocomplete="current-password" required>' +
        '</div>' +
        '<button class="btn" type="submit">Sign in</button>' +
        '<div class="signin-note" role="status"></div>' +
      '</form>';

    var form = el.querySelector('form');
    var btn  = el.querySelector('button');
    var note = el.querySelector('.signin-note');

    setTimeout(function () { el.querySelector('#nhU').focus(); }, 40);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var u = form.elements.username.value.trim();
      var p = form.elements.password.value;
      if (!u || !p) { say('Enter a username and a password.', 'bad'); return; }

      btn.disabled = true;
      btn.textContent = 'Signing in…';
      say('');

      NH.login(u, p)
        .then(function (user) { onDone(user); })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Sign in';
          form.elements.password.value = '';
          form.elements.password.focus();
          say(err.message, 'bad');
        });
    });

    function say(msg, kind) {
      note.textContent = msg || '';
      note.className = 'signin-note' + (kind ? ' ' + kind : '');
    }
  }

  /**
   * Wraps a page's load: resumes a remembered session if there is one,
   * otherwise shows the sign-in card. onIn(user) runs either way once there is
   * a session.
   */
  function gate(el, opts, onIn) {
    if (!NH.configured()) {
      state(el, 'Not configured yet',
            'config.js still needs API_URL — the /exec url of the Apps Script web app. ' +
            'The steps are in apps-script/README.md.');
      return;
    }
    state(el, 'Checking your session…', '');
    NH.resume().then(function (user) {
      if (user) return onIn(user);
      signIn(el, opts, onIn);
    });
  }

  return { esc: esc, state: state, signIn: signIn, gate: gate };
})();
