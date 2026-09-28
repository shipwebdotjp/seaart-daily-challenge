const puppeteer = require('puppeteer-core');

// 生成画像URLから照合用キーを抜き出す
// 例: https://image.cdn2.seaart.me/2026-09-28/dat2c7le878c73cocnp0/3c4b4ecae120dcaf0256b1840b767148_high.webp
//  -> fileId: 3c4b4ecae120dcaf0256b1840b767148, middleId: dat2c7le878c73cocnp0
function extractUrlKeys(url) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
    try {
        const u = new URL(url);
        const segs = u.pathname.split('/').filter(Boolean);
        const fileWithExt = segs[segs.length - 1] || '';
        // 拡張子除去 + _high / _small 等のサイズサフィックス除去
        const fileId = fileWithExt
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/_(high|small|medium|thumb|thumbnail|preview|low|origin|large|mini|tiny|compressed).*/i, '');
        // dat... のような中間IDセグメント (日付 2026-09-28 は除外)
        const middleId = segs.length >= 2
            ? segs.filter(s => !/^\d{4}-\d{2}-\d{2}$/.test(s) && s !== fileWithExt).pop() || null
            : null;
        return { full: url, fileId: fileId || null, middleId };
    } catch (_) {
        return null;
    }
}

function isUrlIdentifier(v) {
    return typeof v === 'string' && /^https?:\/\//.test(v);
}

async function publishImage(pageUrl, imageId, title, description, opts = {}) {
    if (typeof pageUrl === 'object' && pageUrl !== null) {
        opts = pageUrl;
        pageUrl = opts.pageUrl || 'https://www.seaart.ai/ja/event-center/daily';
    } else {
        pageUrl = pageUrl || 'https://www.seaart.ai/ja/event-center/daily';
    }

    let {
        browser: providedBrowser = null,
        browserURL = 'http://127.0.0.1:9222',
        timeout = 30000,
        waitForRenderMs = 2000,
        // URLベース特定用 (後方互換: 第2引数にもURL/旧data-idを渡せる)
        imageUrl: optImageUrl = null,
        imageUrls: optImageUrls = [],
        imageId: optImageId = null
    } = opts;

    // 識別子の正規化: 第2引数が {imageUrl,...} オブジェクトの場合も許容
    if (typeof imageId === 'object' && imageId !== null) {
        const obj = imageId;
        Object.assign(opts, obj.opts || {});
        imageId = obj.imageUrl || obj.imageId || obj.dataId || optImageUrl || optImageId;
        if (!optImageUrl && obj.imageUrl) optImageUrl = obj.imageUrl;
        if (obj.imageUrls && obj.imageUrls.length) optImageUrls = obj.imageUrls;
    }
    // opts側のURL指定を優先的に使う
    const primaryImageUrl = optImageUrl || (isUrlIdentifier(imageId) ? imageId : null);
    const candidateUrls = [
        ...(Array.isArray(optImageUrls) ? optImageUrls : []),
        ...(primaryImageUrl ? [primaryImageUrl] : []),
    ].filter(Boolean);
    const urlKeysList = candidateUrls.map(extractUrlKeys).filter(Boolean);
    // 旧data-id (URLではない識別子) はフォールバック照合用に保持
    const legacyId = !isUrlIdentifier(imageId) && imageId ? String(imageId) : (optImageId && !isUrlIdentifier(optImageId) ? String(optImageId) : null);

    let browser = providedBrowser;
    let createdBrowser = false;

    try {
        if (!browser) {
            browser = await puppeteer.connect({ browserURL });
            createdBrowser = true;
        }

        const page = await browser.pages().then(pages => pages[0] || browser.newPage());
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(pageUrl, { waitUntil: 'load', timeout });

        await new Promise(resolve => setTimeout(resolve, waitForRenderMs));

        // 1. go-submit-btn をクリックしてドロップダウンを開く
        await page.waitForSelector('.go-submit-btn', { visible: true, timeout: 5000 });
        await page.click('.go-submit-btn');
        await sleep(500);

        // 2. ドロップダウン内の最初のButtonをクリックして投稿モーダルを開く
        let modalOpened = false;
        const maxRetries = 3;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await page.waitForSelector('.submit-dropdown button', { visible: true, timeout: 5000 });
                const buttons = await page.$$('.submit-dropdown button');
                if (buttons.length === 0) {
                    throw new Error('.submit-dropdown 内にボタンが見つかりません');
                }
                await buttons[1].click();
                await sleep(500);
                await page.waitForSelector('.contribution-popup', { visible: true, timeout: 5000 });
                modalOpened = true;
                break;
            } catch (err) {
                console.log(`投稿モーダルを開けませんでした。試行 ${i + 1}/${maxRetries}: ${err.message}`);
                if (i < maxRetries - 1) {
                    await sleep(1000);
                }
            }
        }
        if (!modalOpened) {
            throw new Error(`${maxRetries}回の試行で投稿モーダルを開くことができませんでした`);
        }

        // 2. 作品選択の add-btn をクリック（リソースセレクターを開く）
        await page.waitForSelector('.resource-item .add-btn', { visible: true, timeout: 5000 });
        await page.click('.resource-item .add-btn');
        await sleep(500);

        // 3. リソースセレクター（画像選択モーダル）が開くのを待つ
        let resourceOpened = false;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await page.waitForSelector('.resource-selector', { visible: true, timeout: 5000 });
                await sleep(300);
                await page.waitForSelector('.resource-selector .selector-for-work .waterfall-wrapper .waterfall-item-wrapper', {
                    visible: true,
                    timeout: 5000
                });
                resourceOpened = true;
                break;
            } catch (error) {
                console.log(`リソースセレクターが開きませんでした。試行 ${i + 1}/${maxRetries}: ${error.message}`);
                if (i < maxRetries - 1) {
                    await page.click('.resource-item .add-btn');
                    await sleep(1000);
                }
            }
        }
        if (!resourceOpened) {
            throw new Error(`${maxRetries}回の試行でリソースセレクターを開くことができませんでした`);
        }

        // 4. 画像を選択 (URLベース照合 / 旧data-idはフォールバック)
        const items = await page.$$('.resource-selector .selector-for-work .waterfall-wrapper .waterfall-item-wrapper');
        let found = false;
        if (!items || items.length === 0) {
            throw new Error('画像選択の要素が見つかりません。');
        }

        const matchByUrlKeys = (candidateUrl) => {
            if (!candidateUrl || urlKeysList.length === 0) return null;
            for (const keys of urlKeysList) {
                if (!keys) continue;
                // 完全一致 (クエリ無視でも一致)
                if (keys.full && (candidateUrl === keys.full || candidateUrl.split('?')[0] === keys.full.split('?')[0])) {
                    return keys;
                }
                // fileId (ハッシュ部) で照合: _high/_small 等の差異を吸収
                if (keys.fileId && keys.fileId.length >= 8 && candidateUrl.includes(keys.fileId)) {
                    return keys;
                }
                // middleId (dat...部) で照合
                if (keys.middleId && keys.middleId.length >= 8 && candidateUrl.includes(keys.middleId)) {
                    return keys;
                }
            }
            return null;
        };

        const debugCandidates = [];
        for (const item of items) {
            // 候補URLを複数経路で収集 (background-image だけでなく img[src] も見る: 仕様変更対策)
            const candidateUrlsInItem = await item.evaluate(el => {
                const urls = [];
                const push = v => {
                    if (typeof v === 'string' && /^https?:\/\//.test(v.trim())) urls.push(v.trim());
                };
                const media = el.querySelector('.item-media');
                const targets = media ? [media, ...media.querySelectorAll('*')] : [el, ...el.querySelectorAll('*')];
                for (const n of targets) {
                    try {
                        const bg = window.getComputedStyle(n).backgroundImage;
                        if (bg && bg !== 'none') {
                            const re = /url\(["']?(.*?)["']?\)/g;
                            let m;
                            while ((m = re.exec(bg)) !== null) push(m[1]);
                        }
                    } catch (_) {}
                }
                el.querySelectorAll('img').forEach(img => {
                    push(img.currentSrc || img.src);
                    const ds = img.getAttribute('data-src');
                    if (ds) push(ds);
                });
                return [...new Set(urls)];
            });
            if (candidateUrlsInItem.length > 0 && debugCandidates.length < 10) {
                debugCandidates.push(candidateUrlsInItem[0]);
            }

            let matched = false;
            let matchedKeys = null;
            for (const c of candidateUrlsInItem) {
                matchedKeys = matchByUrlKeys(c);
                if (matchedKeys) { matched = true; break; }
                // 旧data-idフォールバック (data-vl-id と thumbnail が紐付いていた頃の挙動)
                if (!matched && legacyId && c.includes(legacyId)) { matched = true; break; }
            }
            if (matched) {
                const clickable = await item.$('.item-media');
                const target = clickable || item;
                // waterfallの親ラッパーがクリック対象の場合があるため、まずitem自体をクリック
                try {
                    await target.evaluate(el => el.click());
                } catch (_) {
                    await target.click().catch(() => {});
                }
                console.log('画像を選択しました:', matchedKeys ? (matchedKeys.fileId || matchedKeys.full) : legacyId);
                found = true;
                break;
            }
        }
        if (!found) {
            console.log('画像選択ダイアログ内の候補URL (先頭10件):', debugCandidates);
            console.log('照合に使った生成URL:', candidateUrls);
            throw new Error(`指定された画像の要素が見つかりません: ${primaryImageUrl || legacyId || imageId}`);
        }

        // 5. リソースセレクターの確認ボタンをクリック
        await page.waitForSelector('.resource-selector .selector-footer .operation .confirm-btn:not(.disabled)', { visible: true, timeout: 5000 });
        await page.click('.resource-selector .selector-footer .operation .confirm-btn');
        await sleep(500);

        // 6. タイトルを入力
        await page.waitForSelector('.publish-form-title .title-input .el-input__inner', { visible: true, timeout: 5000 });
        await page.focus('.publish-form-title .title-input .el-input__inner').catch(() => { });
        await sleep(500);
        await page.keyboard.type(title, { delay: 20 }).catch(() => { });

        // 7. 説明を入力（リッチエディタ）
        const descEditor = await page.$('.post-rich-editor .ql-editor');
        if (descEditor) {
            try {
                await page.focus('.post-rich-editor .ql-editor').catch(() => { });
                await sleep(500);
                await page.keyboard.type(description, { delay: 20 }).catch(() => { });
            } catch (e) {
            }
        } else {
            console.log('説明入力欄が見つかりません。');
        }

        // 8. 投稿ボタンをクリック
        await page.waitForSelector('.publish-footer-bar .confirm-btn:not(.disabled)', { visible: true, timeout: 5000 });
        await page.click('.publish-footer-bar .confirm-btn');

        // 9. モーダルが閉じるのを待つ
        await page.waitForSelector('.contribution-popup', { hidden: true, timeout: 20000 });
        console.log('画像が正常に公開されました！');

        return {
            success: true,
            imageId: primaryImageUrl || legacyId || imageId,
            imageUrl: primaryImageUrl,
            imageIdLegacy: legacyId || null
        };
    } catch (err) {
        throw err;
    } finally {
        if (createdBrowser && browser && typeof browser.disconnect === 'function') {
            try {
                await browser.disconnect();
            } catch (e) {
            }
        }
    }
}
module.exports = { publishImage };

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
