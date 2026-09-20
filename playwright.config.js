// Titan Inventory tests.
//
// Every backend call is stubbed with page.route, so nothing here reaches the
// real Apps Script deployment or the live sheet. Run with: npm test

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  retries: 0,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    headless: true,
  },
});
