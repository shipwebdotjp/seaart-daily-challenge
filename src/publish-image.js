const puppeteer = require('puppeteer-core');
async function publishImage(pageUrl, imageId, title, description, opts = {}) {
    // Backwards-compatibility: if caller passed an options object as the first argument,
    // treat that as opts and fall back to default pageUrl.
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
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout });

        // Extra time for client-side rendering. Some remote puppeteer builds may not support page.waitForTimeout.
        await new Promise(resolve => setTimeout(resolve, waitForRenderMs));

        const dialog = await page.$('.el-dialog__wrapper.activity-post-guide-dialog');
        if (dialog) {
            const closeBtn = await dialog.$('.button-item.active');
            if (closeBtn) {
                await closeBtn.click();
            }
        }else{
            // .go-submit-btnのクリックを最大3回試行
            const maxRetries = 3;
            let retryCount = 0;
            let modalOpened = false;

            while (retryCount < maxRetries && !modalOpened) {
                try {
                    // console.log(`go-submit-btnをクリックします (試行 ${retryCount + 1}/${maxRetries})`);

                    await page.waitForSelector('.go-submit-btn', { visible: true, timeout: 5000 });
                    await page.click('.go-submit-btn');
                    await sleep(500);

                    // モーダルが開いたかチェック（短いタイムアウトで）
                    await page.waitForSelector('.selector-for-work .waterfall-wrapper .waterfall-item-wrapper', {
                        visible: true,
                        timeout: 3000
                    });

                    modalOpened = true;
                    // console.log('モーダルが正常に開きました');

                } catch (error) {
                    retryCount++;
                    console.log(`モーダルが開きませんでした。試行 ${retryCount}/${maxRetries} 失敗: ${error.message}`);

                    if (retryCount < maxRetries) {
                        console.log('少し待ってから再試行します...');
                        await sleep(1000); // 再試行前に1秒待機
                    }
                }
            }

            // 全ての試行が失敗した場合
            if (!modalOpened) {
                throw new Error(`${maxRetries}回の試行でモーダルを開くことができませんでした`);
            }
        }

        const items = await page.$$('.selector-for-work .waterfall-wrapper .waterfall-item-wrapper');
        let found = false;
        if (!items || items.length === 0) {
            throw new Error('画像選択の要素が見つかりません。');
        }
        // console.log(`Found ${items.length} items, searching for imageId: ${imageId}`);

        // 各要素をチェックして、該当するものをクリック
        for (const item of items) {
            // その要素内の.item-media要素を取得
            const itemMedia = await item.$('.item-media');

            if (itemMedia) {
                // background-imageのスタイルを取得
                const backgroundImage = await itemMedia.evaluate(el =>
                    window.getComputedStyle(el).backgroundImage
                );
                //debug
                // console.log(`Checking item with background image: ${backgroundImage}`);
                // backgroundImageは"url("で始まり、")"で終わる形式なので、そこからURL部分を抽出
                // 例: url("https://cdn.seaart.ai/...")
                const imageUrlMatch = backgroundImage.match(/url\("(.*?)"\)/);
                const imageUrl = imageUrlMatch ? imageUrlMatch[1] : null;
                if (imageUrl && imageUrl.includes(imageId)) {
                    // console.log(`見つかりました1: ${imageId}`);
                    const itemParent = await item.getProperty('parentElement');
                    if (itemParent) {
                        const parent = itemParent.asElement();
                        if (parent) {
                            // console.log('親をクリックします');
                            await parent.evaluate(el => el.click());
                        } else {
                            await itemMedia.click();
                        }
                    } else {
                        await itemMedia.click();
                    }
                    found = true;
                    break; // 最初に見つかったものをクリックして終了
                }
            }else{
                console.log('itemMedia not found for an item, skipping.');
            }
        }
        if (!found) {
            throw new Error(`指定されたimageIdの要素が見つかりません: ${imageId}`);
        }
        // console.log('画像を選択しました。確認ボタンを押します...');
        // wait for modal
        await page.waitForSelector('.selector-for-work .footer .operation .confirm-btn', { visible: true, timeout: 5000 });
        // click confirm button
        await page.click('.selector-for-work .footer .operation .confirm-btn');
        await sleep(500);
        // console.log('確認ボタンを押しました。タイトルと説明を入力します...');

        // wait for publish modal
        await page.waitForSelector('.publish-work .el-form-item__content > .el-input .el-input__inner', { visible: true, timeout: 10000 });
        const title_input = await page.$('.publish-work .el-form-item__content > .el-input .el-input__inner');
        if (title_input) {
            try {
                await page.focus('.publish-work .el-form-item__content > .el-input .el-input__inner').catch(() => { });
                //await sleep(200);

                //triple click to select existing content
                await page.click('.publish-work .el-form-item__content > .el-input .el-input__inner', { clickCount: 3 }).catch(() => { });
                await sleep(500);

                await page.keyboard.press('Backspace').catch(() => { });

                await sleep(500);
                await page.keyboard.type(title, { delay: 20 }).catch(() => { });
            } catch (e) {
                // swallow
            }
        }
        const desc_input = await page.$('.publish-work .el-form-item__content > .el-textarea .el-textarea__inner');
        if (desc_input) {
            try {
                await page.focus('.publish-work .el-form-item__content > .el-textarea .el-textarea__inner').catch(() => { });
                //await sleep(200);

                //triple click to select existing content
                await page.click('.publish-work .el-form-item__content > .el-textarea .el-textarea__inner', { clickCount: 3 }).catch(() => { });
                await sleep(500);

                await page.keyboard.press('Backspace').catch(() => { });

                await sleep(500);
                await page.keyboard.type(description, { delay: 20 }).catch(() => { });
            } catch (e) {
                // swallow
            }
        }
        // click publish button
        await page.click('.publish-work .confirm-btn');
        // wait for modal to close
        await page.waitForSelector('.publish-work', { hidden: true, timeout: 10000 });
        console.log('画像が正常に公開されました！');
    

        return {
            success: true,
            imageId
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
module.exports = { publishImage };

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}