// Safety data sheets, from the phone's side.
//
// OSHA wants the sheet for every hazardous chemical in reach of the crew on
// their shift. The ways this fails are quiet ones: a chemical with no sheet
// that simply shows nothing, a sheet nobody compared to the label shown as if
// it were right, a sheet that opens in the office and not while pulling. Each
// test below is one of those.
//
// The fixture ids have gaps (4, 9, 23, 31) on purpose: the sheet table is keyed
// by id, and ids that equal their row number would hide a lookup by position.

const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { item, stubBackend, bootApp } = require('./helpers');

const YARD = [
  item({ id: 4, name: 'Goldflame Spirea', category: 'NURSERY STOCK', qty: 140 }),
  item({ id: 9, name: 'Bar & Chain Oil', category: 'CHEMICALS', qty: 6, location: 'Red Building' }),
  item({ id: 23, name: 'Quikrete Vinyl Concrete Patcher', category: 'MASONRY & RETAINING WALL', qty: 3 }),
  item({ id: 31, name: 'Herbicide concentrate', category: 'CHEMICALS', qty: 2, location: 'Red Building' }),
];

// Two sheets: one a person has checked against the label, one nobody has yet.
async function withSheets(page) {
  await page.evaluate(() => {
    SDS_SHEETS[23] = { file: 'quikrete-test.pdf', product: 'Vinyl Concrete Patcher',
                       maker: 'Quikrete', revised: '2024-05-01', checkedBy: 'Matt' };
    SDS_SHEETS[31] = { file: 'herbicide-test.pdf', product: 'Concentrate',
                       maker: 'Acme', revised: '', checkedBy: '' };
    renderItems();
  });
}

async function boot(page, yard) {
  await stubBackend(page, { getAll: { items: yard || YARD }, bootstrap: { items: yard || YARD } });
  await bootApp(page);
  await page.evaluate(() => { collapsedCats.clear(); renderItems(); });
}

async function expand(page, id) {
  await page.evaluate((i) => { expandedId = i; renderItems(); }, id);
  return page.locator(`#detail-${id}`);
}

const tagOn = (page, id) => page.locator(`#card-${id} .tag-nosds`);

test('a chemical with no sheet is flagged, not quietly left out', async ({ page }) => {
  await boot(page);
  await withSheets(page);

  await expect(tagOn(page, 9), 'bar oil is a chemical with no entry at all').toHaveCount(1);
  const detail = await expand(page, 9);
  await expect(detail.locator('.sds-missing')).toContainText('No safety sheet on file');
  await expect(detail.locator('.sds-btn')).toHaveCount(0);
});

test('a sheet nobody has checked does not show', async ({ page }) => {
  await boot(page);
  await withSheets(page);

  // The file is attached but checkedBy is blank. Showing it would put an
  // unverified sheet in front of the crew as if it were the right one.
  const detail = await expand(page, 31);
  await expect(detail.locator('.sds-btn'), 'no link to an unchecked sheet').toHaveCount(0);
  await expect(detail.locator('.sds-missing')).toContainText('not checked yet');
  await expect(tagOn(page, 31), 'still counts as missing').toHaveCount(1);
});

test('a checked sheet opens from the item', async ({ page }) => {
  await boot(page);
  await withSheets(page);

  const detail = await expand(page, 23);
  const link = detail.locator('a.sds-btn');
  await expect(link).toHaveCount(1);
  // Same origin, under sds/ -- the only place the service worker keeps them
  // for the red building, which has no signal.
  expect(await link.getAttribute('href')).toBe('sds/quikrete-test.pdf');
  expect(await link.getAttribute('target')).toBe('_blank');
  await expect(detail.locator('.sds-meta')).toContainText('Quikrete');
  await expect(detail.locator('.sds-meta')).toContainText('2024-05-01');
  await expect(tagOn(page, 23), 'a checked sheet is not flagged').toHaveCount(0);
});

test('the SDS count reads on file over needed', async ({ page }) => {
  await boot(page);
  await withSheets(page);

  // Needed: 9 and 31 (CHEMICALS) and 23 (has an entry). On file and checked: 23.
  const label = page.locator('#statSdsLabel');
  await expect(label).toBeVisible();
  await expect(page.locator('#statSds')).toHaveText('1/3');
  await expect(label).toHaveClass(/stat-warn/);
});

test('plants and pavers never ask for a sheet', async ({ page }) => {
  await boot(page, [YARD[0]]);

  await expect(page.locator('#statSdsLabel'), 'nothing needs a sheet, so no counter').toBeHidden();
  await expect(tagOn(page, 4)).toHaveCount(0);
  const detail = await expand(page, 4);
  await expect(detail.locator('.sds-missing, .sds-btn')).toHaveCount(0);
});

test('the category match survives stray spaces and case from the sheet', async ({ page }) => {
  await boot(page, [item({ id: 12, name: '2-cycle oil', category: ' Chemicals ', qty: 4 })]);
  await expect(tagOn(page, 12)).toHaveCount(1);
});

test('the SDS filter is the chemical list', async ({ page }) => {
  await boot(page);
  await withSheets(page);

  await page.locator('#statSdsLabel').click();
  const shown = await page.$$eval('.item-card', (cards) => cards.map((c) => c.id).sort());
  expect(shown).toEqual(['card-23', 'card-31', 'card-9']);
});

test('the sheet shows while pulling too', async ({ page }) => {
  await boot(page);
  await withSheets(page);

  // Pulling is when the crew has the jug in hand; a sheet that only shows in
  // the edit view is a sheet they will not find.
  await page.evaluate(() => { pullMode = true; renderItems(); });
  const detail = await expand(page, 23);
  await expect(detail.locator('.peek a.sds-btn')).toHaveCount(1);
  const missing = await expand(page, 9);
  await expect(missing.locator('.peek .sds-missing')).toHaveCount(1);
});

test('every sheet the app lists actually ships in sds/', async ({ page }) => {
  await boot(page);
  // The real table as shipped, nothing injected. A listed file that is not in
  // the repo is a button that opens a 404 in the one place it matters.
  const listed = await page.evaluate(() =>
    Object.keys(SDS_SHEETS).map((id) => Object.assign({ id }, SDS_SHEETS[id])));
  for (const s of listed) {
    if (!s.file) continue;
    const onDisk = path.resolve(__dirname, '..', 'sds', s.file);
    expect(fs.existsSync(onDisk), `item ${s.id}: sds/${s.file} is listed but not in the repo`).toBe(true);
    expect(s.maker && s.product, `item ${s.id}: a sheet needs its maker and product`).toBeTruthy();
  }
});
