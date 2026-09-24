// The Spanish side of the app.
//
// Two different things are being guarded here, and they fail in opposite ways.
//
// The labels: a key missing from T.es does not error, it falls back to English,
// so a gap looks like a working screen with one English word on it. Only a
// parity check finds that.
//
// The data: disposal causes and Change Log lines are stored in English and read
// back by code -- parseJobMoves finds a job by the words "for" and "back from".
// If the Spanish screen ever wrote Spanish into the Sheet, every pull entered
// in Spanish would silently drop out of the job totals. So these tests assert
// on what the app SENDS while it is showing Spanish.

const { test, expect } = require('@playwright/test');
const { item, stubBackend, bootApp } = require('./helpers');

const YARD = [
  item({ id: 1, name: 'Goldflame Spirea', qty: 93, category: 'NURSERY STOCK', location: 'Gray Building' }),
  item({ id: 2, name: 'Cedar fence boards', qty: 1453, category: 'LUMBER & POSTS', location: '104' }),
  item({ id: 3, name: 'Paper Birch', qty: 2, category: 'NURSERY STOCK', location: '104' }),
];
// Every name already has its Spanish, so no test waits on (or stubs) the AI.
const NAMES_ES = { 'Goldflame Spirea': "Espirea 'Goldflame'", 'Cedar fence boards': 'Tablas de cedro para cerca', 'Paper Birch': 'Abedul papirífera' };

const withYard = (extra) => Object.assign({ getAll: { items: YARD }, getLog: { entries: [] } }, extra);

async function inSpanish(page) {
  await page.addInitScript((names) => {
    localStorage.setItem('wolf-lang', 'es');
    localStorage.setItem('titanTranslationCacheV2', JSON.stringify(names));
  }, NAMES_ES);
}

// --- the labels -------------------------------------------------------------

test('every English label has a Spanish one', async ({ page }) => {
  await stubBackend(page, withYard());
  await bootApp(page);
  const gap = await page.evaluate(() => ({
    keys: Object.keys(T.en).filter(k => !(k in T.es)),
    cats: Object.keys(T.en.categories).filter(k => !(k in T.es.categories)),
  }));
  expect(gap.keys, 'a missing key shows English on the Spanish screen, with no error').toEqual([]);
  expect(gap.cats).toEqual([]);
});

test('every key the page asks for exists in both languages', async ({ page }) => {
  // A typo in a data-i18n attribute prints the key itself ("barHistroy") on
  // the button, in both languages. Parity between T.en and T.es cannot see it.
  await stubBackend(page, withYard());
  await bootApp(page);
  const missing = await page.evaluate(() => {
    const out = [];
    [['data-i18n', 'i18n'], ['data-i18n-html', 'i18nHtml'], ['data-i18n-ph', 'i18nPh'], ['data-i18n-title', 'i18nTitle']]
      .forEach(([attr, prop]) => document.querySelectorAll('[' + attr + ']').forEach(el => {
        const k = el.dataset[prop];
        if (!(k in T.en) || !(k in T.es)) out.push(attr + '=' + k);
      }));
    return out;
  });
  expect(missing).toEqual([]);
});

test('Spanish picked in Groundwork opens Inventory in Spanish', async ({ page }) => {
  // Both apps are on titanalaska.github.io and localStorage belongs to the
  // origin, so one key serves both. Nobody should have to pick it twice.
  await stubBackend(page, withYard());
  await inSpanish(page);
  await bootApp(page, { profile: null });
  await expect(page.locator('#logoLabel')).toHaveText('INVENTARIO');
  await expect(page.locator('#langBtn')).toHaveText('EN');
  // "Registrarse" means sign UP. This button is for someone who already has a profile.
  await expect(page.locator('#userBtn')).toHaveText('👤 Iniciar sesión');
});

test('the toggle remembers the choice under the key Groundwork reads', async ({ page }) => {
  await stubBackend(page, withYard());
  await bootApp(page);
  await page.evaluate(() => toggleLang());
  expect(await page.evaluate(() => localStorage.getItem('wolf-lang'))).toBe('es');
  await expect(page.locator('#logoLabel')).toHaveText('INVENTARIO');
  await page.evaluate(() => toggleLang());
  expect(await page.evaluate(() => localStorage.getItem('wolf-lang'))).toBe('en');
});

test('the button bar translates, long and short forms both', async ({ page }) => {
  await stubBackend(page, withYard());
  await inSpanish(page);
  await bootApp(page);
  const bar = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.add-bar button')).map(b => b.textContent.trim()));
  expect(bar).toEqual([
    '+ Agregar artículo', '📋 Historial', '🔍 Revisar trabajo', '🧺 Retirar material',
    '📋 Retirar de lista', '📍 ¿Dónde está?', '☑ Contar el patio', '📸 Sesión de fotos',
  ]);
  // The long half lives in a span a narrow phone hides. It has to survive the swap.
  expect(await page.locator('#addBtn .btn-long').count()).toBe(1);
});

// --- the data ---------------------------------------------------------------

test('a return logged in Spanish writes the words the job totals read', async ({ page }) => {
  const calls = await stubBackend(page, withYard());
  await inSpanish(page);
  await bootApp(page);

  await page.evaluate(() => openReturnModal(1));
  await page.locator('#returnQty').fill('2');
  // No job has this item out, so the picker falls to "another job" and asks for a name.
  await page.locator('#returnJobOther').fill('Wolf');
  await page.evaluate(() => confirmReturn());

  const log = calls.find(c => c.action === 'log');
  expect(log, 'the return must reach the Change Log').toBeTruthy();
  const detail = new URL(log.url).searchParams.get('detail');
  // 93 on the shelf, 2 come back: 93 -> 95. The unit is EA, never "pieza".
  expect(detail).toBe('2 EA back from Wolf — 93 → 95');

  // And the parser that builds the job totals reads it as a return from Wolf.
  const parsed = await page.evaluate((d) =>
    parseJobMoves([{ type: 'RETURN', itemName: 'Goldflame Spirea', detail: d }]), detail);
  expect(Object.keys(parsed)).toEqual(['Wolf']);
  expect(parsed.Wolf.items['Goldflame Spirea'].back).toBe(2);
});

test('a disposal cause picked in Spanish is stored in English', async ({ page }) => {
  const calls = await stubBackend(page, withYard());
  await inSpanish(page);
  await bootApp(page);

  await page.evaluate(() => openDisposalModal(1));
  await page.locator('#disposalCause').selectOption({ label: 'Planta muerta' });
  await page.locator('#disposalQty').fill('3');
  await page.evaluate(() => confirmDisposal());

  const sent = calls.find(c => c.action === 'disposal');
  expect(sent).toBeTruthy();
  expect(new URL(sent.url).searchParams.get('cause')).toBe('Plant mortality');
});

test('the Change Log reads in Spanish without changing what it records', async ({ page }) => {
  await stubBackend(page, withYard());
  await inSpanish(page);
  await bootApp(page);
  const out = await page.evaluate(() => [
    // The job name keeps its own em-dash; the parser anchors on the LAST one.
    logDetailLabel('2 EA for Wolf — Phase 2 — 51 → 49'),
    logDetailLabel('3 back from tallia — 49 → 52'),
    logDetailLabel('4 disposed — Plant mortality — frost'),
    logDetailLabel('Location: 104 → Gray Building, Unit: (none) → EA'),
    logDetailLabel('something nobody wrote a rule for'),
  ]);
  expect(out).toEqual([
    '2 EA para Wolf — Phase 2 — 51 → 49',
    '3 de regreso de tallia — 49 → 52',
    '4 desechados — Planta muerta — frost',
    'Ubicación: 104 → Gray Building, Unidad: (ninguna) → EA',
    'something nobody wrote a rule for',
  ]);
});

// --- search -----------------------------------------------------------------

test('search finds a plant by the tag name while the list reads Spanish', async ({ page }) => {
  await stubBackend(page, withYard());
  await inSpanish(page);
  await bootApp(page);

  const names = async (q) => {
    await page.locator('#searchInput').fill(q);
    await page.evaluate(() => renderItems());
    return page.locator('.item-name').allTextContents();
  };
  // "boards" is only in the English. "spirea" would prove nothing: the Spanish
  // "Espirea" contains it, so a Spanish-only search passes that one too.
  expect(await names('boards'), 'a word only the English name has').toEqual(['Tablas de cedro para cerca']);
  expect(await names('spirea'), 'the word on the pot tag').toEqual(["Espirea 'Goldflame'"]);
  expect(await names('espirea'), 'the word on the screen').toEqual(["Espirea 'Goldflame'"]);
  expect(await names('cedro'), 'Spanish only').toEqual(['Tablas de cedro para cerca']);
  expect(await names('papirifera'), 'typed without the accent').toEqual(['Abedul papirífera']);

  // Count mode shares the matcher.
  const hits = await page.evaluate(() => countSearchResults('goldflame').map(i => i.id));
  expect(hits).toEqual([1]);
});
