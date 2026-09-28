#!/usr/bin/env node
const puppeteer = require('puppeteer-core');
const OpenAI = require('openai');
const { fetchTheme } = require('./get-theme');
const { generatePrompt } = require('./get-prompt');
const { generateImage } = require('./generate-image');
const { publishImage } = require('./publish-image');
const sites = require('./sites');

(async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set. Set it in the environment and retry.');
    process.exit(1);
  }

  const browserURL = process.env.PUPPETEER_BROWSER_URL || 'http://127.0.0.1:9222';
  let browser = null;

  try {
    // Connect to remote Chrome (do not close the Chrome instance; we'll disconnect)
    browser = await puppeteer.connect({ browserURL });

    // Sites to process (loaded from src/sites.js)
    // Each site: { id, name, style, themeUrl, imageUrl, promptModel? }
    const sitesList = Array.isArray(sites) ? sites : [];

    // Parse --site argument (accepts numeric 1-based index or site id/name)
    const argv = process.argv.slice(2);
    let siteArgValue;
    for (const a of argv) {
      if (a.startsWith('--site=')) {
        siteArgValue = a.split('=')[1];
        break;
      }
    }
    if (!siteArgValue) {
      const idx = argv.indexOf('--site');
      if (idx !== -1 && idx + 1 < argv.length) siteArgValue = argv[idx + 1];
    }

    let sitesToProcess = sitesList;
    if (siteArgValue) {
      const n = Number(siteArgValue);
      if (!Number.isNaN(n) && Number.isInteger(n)) {
        const i = n - 1;
        if (i < 0 || i >= sitesList.length) {
          console.error(`Invalid --site index: ${siteArgValue}. Valid range: 1-${sitesList.length}`);
          process.exit(1);
        }
        sitesToProcess = [sitesList[i]];
      } else {
        const match = sitesList.find(s => s.id === siteArgValue || s.name === siteArgValue);
        if (!match) {
          console.error(`No site found for --site ${siteArgValue}`);
          process.exit(1);
        }
        sitesToProcess = [match];
      }
    }

    // Create OpenAI client once
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const results = [];

    for (const site of sitesToProcess) {
      const pageUrl = site.themeUrl;
      const imagePageUrl = site.imageUrl;
      console.log(`Processing site ${site.id || site.name}: themeUrl=${pageUrl}, imageUrl=${imagePageUrl}, style=${site.style}`);

      // Fetch theme/description for this site (pass browser so it won't disconnect)
      const { theme, description, debug } = await fetchTheme(pageUrl, { browser });
      console.log(`Fetched theme/description for ${pageUrl}:`, { theme, description });

      if (!theme) {
        console.warn(`No theme found for ${pageUrl} (site=${site.id || site.name}), skipping.`);
        continue;
      }

      // Generate prompt/result using OpenAI, pass style and optional model override
      const generated = await generatePrompt({
        theme,
        description,
        client,
        model: site.promptModel || undefined,
        style: site.style
      });
      console.log('Generated prompt/result for', site.id || site.name, ':', generated);

      // Generate image using the dedicated module (we pass the browser so it won't disconnect)
      let imageResult = null;
      if (imagePageUrl) {
        imageResult = await generateImage({ browser, pageUrl: imagePageUrl, prompt: generated.prompt_en });
      } else {
        console.log('No imageUrl configured for', site.id || site.name, '— skipping image generation.');
      }

      if (imageResult && (imageResult.imageUrl || (imageResult.imageUrls && imageResult.imageUrls.length) || imageResult.dataId)) {
        // Publish the image using the dedicated module (use theme/post URL for publishing)
        // URLベースで特定する (data-vl-id はダイアログ側に付番されなくなったため)
        const identifier = imageResult.imageUrl || imageResult.dataId;
        const publishResult = await publishImage(pageUrl, identifier, generated.title_jp, generated.description_jp, {
          client,
          browser,
          imageUrl: imageResult.imageUrl,
          imageUrls: imageResult.imageUrls,
          imageId: imageResult.dataId,
        });
        imageResult.publishResult = publishResult;
      }

      results.push({
        siteId: site.id,
        siteName: site.name,
        pageUrl,
        result: { theme, description },
        generated,
        imageResult,
      });
    }

    // Output combined results
    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    process.exitCode = 1;
  } finally {
    // Ensure we disconnect from the remote browser (do not close the actual Chrome process)
    if (browser && typeof browser.disconnect === 'function') {
      try {
        await browser.disconnect();
      } catch (e) {
        // swallow disconnect errors
      }
    }
    // If we set a non-zero exit code, exit explicitly (keeps behavior similar to previous script)
    if (process.exitCode && process.exitCode !== 0) {
      process.exit(process.exitCode);
    }
  }
})();
