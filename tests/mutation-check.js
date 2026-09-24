#!/usr/bin/env node
// Do these tests actually catch anything?
//
// A suite that passes is only evidence if it would have failed on broken code.
// This breaks Count mode on purpose, one bug at a time, into a gitignored copy
// of index.html, and checks that the test claiming to guard that bug goes red.
//
// Run with: npm run verify-tests
// index.html is never modified -- every mutation goes to a temp copy.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const SOURCE = path.join(REPO, 'index.html');
const MUTANT = path.join(REPO, '_mutant.html'); // gitignored, deleted below

const MUTATIONS = [
  {
    name: 'send the button total instead of the number counted (a double-count)',
    find: "      body: authedBody({ action: 'auditCount', id: it.id, n: n, mode: mode })",
    replace: "      body: authedBody({ action: 'auditCount', id: it.id, n: (Number(it.qty) || 0) + n, mode: mode })",
    caughtBy: 'Add sends the number counted',
  },
  {
    name: 'decide the mode here instead of carrying what was pressed',
    find: "      body: authedBody({ action: 'auditCount', id: it.id, n: n, mode: mode })",
    replace: "      body: authedBody({ action: 'auditCount', id: it.id, n: n, mode: 'replace' })",
    caughtBy: 'Add sends the number counted',
  },
  {
    name: 'tidy the POST to application/json, which Apps Script will not answer',
    find: "      headers: { 'Content-Type': 'text/plain;charset=utf-8' },\n" +
          "      body: authedBody({ action: 'auditCount'",
    replace: "      headers: { 'Content-Type': 'application/json' },\n" +
             "      body: authedBody({ action: 'auditCount'",
    caughtBy: 'text/plain, which is load-bearing',
  },
  {
    name: 'work the new quantity out locally instead of taking the sheet\'s answer',
    find: '    it.qty = data.after;',
    replace: '    it.qty = (Number(it.qty) || 0) + (Number(data.delta) || 0);',
    caughtBy: 'comes back from the sheet, not computed here',
  },
  {
    name: 'ignore an error the server sent back',
    find: '    if (data.error) throw new Error(data.error);\n\n    entry.before = data.before;',
    replace: '    \n\n    entry.before = data.before;',
    caughtBy: 'refused count is shown as failed',
  },
  {
    name: 'let both buttons commit while the box is still empty',
    find: "  var ok = raw !== '' && !isNaN(n) && n >= 0;",
    replace: '  var ok = true;',
    caughtBy: 'ships blank and both buttons wait',
  },
  {
    name: 'accept a negative count from the field',
    find: "  var ok = raw !== '' && !isNaN(n) && n >= 0;",
    replace: "  var ok = raw !== '' && !isNaN(n);",
    caughtBy: 'negative entry leaves both buttons disabled',
  },
  {
    name: 'label both buttons with the same number, hiding the difference',
    find: "  addBtn.textContent = t('countAdd').replace('N', ok ? (onSheet + n) : onSheet);",
    replace: "  addBtn.textContent = t('countAdd').replace('N', ok ? n : onSheet);",
    caughtBy: 'offers both Add and Replace',
  },
  {
    name: 'undo by delta, which cannot reverse a Replace',
    find: "      body: authedBody({ action: 'auditUndo', id: entry.id, restore: entry.before, expect: entry.after })",
    replace: "      body: authedBody({ action: 'auditUndo', id: entry.id, restore: entry.delta, expect: entry.after })",
    caughtBy: 'undo sends the value from before',
  },
  {
    name: 'stop telling the server what the entry left behind',
    find: "      body: authedBody({ action: 'auditUndo', id: entry.id, restore: entry.before, expect: entry.after })",
    replace: "      body: authedBody({ action: 'auditUndo', id: entry.id, restore: entry.before })",
    caughtBy: 'undo sends the value from before',
  },
  {
    name: 'turn the count field into a text box, losing the browser-side guard',
    find: '\'<input class="count-input" id="countNum" type="number" inputmode="numeric" min="0" step="1" \' +',
    replace: '\'<input class="count-input" id="countNum" type="text" inputmode="numeric" min="0" step="1" \' +',
    caughtBy: 'field is a number pad',
  },

  // --- safety data sheets ---
  {
    name: 'show an SDS nobody has checked against the label',
    find: "  return (s && s.file && String(s.checkedBy || '').trim()) ? s : null;",
    replace: '  return (s && s.file) ? s : null;',
    caughtBy: 'nobody has checked does not show',
  },
  {
    name: 'only ask for a sheet when one is listed, so a missing one is invisible',
    find: "  return String(item.category || '').trim().toUpperCase() === CHEM_CATEGORY || !!SDS_SHEETS[item.id];",
    replace: '  return !!SDS_SHEETS[item.id];',
    caughtBy: 'no sheet is flagged, not quietly left out',
  },
  {
    name: 'match the category exactly, so " Chemicals " from the sheet slips through',
    find: "  return String(item.category || '').trim().toUpperCase() === CHEM_CATEGORY || !!SDS_SHEETS[item.id];",
    replace: "  return String(item.category || '') === CHEM_CATEGORY || !!SDS_SHEETS[item.id];",
    caughtBy: 'survives stray spaces and case',
  },
  {
    name: 'count sheets needed as sheets on file',
    find: "  document.getElementById('statSds').textContent = sdsNeed.filter(i => !sdsMissing(i)).length + '/' + sdsNeed.length;",
    replace: "  document.getElementById('statSds').textContent = sdsNeed.length + '/' + sdsNeed.length;",
    caughtBy: 'on file over needed',
  },
  {
    name: 'let the SDS filter show everything',
    find: '    if (sdsOnly && !sdsRequired(item)) return false;\n',
    replace: '',
    caughtBy: 'filter is the chemical list',
  },
  {
    name: 'leave the sheet out of the pull view',
    find: '              ${sdsBlock(item)}\n              <div class="peek-facts">',
    replace: '              <div class="peek-facts">',
    caughtBy: 'shows while pulling',
  },
  {
    name: 'link the sheet outside sds/, where the service worker never keeps it',
    find: "function sdsUrl(s) { return 'sds/' + encodeURIComponent(s.file); }",
    replace: 'function sdsUrl(s) { return encodeURIComponent(s.file); }',
    caughtBy: 'checked sheet opens from the item',
  },
  {
    name: 'list a sheet whose PDF never made it into the repo',
    find: 'const SDS_SHEETS = {\n};',
    replace: "const SDS_SHEETS = {\n  7: { file:'not-in-repo.pdf', product:'X', maker:'Y', revised:'', checkedBy:'Matt' },\n};",
    caughtBy: 'actually ships in sds/',
  },

  // --- Spanish ---
  {
    name: 'drop one Spanish label, so that button falls back to English',
    find: "    jobName:'Nombre del trabajo', ",
    replace: '    ',
    caughtBy: 'every English label has a Spanish one',
  },
  {
    name: 'mistype a data-i18n key, which prints the key on the button',
    find: 'data-i18n="barHistory"',
    replace: 'data-i18n="barHistroy"',
    caughtBy: 'every key the page asks for',
  },
  {
    name: 'put "Registrarse" (sign UP) back on the sign-in button',
    find: "    signIn:'Iniciar sesión',",
    replace: "    signIn:'Registrarse',",
    caughtBy: 'Spanish picked in Groundwork',
  },
  {
    name: 'remember the language under a key of its own, so the two apps disagree',
    find: "const LANG_KEY = 'wolf-lang';",
    replace: "const LANG_KEY = 'titan-lang';",
    caughtBy: 'Spanish picked in Groundwork',
  },
  {
    name: 'swap the button bar with textContent, losing the short phone form',
    find: "  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });",
    replace: "  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.textContent = t(el.dataset.i18nHtml).replace(/<[^>]+>/g, ''); });",
    caughtBy: 'button bar translates',
  },
  {
    name: 'write the return into the Change Log in Spanish',
    find: "    : `${qty}${u ? ' ' + u : ''} back from ${job} — ${before} → ${after}`;",
    replace: "    : `${qty}${u ? ' ' + u : ''} ${lang === 'es' ? 'de regreso de' : 'back from'} ${job} — ${before} → ${after}`;",
    caughtBy: 'return logged in Spanish',
  },
  {
    name: 'log the unit the screen shows instead of the trade abbreviation',
    find: "  const u = unitAbbr(item.unit);\n  const detail = outbound",
    replace: "  const u = unitLabel(UNITS.find(x => x.value === normalizeUnit(item.unit)) || {label:''});\n  const detail = outbound",
    caughtBy: 'return logged in Spanish',
  },
  {
    name: 'store the disposal cause as the words on screen',
    find: "  const cause = document.getElementById('disposalCause').value;",
    replace: "  const dc = document.getElementById('disposalCause'); const cause = dc.options[dc.selectedIndex].text;",
    caughtBy: 'disposal cause picked in Spanish',
  },
  {
    name: 'stop translating the Change Log on screen',
    find: "  if (lang !== 'es') return s;\n  LOG_DETAIL_ES.forEach",
    replace: "  return s;\n  LOG_DETAIL_ES.forEach",
    caughtBy: 'Change Log reads in Spanish',
  },
  {
    name: 'search only the Spanish name, so the word on the pot tag finds nothing',
    find: '  return foldText(item.name).includes(n) || (!!es && foldText(es).includes(n));',
    replace: '  return foldText(itemName(item)).includes(n);',
    caughtBy: 'search finds a plant by the tag name',
  },
  {
    name: 'stop folding accents, so "papirifera" misses "papirífera"',
    find: "function foldText(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); }",
    replace: "function foldText(s) { return String(s || '').toLowerCase(); }",
    caughtBy: 'search finds a plant by the tag name',
  },
];

// Normalised to LF: git checks this repo out with CRLF on Windows, so a find
// string containing \n would silently match nothing and report SKIPPED.
const original = fs.readFileSync(SOURCE, 'utf8').replace(/\r\n/g, '\n');
let holes = 0;

console.log(`Checking ${MUTATIONS.length} deliberate bugs against the suite.\n`);

for (const m of MUTATIONS) {
  const edits = m.edits || [{ find: m.find, replace: m.replace }];
  if (edits.some((e) => !original.includes(e.find))) {
    console.log(`  ?  ${m.name}`);
    console.log(`     SKIPPED -- the code it patches has moved. Update this mutation.\n`);
    holes++;
    continue;
  }

  let mutated = original;
  edits.forEach((e) => { mutated = mutated.replace(e.find, e.replace); });
  fs.writeFileSync(MUTANT, mutated);

  // node, not npx: Node on Windows refuses to spawn a .cmd without a shell,
  // and that failure looks exactly like every test passing.
  const run = spawnSync(
    process.execPath,
    [require.resolve('@playwright/test/cli'), 'test', '--reporter=json'],
    {
      cwd: REPO,
      env: { ...process.env, INVENTORY_APP: '_mutant.html' },
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }
  );

  const failed = [];
  try {
    const raw = run.stdout || '';
    const report = JSON.parse(raw.slice(raw.indexOf('{')));
    const walk = (suites) => (suites || []).forEach((s) => {
      (s.specs || []).forEach((spec) => { if (!spec.ok) failed.push(spec.title); });
      walk(s.suites);
    });
    walk(report.suites);
  } catch {
    console.log(`  ?  ${m.name}`);
    console.log(`     could not read the test report -- treating as a hole.\n`);
    holes++;
    continue;
  }

  const hit = failed.find((t) => t.includes(m.caughtBy));
  if (hit) {
    console.log(`  CAUGHT  ${m.name}`);
    console.log(`          by "${hit}"`);
    if (failed.length > 1) console.log(`          (${failed.length} tests went red in total)`);
  } else {
    holes++;
    console.log(`  MISSED  ${m.name}`);
    console.log(`          nothing matching "${m.caughtBy}" failed.`);
    console.log(`          ${failed.length} other test(s) failed: ${failed.slice(0, 3).join(', ') || 'none'}`);
  }
  console.log('');
}

fs.rmSync(MUTANT, { force: true });

if (holes === 0) {
  console.log(`All ${MUTATIONS.length} bugs were caught. The suite has teeth.`);
  process.exit(0);
}
console.log(`${holes} of ${MUTATIONS.length} bugs slipped through. That is a hole in the suite.`);
process.exit(1);
