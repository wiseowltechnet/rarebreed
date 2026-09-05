// playwright.config.ts
// Replaces: Selenium WebDriver config / Selenide settings
// Configures which browsers, base URL, and auto-starts the server

import { defineConfig } from "@playwright/test";

export default defineConfig({
  // Test files location — separate from Vitest unit/integration tests
  testDir: "./tests/browser",

  // Timeout per test — like Selenium's implicit/explicit waits
  // But Playwright auto-waits, so this is just a safety net
  timeout: 30_000,

  // Retry failed tests once (flaky network, slow CI)
  retries: 1,

  // Run tests sequentially (browser tests are heavier than unit tests)
  fullyParallel: false,

  // Reporter — like Selenide's screenshots + Allure reports
  reporter: [["html", { open: "never" }]],

  // Browser config — like choosing ChromeDriver vs GeckoDriver
  use: {
    baseURL: "http://localhost:3001", // test server port (avoids conflict with dev)
    headless: true,                   // no visible browser window in CI
    screenshot: "only-on-failure",    // like Selenide's auto-screenshots
    trace: "on-first-retry",          // records full trace on retry (debugging gold)
  },

  // Projects = which browsers to test
  // Like running Selenium against Chrome, Firefox, Safari
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],

  // Auto-start the server before tests — like @SpringBootTest starting the app
  webServer: {
    command: "node dist/server.js",
    port: 3001,
    env: { PORT: "3001" }, // override port for test isolation
    reuseExistingServer: !process.env["CI"], // reuse in dev, fresh in CI
  },
});
