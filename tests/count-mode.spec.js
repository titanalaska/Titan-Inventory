// Count mode, from the phone's side.
//
// The backend suite proves the arithmetic and which cells get written. What it
// cannot see is what this app SENDS -- and the two-button design lives exactly
// there. The screen offers "Add to 105" and "Replace with 12" and never infers
// which; a species on three pallets is counted 12, then 8, then 6 and has to
// land on 26. Any version that guesses eventually guesses wrong in silence.
//
// So these tests assert on the request body, not just the screen.

const { test, expect } = require('@playwright/test');
const {
  item, stubBackend, bootApp, openCountOn, typeCount, countButtons,
} = require('./helpers');

const YARD = [
  item({ id: 1, name: 'Goldflame Spirea', qty: 93 }),
  item({ id: 2, name: 'Karl Foerster Reed Grass', qty: 65, category: 'LANDSCAPE' }),
];

const withYard = (extra) => Object.assign({ getAll: { items: YARD } }, extra);

// --- the two buttons -------------------------------------------------------

test('the screen offers both Add and Replace, and does the sum for you', async ({ page }) => {
  await stubBackend(page, withYard());
  await bootApp(page);
  await openCountOn(page, 1);
  await typeCount(page, 12);

  const btns = await countButtons(page);
  expect(btns.add.text, '93 on the sheet plus 12 counted').toContain('105');
  expect(btns.replace.text, 'replace sets it to what was counted').toContain('12');
  expect(btns.add.disabled).toBe(false);
  expect(btns.replace.disabled).toBe(false);
});

test('the count box ships blank and both buttons wait for a number', async ({ page }) => {
  await stubBackend(page, withYard());
  await bootApp(page);
  await openCountOn(page, 1);

  const value = await page.locator('#countNum').inputValue();
  expect(value, 'a judgment value is never pre-filled from the sheet or the tally').toBe('');

  const btns = await countButtons(page);
  expect(btns.add.disabled, 'nothing to commit until somebody counts something').toBe(true);
  expect(btns.replace.disabled).toBe(true);
});

test('a negative entry leaves both buttons disabled', async ({ page }) => {
  await stubBackend(page, withYard());
  await bootApp(page);
  await openCountOn(page, 1);
  await typeCount(page, -4);

  const btns = await countButtons(page);
  expect(btns.add.disabled, 'minus four of anything is not a count').toBe(true);
  expect(btns.replace.disabled).toBe(true);
});

test('the field is a number pad, which is what keeps letters out', async ({ page }) => {
  // Letters never reach renderCountButtons() because the browser refuses them
  // at a type=number field -- Playwright cannot even type them. That guard is
  // structural, so it is the attributes that have to be pinned: switching this
  // to type=text would quietly hand the validation back to the app, which does
  // not check for it.
  await stubBackend(page, withYard());
  await bootApp(page);
  await openCountOn(page, 1);

  const field = await page.evaluate(() => {
    const el = document.getElementById('countNum');
    return { type: el.type, min: el.min, step: el.step, inputmode: el.inputMode };
  });

  expect(field.type).toBe('number');
  expect(field.min, 'the field itself refuses negatives before the app sees them').toBe('0');
  expect(field.step).toBe('1');
  expect(field.inputmode, 'a numeric keypad, not a full keyboard, in the yard').toBe('numeric');
});

test('zero is a real answer -- the pallet is empty', async ({ page }) => {
  await stubBackend(page, withYard());
  await bootApp(page);
  await openCountOn(page, 1);
  await typeCount(page, 0);

  const btns = await countButtons(page);
  expect(btns.replace.disabled, 'replacing with zero is how an empty pallet gets recorded').toBe(false);
  expect(btns.replace.text).toContain('0');
});

// --- what actually goes over the wire --------------------------------------

test('Add sends the number counted, not the total on the button', async ({ page }) => {
  // The button says "Add to 105". If 105 were sent with mode add, the sheet
  // would land on 198. The counted number is 12 and that is what must travel.
  const calls = await stubBackend(page, withYard({
    auditCount: { status: 'ok', before: 93, after: 105, delta: 12, lastAudited: '2026-09-20', auditedBy: 'Matt' },
  }));
  await bootApp(page);
  await openCountOn(page, 1);
  await typeCount(page, 12);
  await page.click('#countAddBtn');
  await page.waitForFunction(() => !document.getElementById('countAddBtn'), null, { timeout: 5000 })
    .catch(() => {});

  const sent = calls.filter((c) => c.action === 'auditCount');
  expect(sent.length, 'exactly one count was committed').toBe(1);
  expect(sent[0].body.mode).toBe('add');
  expect(sent[0].body.n, 'the raw count, never the button total').toBe(12);
  expect(String(sent[0].body.id)).toBe('1');
});

test('Replace sends the same number with the other mode', async ({ page }) => {
  const calls = await stubBackend(page, withYard({
    auditCount: { status: 'ok', before: 93, after: 12, delta: -81, lastAudited: '2026-09-20', auditedBy: 'Matt' },
  }));
  await bootApp(page);
  await openCountOn(page, 1);
  await typeCount(page, 12);
  await page.click('#countReplaceBtn');
  await page.waitForTimeout(300);

  const sent = calls.filter((c) => c.action === 'auditCount');
  expect(sent.length).toBe(1);
  expect(sent[0].body.mode, 'the mode is carried, never inferred from dates').toBe('replace');
  expect(sent[0].body.n).toBe(12);
});

test('the POST is text/plain, which is load-bearing', async ({ page }) => {
  // Apps Script does not answer the CORS preflight that application/json
  // triggers. Tidying this header breaks every write from the phone.
  const calls = await stubBackend(page, withYard({
    auditCount: { status: 'ok', before: 93, after: 105, delta: 12 },
  }));
  await bootApp(page);
  await openCountOn(page, 1);
  await typeCount(page, 12);
  await page.click('#countAddBtn');
  await page.waitForTimeout(300);

  const sent = calls.find((c) => c.action === 'auditCount');
  expect(sent.method).toBe('POST');
  expect(
    sent.contentType,
    `sent as "${sent.contentType}". application/json triggers a CORS preflight ` +
    `that Apps Script does not answer, so every write from the phone would fail.`
  ).toContain('text/plain');
});

// --- the answer comes from the server, not from local arithmetic -----------

test('the stored quantity comes back from the sheet, not computed here', async ({ page }) => {
  // The server is the only place a quantity lives. If the app did its own sum
  // it would drift the moment anybody else pulled from the same row.
  await stubBackend(page, withYard({
    auditCount: { status: 'ok', before: 40, after: 52, delta: 12, lastAudited: '2026-09-20', auditedBy: 'Matt' },
  }));
  await bootApp(page);
  await openCountOn(page, 1);
  await typeCount(page, 12);
  await page.click('#countAddBtn');
  await page.waitForTimeout(400);

  const stored = await page.evaluate(() => countItemById(1).qty);
  expect(
    stored,
    'the sheet said 52 even though 93 + 12 is 105 -- somebody else had moved it, ' +
    'and the server answer is the one that counts'
  ).toBe(52);
});

test('a refused count is shown as failed and changes nothing', async ({ page }) => {
  await stubBackend(page, withYard({
    auditCount: { error: 'item changed since that entry' },
  }));
  await bootApp(page);
  await openCountOn(page, 1);
  await typeCount(page, 12);
  await page.click('#countAddBtn');
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => ({
    qty: countItemById(1).qty,
    entry: countEntries[0] ? { status: countEntries[0].status, error: countEntries[0].error } : null,
  }));

  expect(after.qty, 'a refusal must not move the local number either').toBe(93);
  expect(after.entry.status).toBe('failed');
  expect(after.entry.error).toContain('changed');
});

// --- undo ------------------------------------------------------------------

test('undo sends the value from before the entry and what it left behind', async ({ page }) => {
  const calls = await stubBackend(page, withYard({
    auditCount: { status: 'ok', before: 93, after: 12, delta: -81, lastAudited: '2026-09-20', auditedBy: 'Matt' },
    auditUndo: { status: 'ok', before: 12, after: 93, delta: 81 },
  }));
  await bootApp(page);
  await openCountOn(page, 1);
  await typeCount(page, 12);
  await page.click('#countReplaceBtn');
  await page.waitForTimeout(400);

  await page.evaluate(() => countUndoEntry(countEntries[0].seq));
  await page.waitForTimeout(400);

  const undo = calls.find((c) => c.action === 'auditUndo');
  expect(undo, 'the undo reached the backend').toBeTruthy();
  expect(
    undo.body.restore,
    'a delta cannot reverse a Replace -- undoing 93 to 12 means restoring 93'
  ).toBe(93);
  expect(undo.body.expect, 'and saying what the entry left, so the server can refuse a stale undo').toBe(12);
});
