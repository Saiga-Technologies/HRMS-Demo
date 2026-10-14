import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// Fresh seeded database for every e2e run.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-e2e-'));
const PORT = Number(process.env.E2E_PORT || 4100);
// Use a preinstalled Chromium when one is provided (e.g. PW_CHROMIUM_PATH=/opt/pw-browsers/chromium);
// otherwise Playwright's own downloaded browser is used.
const chromiumPath = process.env.PW_CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(__dirname, 'playwright-report') }]],
  outputDir: path.join(__dirname, 'test-results'),
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
    geolocation: { latitude: 12.9716, longitude: 77.5946 }, // inside the seeded Bengaluru HQ geofence
    permissions: ['geolocation'],
  },
  webServer: {
    command: `npm run start -w server`,
    cwd: path.join(__dirname, '..'),
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: String(PORT), HRMS_DATA_DIR: dataDir, HRMS_DB_FILE: path.join(dataDir, 'e2e.sqlite') },
  },
});
