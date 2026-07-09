const puppeteer = require('puppeteer-core');

/**
 * Fetch theme and description from SeaArt daily page.
 *
 * Options:
 *  - browser: an existing puppeteer Browser instance (optional). If provided, this function will NOT disconnect it.
 *  - browserURL: remote debugging URL to connect when `browser` not provided (default: 'http://127.0.0.1:9222')
 *  - pageUrl: page to navigate to (default: 'https://www.seaart.ai/ja/event-center/daily')
 *  - timeout: navigation timeout in ms (default: 60000)
 *  - waitForRenderMs: additional wait time for client rendering in ms (default: 2000)
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
    timeout = 60000,
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
    await page.setViewport({ width: 1920, height: 1080 });

    // Helper: robustly scroll the `.scroll-wrapper` to bottom with multiple fallbacks.
    // This handles ordinary scrollTop, element.scrollIntoView, staged scrolling (for virtualized lists),
    // wheel event dispatch, and a final attempt to click a "go to bottom" button if present.
    async function scrollWrapperToBottom(pageRef) {
      try {
        await pageRef.evaluate(async () => {
          const el = document.querySelector('.scroll-wrapper');
          if (!el) return;
          // 1) direct set
          try { el.scrollTop = el.scrollHeight; } catch (e) {}
          // 2) scroll last item into view if present
          try {
            const items = Array.from(document.querySelectorAll('.scroll-wrapper > .c-easy-msg-item, .scroll-wrapper > .viewport-item'));
            if (items.length) items[items.length - 1].scrollIntoView({ block: 'end', behavior: 'auto' });
          } catch (e) {}
          // 3) staged scrolling to encourage virtualized renderers to materialize items
          try {
            const step = Math.max(200, Math.floor(el.clientHeight * 0.8));
            for (let i = 0; i < 40 && (el.scrollTop + el.clientHeight < el.scrollHeight); i++) {
              el.scrollTop = Math.min(el.scrollTop + step, el.scrollHeight);
              // allow framework to render
              // eslint-disable-next-line no-await-in-loop
              await new Promise(r => setTimeout(r, 120));
            }
          } catch (e) {}
          // 4) dispatch a wheel event as some apps listen to wheel/touch
          try {
            el.dispatchEvent(new WheelEvent('wheel', { deltaY: 10000, bubbles: true, cancelable: true }));
          } catch (e) {}
        });
        // small pause for UI updates
        await pageRef.waitForTimeout(250);

        // 5) fallback: show & click the "go to bottom" button if present
        try {
          // nudge a tiny bit so that the button may appear
          await pageRef.$eval('.scroll-wrapper', el => { if (el) el.scrollTop = Math.min(10, el.scrollHeight); }).catch(() => {});
          await pageRef.waitForTimeout(200);
          const btn = await pageRef.$('.back-to-top .el-icon-caret-bottom');
          if (btn) {
            // ensure it's visible (best-effort) then click
            await pageRef.evaluate(() => {
              const b = document.querySelector('.back-to-top .el-icon-caret-bottom');
              if (b) { b.style.display = 'block'; b.style.visibility = 'visible'; b.style.opacity = '1'; }
            }).catch(() => {});
            await pageRef.waitForTimeout(100);
            await btn.click().catch(() => {});
          }
        } catch (e) {}
      } catch (e) {
        // swallow errors; scrolling is a best-effort utility
      }
    }
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
        await sleep(1000);
      }
    }

    const postDialog = await page.$('.el-dialog__wrapper.activity-post-guide-dialog');
    if (postDialog) {
      const closeBtn = await postDialog.$('.button-item:not(.active)');
      if (closeBtn) {
        await closeBtn.click();
        await sleep(1000);
      }
    }
    
    await scrollWrapperToBottom(page);

    // const goToBottomBtn = await page.$('.back-to-top .el-icon-caret-bottom');
    // if (goToBottomBtn) {
    //   await goToBottomBtn.click();
    //   sleep(1000);
    // }

    await sleep(1000);

    // Set prompt on ALL textareas in the input area. The page may show
    // different textareas depending on the active mode (easy / hybrid /
    // image‑upload).  Setting via the native value descriptor + events
    // ensures the underlying Vue / Pinia store picks up the change.
    await page.evaluate(val => {
      const container = document.querySelector('.top-input-area');
      if (!container) return;
      const desc = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      );
      container.querySelectorAll('textarea').forEach(el => {
        try {
          if (desc && desc.set) desc.set.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } catch (_) {}
      });
    }, prompt);

    await sleep(800);

    // Verify at least one textarea received the value
    const ok = await page.evaluate(expected => {
      const container = document.querySelector('.top-input-area');
      if (!container) return false;
      return Array.from(container.querySelectorAll('textarea')).some(
        t => (t.value || '').trim() === expected
      );
    }, prompt.trim());

    if (!ok) {
      console.warn('Prompt value was not applied to any textarea; retrying once.');
      await page.evaluate(val => {
        const container = document.querySelector('.top-input-area');
        if (!container) return;
        const desc = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        );
        container.querySelectorAll('textarea').forEach(el => {
          try {
            if (desc && desc.set) desc.set.call(el, val);
            else el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            // Additional events that Vue may listen to
            el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
          } catch (_) {}
        });
      }, prompt);
      await sleep(500);
    } else {
      console.log('Prompt value applied successfully.');
    }

      // finde button id=generate-btn and click it
    const generateBtn = await page.$('#generate-btn');
    if (generateBtn) {
      await generateBtn.click().catch(() => {});
    }

    await page.waitForSelector('.process-operate-box-text', { visible: true, timeout: 5000 });
    console.log('画像生成が開始されました！');
    // ページを一番下にスクロールして要素を表示させる
    await scrollWrapperToBottom(page);
    await sleep(1000);

    await page.waitForSelector('.message-process-container', {
      hidden: true,
      timeout: 180000 // 最大180秒待機
    });

    console.log('画像生成が完了しました！');
    await sleep(1000);
    // ページを一番下にスクロールして要素を表示させる
    await scrollWrapperToBottom(page);
    await sleep(1000);

    // 1. 最後の イメージアイテム を取得 (note: items are in a virtual list,
    //    not direct children of .scroll-wrapper).
    const items = await page.$$('.scroll-wrapper .c-easy-msg-item');
    const lastItem = items[items.length - 1];

    if (lastItem) {
      for(let i=0;i<180;i++){
        // 2. その子孫から目的の div を探す
        const target = await lastItem.$('.msg-item-header-operate-bar-refresh-btn .icon-refresh-icon2');

        if (target) {
          // 3. data-vl-id を .c-easy-msg-item から取得
          dataId = await lastItem.evaluate(el => el.getAttribute('data-vl-id'));
        }
        await sleep(1000);
        await scrollWrapperToBottom(page);

        if(dataId){
          break;
        }
      }
    } else {
      console.log('最後の イメージアイテム が見つかりませんでした');
    }
    console.log('最終的な data-id:', dataId);
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
