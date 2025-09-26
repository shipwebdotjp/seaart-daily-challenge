const puppeteer = require('puppeteer-core');

/**
 * Fetch theme and description from SeaArt daily page.
 *
 * Options:
 *  - browser: an existing puppeteer Browser instance (optional). If provided, this function will NOT disconnect it.
 *  - browserURL: remote debugging URL to connect when `browser` not provided (default: 'http://127.0.0.1:9222')
 *  - pageUrl: page to navigate to (default: 'https://www.seaart.ai/ja/event-center/daily')
 *  - timeout: navigation timeout in ms (default: 30000)
 *  - waitForRenderMs: additional wait time for client rendering in ms (default: 800)
 *
 * Returns:
 *  { theme: string | null, description: string | null, debug?: { themeSpanDebug, descriptionDebug } }
 *
 * Throws on navigation/connection errors.
 */
async function generateImage(opts = {}) {
  const {
    browser: providedBrowser = null,
    browserURL = 'http://127.0.0.1:9222',
    pageUrl = 'https://www.seaart.ai/ja/create/image?id=f8172af6747ec762bcf847bd60fdf7cd&model_ver_no=2c39fe1f-f5d6-4b50-a273-499677f2f7a9',
    timeout = 30000,
    waitForRenderMs = 2000,
    prompt = 'masterpiece, best quality, a beautiful landscape, mountains, sunrise, photorealistic, detailed, vibrant colors, 2:3',
  } = opts;

  let browser = providedBrowser;
  let createdBrowser = false;
  const sleep = milliseconds =>
    new Promise(resolve =>
      setTimeout(resolve, milliseconds)
    );
  try {
    if (!browser) {
      // connect to remote Chrome
      browser = await puppeteer.connect({ browserURL });
      createdBrowser = true;
    }

    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout });

    // Extra time for client-side rendering. Some remote puppeteer builds may not support sleep.
    await new Promise(resolve => setTimeout(resolve, waitForRenderMs));

    // Helper to extract debugging info for an element (extended)
    async function getElementDebug(selector) {
      const elHandle = await page.$(selector);
      if (!elHandle) return null;
      return page.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const root = el.getRootNode && el.getRootNode();
        const inShadow = root && root.toString && root.toString().includes('ShadowRoot');
        const inIframe = el.ownerDocument !== document;
        const path = [];
        let node = el;
        while (node) {
          path.push(node.nodeName.toLowerCase());
          node = node.parentElement;
        }
        return {
          tagName: el.tagName,
          nodeName: el.nodeName,
          textContent: (el.textContent || '').trim(),
          innerText: el.innerText,
          innerHTML: el.innerHTML,
          value: el.value,
          isContentEditable: el.isContentEditable,
          disabled: el.disabled,
          readOnly: el.readOnly,
          placeholder: el.placeholder,
          role: el.getAttribute && el.getAttribute('role'),
          tabIndex: el.tabIndex,
          boundingClientRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, left: rect.left },
          computedStyle: { display: style.display, visibility: style.visibility, opacity: style.opacity, pointerEvents: style.pointerEvents },
          inShadow,
          inIframe,
          path
        };
      }, elHandle);
    }

    const closeModal = await getElementDebug('.user-daily-close .el-icon-close').catch(() => null);
    if (closeModal) {
      await page.click('.user-daily-close .el-icon-close').catch(() => {});
      // wait a bit for modal to close
      await new Promise(resolve => setTimeout(resolve, 300));
    }

      // find textarea (#easyGenerateInput) and set value to prompt
    const textareaDebug = await getElementDebug('#easyGenerateInput').catch(() => null);
    console.log('textareaDebug:', JSON.stringify(textareaDebug, null, 2));
    const textarea = await page.$('#easyGenerateInput');
    if (textarea) {
      console.log('Found textarea, attempting various input methods...');
      try {
        await page.evaluate(selector => {
          const el = document.querySelector(selector);
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
        }, '#easyGenerateInput');
      } catch (e) {}
      // Try focus + keyboard typing
      try {
        await page.focus('#easyGenerateInput').catch(() => {});
        //await sleep(200);

        //triple click to select existing content
        await page.click('#easyGenerateInput', { clickCount: 3 }).catch(() => {});
        await sleep(500);

        await page.keyboard.press('Backspace').catch(() => {});
        
        await sleep(500);
        await page.keyboard.type(prompt, { delay: 20 }).catch(() => {});
      } catch (e) {
        // swallow
      }
      
      const afterDebug = await getElementDebug('#easyGenerateInput').catch(() => null);
      console.log('afterDebug:', JSON.stringify(afterDebug, null, 2));
    } else {
      throw new Error('Prompt textarea not found on the page.');
    }

      // finde button id=generate-btn and click it
    const generateBtn = await page.$('#generate-btn');
    if (generateBtn) {
      await generateBtn.click().catch(() => {});
    }

    return {
    };
  } catch (err) {
    // Propagate error to caller to decide how to handle
    throw err;
  } finally {
    // If we opened the connection here, disconnect but don't close the remote Chrome instance.
    if (createdBrowser && browser && typeof browser.disconnect === 'function') {
      try {
        await browser.disconnect();
      } catch (e) {
        // swallow disconnect errors silently
      }
    }
  }
}

module.exports = { generateImage };
