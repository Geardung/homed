import { devices, defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 20_000,
  expect: {
    timeout: 7_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: devices['Desktop Chrome'],
    },
    {
      name: 'mobile-chrome',
      use: devices['Pixel 5'],
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'], browserName: 'chromium' },
    },
    {
      name: 'tablet',
      use: { ...devices['iPad (gen 7)'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'bun run start',
    url: 'http://127.0.0.1:3001',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      BOT_TOKEN: 'e2e-bot-token',
      DATABASE_PATH: 'homed.e2e.sqlite',
    },
  },
});
