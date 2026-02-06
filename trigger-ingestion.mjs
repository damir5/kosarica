import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const EVIDENCE_DIR = '.sisyphus/evidence';
const TOKEN_FILE = '.sisyphus/session-token.txt';

const CHAINS = [
  'konzum', 'lidl', 'plodine', 'interspar', 'studenac', 
  'kaufland', 'eurospin', 'dm', 'ktc', 'metro', 'trgocentar'
];

async function run() {
  console.log('Starting automation...');
  
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: EVIDENCE_DIR }
  });
  const page = await context.newPage();

  try {
    // 1. Login
    console.log('Navigating to login...');
    // Navigate to admin/ingestion directly to trigger redirect to login with correct return URL
    await page.goto('http://localhost:3002/admin/ingestion');
    
    // Check if we are on login page
    if (page.url().includes('login')) {
        console.log('Redirected to login page. Waiting for hydration...');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000); // Extra safety for hydration

        console.log('Filling form...');
        await page.fill('input#email', 'admin@dev.local');
        await page.fill('input#password', 'admin123456');
        
        console.log('Submitting...');
        await page.click('button[type="submit"]');
        
        // Wait for redirect back to ingestion
        console.log('Waiting for navigation...');
        await page.waitForURL('**/admin/ingestion', { timeout: 30000 });
    } else {
        console.log('Already on ingestion page? URL:', page.url());
    }

    console.log('Logged in successfully (or already logged in).');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-4-admin-logged-in.png') });

    // 2. Extract Token
    const cookies = await context.cookies();
    const token = cookies.find(c => c.name === 'better-auth.session_token')?.value;
    if (token) {
      fs.writeFileSync(TOKEN_FILE, token);
      console.log('Session token saved.');
    } else {
      console.warn('Session token NOT found in cookies.');
    }

    // 3. Enable Date Range
    console.log('Enabling date range...');
    try {
        const switchSelector = 'button[role="switch"]';
        await page.waitForSelector(switchSelector, { timeout: 10000 });
        const switchEl = page.locator(switchSelector);
        
        const state = await switchEl.getAttribute('data-state');
        if (state !== 'checked') {
            await switchEl.click();
            console.log('Clicked switch.');
        } else {
            console.log('Switch already enabled.');
        }
    } catch (e) {
        console.error('Switch not found:', e);
    }
    
    await page.waitForTimeout(1000); // Wait for UI update
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-4-date-range-enabled.png') });

    // 4. Set Dates
    console.log('Setting dates...');
    await page.waitForSelector('input#range-start', { timeout: 5000 });
    await page.fill('input#range-start', '2026-01-07');
    await page.fill('input#range-end', '2026-02-06');
    await page.keyboard.press('Tab'); // Trigger blur/change
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-4-date-range-set.png') });


    // Helper to wait for enabled/disabled
    const waitForState = async (locator, state, timeout = 30000) => {
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
            const disabled = await locator.isDisabled();
            if (state === 'enabled' && !disabled) return true;
            if (state === 'disabled' && disabled) return true;
            await page.waitForTimeout(500);
        }
        throw new Error(`Timeout waiting for ${state}`);
    };

    // 5. Trigger Chains
    console.log('Triggering chains...');
    for (const chain of CHAINS) {
      console.log(`Triggering ${chain}...`);
      // Try to find button by text (Capitalized)
      const chainName = chain.charAt(0).toUpperCase() + chain.slice(1);
      let namePattern = new RegExp(chain, 'i');
      if (chain === 'dm') namePattern = /DM/i;
      
      const btn = page.getByRole('button', { name: namePattern }).first();
      
      if (await btn.count() === 0) {
         console.error(`Button for ${chain} not found!`);
         continue;
      }

      // Wait for button to be enabled (in case previous chain is still running)
      try {
          await waitForState(btn, 'enabled', 60000);
      } catch (e) {
          console.log(`${chain} button did not become enabled in time. Skipping.`);
          continue;
      }

      await btn.click();
      console.log(`Clicked ${chain}`);

      // Wait for it to become disabled (processing started)
      try {
        await waitForState(btn, 'disabled', 5000);
        console.log(`${chain} processing started (buttons disabled)...`);
        
        // Wait for it to become enabled again (processing finished)
        await waitForState(btn, 'enabled', 120000); // 2 minutes for 37 requests
        console.log(`${chain} processing finished.`);
      } catch (e) {
        console.warn(`State change tracking failed for ${chain}:`, e.message);
      }
      
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `task-4-triggered-${chain}.png`) });
    }

    console.log('All triggers attempted.');
    await page.waitForTimeout(5000); // Wait for final settle
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-4-all-triggered.png') });

  } catch (error) {
    console.error('An error occurred:', error);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'error-screenshot.png') });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'error-page.html'), await page.content());
  } finally {
    await browser.close();
  }
}

run();
