/**
 * The one setting the signed-in pages need — review.html, team-edit.html and
 * users.html all read it.
 *
 * API_URL is the /exec url Apps Script hands you at the end of
 * Deploy > New deployment > Web app. It is an address, not a credential: it is
 * safe to commit, and every action past sign-in is refused without a session
 * token the script itself issued.
 *
 * Setup for the script end is in apps-script/README.md. Redeploying after a
 * code change gives you a NEW /exec url unless you use "Manage deployments"
 * and edit the existing one — if the pages suddenly can't reach the api after
 * you edited Code.gs, that is almost always why.
 */
window.NH_CONFIG_API = {
  API_URL: 'https://script.google.com/macros/s/AKfycbzckvzNL6yEqdDbBxsMoJrJAGuBnTryAXu3cUOg8FRopifr9ryR9GnH3cFKW-3-ezmSPQ/exec'
};
