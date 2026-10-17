import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./tests',
  testMatch:'*.spec.ts',
  timeout:120_000,
  expect:{timeout:30_000},
  workers:1,
  reporter:'list',
  outputDir:'../../../tmp/bike-validation/test-results',
  webServer:{
    command:process.env.BIKE_TEST_PRODUCTION==='1'?'node server.mjs':'node ../node_modules/vite/bin/vite.js --config ../vite.bike.config.ts',
    url:'http://127.0.0.1:5193',
    reuseExistingServer:true,
    timeout:60_000,
  },
  use:{
    baseURL:'http://127.0.0.1:5193',
    channel:'chrome',
    headless:true,
    viewport:{width:1440,height:900},
    launchOptions:{args:['--enable-webgl','--ignore-gpu-blocklist']},
    screenshot:'only-on-failure',
  },
});
