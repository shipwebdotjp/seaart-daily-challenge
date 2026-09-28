const puppeteer = require('puppeteer-core');
async function publishImage(pageUrl, imageId, title, description, opts = {}) {
    if (typeof pageUrl === 'object' && pageUrl !== null) {
        opts = pageUrl;
        pageUrl = opts.pageUrl || 'https://www.seaart.ai/ja/event-center/daily';
    } else {
        pageUrl = pageUrl || 'https://www.seaart.ai/ja/event-center/daily';
    }

    const {
        browser: providedBrowser = null,
        browserURL = 'http://127.0.0.1:9222',
        timeout = 30000,
        waitForRenderMs = 2000
    } = opts;

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

        // 4. 画像を選択
        const items = await page.$$('.resource-selector .selector-for-work .waterfall-wrapper .waterfall-item-wrapper');
        let found = false;
        if (!items || items.length === 0) {
            throw new Error('画像選択の要素が見つかりません。');
        }

        for (const item of items) {
            const itemMedia = await item.$('.item-media');
            if (itemMedia) {
                const backgroundImage = await itemMedia.evaluate(el =>
                    window.getComputedStyle(el).backgroundImage
                );
                const imageUrlMatch = backgroundImage.match(/url\("(.*?)"\)/);
                const imageUrl = imageUrlMatch ? imageUrlMatch[1] : null;
                if (imageUrl && imageUrl.includes(imageId)) {
                    const itemParent = await item.getProperty('parentElement');
                    if (itemParent) {
                        const parent = itemParent.asElement();
                        if (parent) {
                            await parent.evaluate(el => el.click());
                        } else {
                            await itemMedia.click();
                        }
                    } else {
                        await itemMedia.click();
                    }
                    found = true;
                    break;
                }
            }
        }
        if (!found) {
            throw new Error(`指定されたimageIdの要素が見つかりません: ${imageId}`);
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
            imageId
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
