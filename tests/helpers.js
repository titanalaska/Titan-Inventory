// Shared setup for the Titan Inventory tests.
//
// Nothing here touches the real Apps Script deployment or the live sheet.
// Every request to script.google.com is intercepted, recorded, and answered
// from a fixture, so a test can assert on WHAT THE APP SENT as well as on what
// it did with the reply. The request body is the contract between this app and
// the backend, and it is the half a backend test cannot see.

const path = require('path');
const { pathToFileURL } = require('url');

const APP = pathToFileURL(
  path.resolve(__dirname, '..', process.env.INVENTORY_APP || 'index.html')
).href;

/** An inventory row as the sheet hands it over. */
function item(over) {
  return Object.assign({
    id: 1,
    name: 'Goldflame Spirea',
    category: 'LANDSCAPE',
    qty: 93,
    unit: 'ea',
    location: 'Nursery',
    specs: '',
    estimated: false,
    lastAudited: '',
    auditedBy: '',
  }, over);
}

/**
 * Intercept the backend.
 *
 * `responses` maps an action name to either a fixed object or a function of
 * the parsed request, so a test can answer the way the real server would.
 * Anything not listed gets {} -- a test should never depend on an action it
 * did not think about.
 *
 * Returns a `calls` array: { action, body, url } in the order they were made.
 */
async function stubBackend(page, responses) {
  const calls = [];
  const table = responses || {};

  await page.route('**script.google.com/**', async (route) => {
    const req = route.request();
    const url = req.url();
    let body = {};
    try {
      const raw = req.postData();
      if (raw) body = JSON.parse(raw);
    } catch (e) { /* GETs carry no body */ }

    const fromQuery = /[?&]action=([a-zA-Z]+)/.exec(url);
    const action = body.action || (fromQuery ? fromQuery[1] : '(unknown)');
    calls.push({
      action, body, url,
      method: req.method(),
      contentType: (req.headers()['content-type'] || ''),
    });

    let answer = table[action];
    if (typeof answer === 'function') answer = answer(body, calls.length);
    if (answer === undefined) answer = {};

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(answer),
    });
  });

  return calls;
}

/**
 * Load the app with an approved profile already in place.
 *
 * Count mode sits behind requireName(), which is correct and is tested on its
 * own. Every other test would otherwise spend its setup clicking through a
 * sign-in that is not what it is checking.
 */
async function bootApp(page, opts) {
  const o = opts || {};
  const profile = o.profile === null ? null : Object.assign(
    { id: 'p1', name: 'Matt', position: 'Nursery & Field Ops', status: 'approved' },
    o.profile
  );

  await page.addInitScript((p) => {
    try {
      if (p) {
        localStorage.setItem('titan_profile', JSON.stringify(p));
        localStorage.setItem('titan_token', 'test-token');
      } else {
        localStorage.removeItem('titan_profile');
        localStorage.removeItem('titan_token');
      }
    } catch (e) { /* private mode -- the test will show it */ }
  }, profile);

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(APP);
  await page.waitForFunction(() => typeof openCount === 'function', null, { timeout: 15000 });
  // Let the boot sync settle so it cannot land mid-test.
  await page.waitForTimeout(400);

  if (errors.length && !o.allowErrors) {
    throw new Error('index.html did not load cleanly:\n  ' + errors.join('\n  '));
  }
  return errors;
}

/** Open Count mode and pick an item, without clicking through the UI to get there. */
async function openCountOn(page, itemId) {
  await page.evaluate((id) => {
    openCount();
    countPicked = id;
    renderCount();
  }, itemId);
}

/** Type into the count field the way the number pad does, so its handlers run. */
async function typeCount(page, text) {
  const field = page.locator('#countNum');
  await field.fill(String(text));
  await field.dispatchEvent('input');
}

/** The two commit buttons, as the person in the yard sees them. */
async function countButtons(page) {
  return page.evaluate(() => {
    const add = document.getElementById('countAddBtn');
    const rep = document.getElementById('countReplaceBtn');
    return {
      add: add ? { text: add.textContent.trim(), disabled: add.disabled } : null,
      replace: rep ? { text: rep.textContent.trim(), disabled: rep.disabled } : null,
    };
  });
}

module.exports = {
  APP, item, stubBackend, bootApp, openCountOn, typeCount, countButtons,
};
