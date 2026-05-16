// ═══════════════════════════════════════════════════════════════════════════════
// FLOWPROXY.JS PATCH — Image Upload Support
// ═══════════════════════════════════════════════════════════════════════════════
//
// Make TWO changes to your existing flowProxy.js file:
//
// ── CHANGE 1 ─────────────────────────────────────────────────────────────────
// Add this helper function BEFORE browserGenerateImage function.
// Search for "async function browserGenerateImage" and paste this ABOVE it.
// ─────────────────────────────────────────────────────────────────────────────

async function uploadReferenceImage(page, filePath) {
  const fs = require('fs');
  if (!filePath || !fs.existsSync(filePath)) {
    console.warn('[FlowProxy:BROWSER] Reference image not found, skipping upload:', filePath);
    return false;
  }

  console.log(`[FlowProxy:BROWSER] Uploading reference image: ${require('path').basename(filePath)}`);

  try {
    // Strategy 1: Set file directly on any visible file input
    // Playwright can set files on hidden inputs without clicking
    const fileInputs = await page.$$('input[type="file"]');
    for (const inp of fileInputs) {
      try {
        await inp.setInputFiles(filePath);
        console.log('[FlowProxy:BROWSER] ✅ Reference image set via input[type="file"]');
        await sleep(2500); // wait for upload to process in Flow's UI
        return true;
      } catch {}
    }

    // Strategy 2: Click the + / attach button to reveal file input, then set
    // Google Flow's toolbar has a + button that opens an upload sheet
    const plusResult = await page.evaluate(() => {
      const input = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
      if (!input) return null;
      const inputRect = input.getBoundingClientRect();

      // Look for + or upload buttons near the input (within 100px)
      const allBtns = Array.from(document.querySelectorAll('button, [role="button"], label'));
      const candidates = allBtns.filter(b => {
        const r   = b.getBoundingClientRect();
        const txt = (b.innerText || b.getAttribute('aria-label') || b.textContent || '').trim().toLowerCase();
        const isNearInput = Math.abs((r.top + r.height / 2) - (inputRect.top + inputRect.height / 2)) < 100;
        const isPlus      = txt === '+' || txt.includes('add') || txt.includes('attach') || txt.includes('upload');
        return isNearInput && isPlus && r.width > 15 && r.height > 15;
      });

      if (candidates.length > 0) {
        const r = candidates[0].getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      return null;
    });

    if (plusResult) {
      await page.mouse.click(plusResult.x, plusResult.y);
      console.log('[FlowProxy:BROWSER] Clicked + button for upload');
      await sleep(1000);

      // Now try to find and set the file input that appeared
      const newInputs = await page.$$('input[type="file"]');
      for (const inp of newInputs) {
        try {
          await inp.setInputFiles(filePath);
          console.log('[FlowProxy:BROWSER] ✅ Reference image uploaded via + button');
          await sleep(2500);
          return true;
        } catch {}
      }
    }

    // Strategy 3: Use page.locator which auto-waits
    try {
      const locator = page.locator('input[type="file"]').first();
      await locator.setInputFiles(filePath, { timeout: 5000 });
      console.log('[FlowProxy:BROWSER] ✅ Reference image set via locator');
      await sleep(2500);
      return true;
    } catch {}

    console.warn('[FlowProxy:BROWSER] ⚠️ Could not upload reference image — generating without it');
    return false;

  } catch (err) {
    console.warn(`[FlowProxy:BROWSER] Upload warning (non-fatal): ${err.message}`);
    return false;
  } finally {
    // Clean up the temp file after use (regardless of success/failure)
    try {
      if (filePath) {
        const fs = require('fs');
        fs.unlinkSync(filePath);
        console.log('[FlowProxy:BROWSER] Temp reference image cleaned up');
      }
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── CHANGE 2 ─────────────────────────────────────────────────────────────────
// Inside browserGenerateImage, find this comment/code block:
//
//   console.log(`[FlowProxy:BROWSER] Input: ${inputSel}`);
//
//   await inputEl.click(); await sleep(400);
//   await genPage.keyboard.press('Control+A');
//   await inputEl.type(prompt, { delay: 40 });
//
// ADD the upload call BETWEEN finding inputEl and typing the prompt.
// The result should look like this:
// ─────────────────────────────────────────────────────────────────────────────

/*
    console.log(`[FlowProxy:BROWSER] Input: ${inputSel}`);

    // ── REFERENCE IMAGE UPLOAD (if provided) ─────────────────────────────────
    if (options?.reference_image_path) {
      await uploadReferenceImage(genPage, options.reference_image_path);
    }
    // ─────────────────────────────────────────────────────────────────────────

    await inputEl.click(); await sleep(400);
    await genPage.keyboard.press('Control+A');
    await inputEl.type(prompt, { delay: 40 });
*/

// ═══════════════════════════════════════════════════════════════════════════════
// THAT'S IT. Only these 2 changes needed in flowProxy.js.
// All other files (ImagePage.jsx, api.js, server.js, generate.js) are complete.
// ═══════════════════════════════════════════════════════════════════════════════
