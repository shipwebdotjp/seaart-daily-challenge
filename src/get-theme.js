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
async function fetchTheme(opts = {}) {
  const {
    browser: providedBrowser = null,
    browserURL = 'http://127.0.0.1:9222',
    pageUrl = 'https://www.seaart.ai/ja/event-center/daily',
    timeout = 30000,
    waitForRenderMs = 800
  } = opts;

  let browser = providedBrowser;
  let createdBrowser = false;

  try {
    if (!browser) {
      // connect to remote Chrome
      browser = await puppeteer.connect({ browserURL });
      createdBrowser = true;
    }

    const page = await browser.newPage();
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout });

    // Extra time for client-side rendering. Some remote puppeteer builds may not support page.waitForTimeout.
    await new Promise(resolve => setTimeout(resolve, waitForRenderMs));

    // Helper to extract debugging info for an element
    async function getElementDebug(selector) {
      const elHandle = await page.$(selector);
      if (!elHandle) return null;
      return page.evaluate(el => {
        const text = (el.textContent || '').trim();
        const innerHTML = el.innerHTML;
        const children = Array.from(el.childNodes).map(n => {
          return {
            nodeType: n.nodeType,
            nodeName: n.nodeName,
            text: (n.textContent || n.nodeValue || '').trim()
          };
        });
        return { text, innerHTML, children };
      }, elHandle);
    }

    // Get raw info for theme span and description
    const themeSpanDebug = await getElementDebug('.theme-title span').catch(() => null);
    const descriptionDebug = await getElementDebug('.theme-description').catch(() => null);

    // Derive theme using the visible text (if present)
    const themeText = themeSpanDebug ? themeSpanDebug.text : null;
    const themeMatch = themeText ? themeText.match(/本日のテーマは「(.+?)」/) : null;
    const theme = themeMatch ? themeMatch[1] : themeText;

    const description = descriptionDebug ? descriptionDebug.text : null;

    return {
      theme,
      description,
      debug: { themeSpanDebug, descriptionDebug }
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

module.exports = { fetchTheme };
