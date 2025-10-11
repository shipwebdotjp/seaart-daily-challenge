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
  let dataId = null;
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

    const page = await browser.pages().then(pages => pages[0] || browser.newPage());
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(pageUrl, { waitUntil: 'load', timeout });

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
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const dialog = await page.$('.el-dialog__wrapper');
    if (dialog) {
      const closeBtn = await dialog.$('.content-right-close');
      if (closeBtn) {
        await closeBtn.click();
        sleep(1000);
      }
    }

    const postDialog = await page.$('.el-dialog__wrapper.activity-post-guide-dialog');
    if (postDialog) {
      const closeBtn = await postDialog.$('.button-item:not(.active)');
      if (closeBtn) {
        await closeBtn.click();
        sleep(1000);
      }
    }

    // Robustly wait for the input and ensure it actually has focus before typing.
    async function waitForAndEnsureFocus(selector, opts = {}) {
      const {
        perTryTimeout = 3000,
        maxRetries = 8, // 確実性を上げるためリトライ回数を増やす
        retryDelay = 500, // リトライ遅延を少し増やす
      } = opts;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await page.waitForSelector(selector, { visible: true, timeout: perTryTimeout });

          // bring into view
          await page.evaluate(sel => {
            const e = document.querySelector(sel);
            if (e && e.scrollIntoView) e.scrollIntoView({ block: 'center', inline: 'center' });
          }, selector).catch(() => {});

          // extended operability check inside page
          const operable = await page.evaluate(sel => {
            const el = document.querySelector(sel);
            if (!el) return { ok: false, reason: 'not-found' };
            const style = window.getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity || '1') === 0) {
              return { ok: false, reason: 'not-visible' };
            }
            if (el.disabled || el.readOnly) return { ok: false, reason: 'disabled-or-readonly' };
            if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return { ok: false, reason: 'aria-hidden' };
            // additional checks for focusability
            if (style.pointerEvents === 'none') return { ok: false, reason: 'pointer-events-none' };
            if (parseInt(style.zIndex || '0', 10) < 0) return { ok: false, reason: 'negative-zindex' };
            return { ok: true, contenteditable: el.isContentEditable };
          }, selector).catch(() => ({ ok: false, reason: 'evaluate-failed' }));

          // If not operable, wait and retry
          if (!operable.ok) {
            // capture debug info on last attempt
            if (attempt === maxRetries) {
              const dbg = await getElementDebug(selector).catch(() => null);
              throw new Error(`Element not operable: ${operable.reason} debug=${JSON.stringify(dbg)}`);
            }
            await new Promise(r => setTimeout(r, retryDelay));
            continue;
          }

          // Multiple focus attempts in sequence
          // First: try PuppETEer's page.focus (preferred in newer versions)
          try {
            await page.focus(selector);
            await new Promise(r => setTimeout(r, 100)); // small pause
          } catch (e) {}

          // Second: click and dispatch events via evaluate
          await page.evaluate(sel => {
            const el = document.querySelector(sel);
            if (!el) return;
            try {
              el.focus && el.focus();
              // dispatch multiple events for better framework support
              el.dispatchEvent(new Event('focus', { bubbles: true }));
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              el.dispatchEvent(new Event('click', { bubbles: true }));
            } catch (e) {}
          }, selector).catch(() => {});

          // Third: if still not focused, try tab navigation
          const focused1 = await page.waitForFunction(sel => {
            const el = document.querySelector(sel);
            if (!el) return false;
            if (document.activeElement === el) return true;
            if (el.contains(document.activeElement)) return true;
            return false;
          }, { timeout: 500 }, selector).catch(() => null);

          if (!focused1) {
            // try tab to reach this element
            await page.keyboard.press('Tab');
            await new Promise(r => setTimeout(r, 100));
            const focusedAfterTab = await page.evaluate(sel => {
              const el = document.querySelector(sel);
              return !!el && (document.activeElement === el || el.contains(document.activeElement));
            }, selector).catch(() => false);
            if (focusedAfterTab) return true;
          } else {
            return true;
          }

          // Fallback: click at center coordinates
          const box = await page.$eval(selector, el => {
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
          }).catch(() => null);

          if (box) {
            await page.mouse.click(box.x, box.y).catch(() => {});
            await new Promise(r => setTimeout(r, 150));
            const focused2 = await page.evaluate(sel => {
              const el = document.querySelector(sel);
              return !!el && (document.activeElement === el || el.contains(document.activeElement));
            }, selector).catch(() => false);
            if (focused2) return true;
          }

          // not focused, retry
          await new Promise(r => setTimeout(r, retryDelay));
        } catch (e) {
          if (attempt === maxRetries) {
            const dbg = await getElementDebug(selector).catch(() => null);
            throw new Error(`Failed to focus ${selector} after ${maxRetries} attempts. lastError=${e && e.message} debug=${JSON.stringify(dbg)}`);
          }
          await new Promise(r => setTimeout(r, retryDelay));
        }
      }
      throw new Error(`Failed to focus ${selector}`);
    }
    await sleep(1000);
    await waitForAndEnsureFocus('#easyGenerateInput', { perTryTimeout: 3000, maxRetries: 6, retryDelay: 300 });
    await sleep(1000);

    const textarea = await page.$('#easyGenerateInput');
    if (textarea) {
      // ensure selection cleared and input prepared
      try {
        // triple click to select existing content then clear
        await page.click('#easyGenerateInput', { clickCount: 3 }).catch(() => {});
        await sleep(200);
        await page.keyboard.press('Backspace').catch(() => {});
        await sleep(200);

        // Attempt typing; if that fails, fallback to setting value directly
        let typed = false;
        try {
          await page.keyboard.type(prompt, { delay: 20 });
          typed = true;
        } catch (e) {
          console.warn('Typing failed, falling back to value setting:', e.message);
          typed = false;
        }

        if (!typed) {
          await page.evaluate((sel, val) => {
            const el = document.querySelector(sel);
            if (!el) return;
            try {
              if ('value' in el) {
                el.value = val;
              } else if (el.isContentEditable) {
                el.innerText = val;
              }
              // dispatch multiple events to ensure reactivity in frameworks like React/Vue
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
            } catch (e) {}
          }, '#easyGenerateInput', prompt);
        }

        // Verify that the input was set correctly
        await sleep(500); // allow time for events to propagate
        const inputValue = await page.evaluate(sel => {
          const el = document.querySelector(sel);
          return el ? (el.value || el.innerText || '').trim() : '';
        }, '#easyGenerateInput');

        if (inputValue !== prompt.trim()) {
          console.warn(`Input verification failed. Expected: "${prompt}", Got: "${inputValue}"`);
          // Retry set value once more
          await page.evaluate((sel, val) => {
            const el = document.querySelector(sel);
            if (!el) return;
            try {
              if ('value' in el) el.value = val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {}
          }, '#easyGenerateInput', prompt);
          await sleep(200); // wait after retry
        } else {
          console.log('Input value verified successfully.');
        }
      } catch (e) {
        // capture debug info but continue to attempt generate
        const afterDebug = await getElementDebug('#easyGenerateInput').catch(() => null);
        console.error('Input set error debug:', afterDebug);
      }

      const afterDebug = await getElementDebug('#easyGenerateInput').catch(() => null);
      // console.log('afterDebug:', JSON.stringify(afterDebug, null, 2));
    } else {
      throw new Error('Prompt textarea not found on the page.');
    }

      // finde button id=generate-btn and click it
    const generateBtn = await page.$('#generate-btn');
    if (generateBtn) {
      await generateBtn.click().catch(() => {});
    }

    await page.waitForSelector('.process-operate-box-text', { visible: true, timeout: 5000 });
    // console.log('処理が開始されました！');

    await page.waitForSelector('.message-process-container', {
      hidden: true,
      timeout: 180000 // 最大180秒待機
    });

    console.log('画像生成が完了しました！');
    await sleep(1000);

    // 1. 最後の .viewport-item を取得
    const items = await page.$$('.scroll-wrapper > .viewport-item');
    const lastItem = items[items.length - 1];

    if (lastItem) {
      // 2. その子孫から目的の div を探す
      const target = await lastItem.$('.msg-item-header-operate-bar-refresh-btn .icon-refresh-icon2');

      if (target) {
        // target parent
        const parent = await target.getProperty('parentNode');
        
        // 3. data-id 属性を取得
        // const dataId = await target.evaluate(el => el.getAttribute('data-id'));
        dataId = await parent.evaluate(el => el.dataset.id); // dataset で取得もOK
        //debug
        // console.log('target debug:', await getElementDebug('.msg-item-header-operate-bar-refresh-btn'));
        // console.log('取得した data-id:', dataId);
      } else {
        console.log('ターゲット要素が見つかりませんでした');
      }
    } else {
      console.log('最後の .viewport-item が見つかりませんでした');
    }

    return {
      dataId
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
