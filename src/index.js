#!/usr/bin/env node
const puppeteer = require('puppeteer-core');
const OpenAI = require('openai');
const { fetchTheme } = require('./get-theme');
const { generatePrompt } = require('./get-prompt');
const { generateImage } = require('./generate-image');
const { publishImage } = require('./publish-image');

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

    // Pages to process
    const urls = [
      'https://www.seaart.ai/ja/event-center/daily',
      'https://www.seaart.ai/ja/event-center/realistic/'
    ];

    // Create OpenAI client once
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const results = [];

    for (const pageUrl of urls) {
      // Fetch theme/description for this page (pass browser so it won't disconnect)
      const { theme, description, debug } = await fetchTheme(pageUrl, { browser });
      console.log(`Fetched theme/description for ${pageUrl}:`, { theme, description });
      
      if (!theme) {
        console.warn(`No theme found for ${pageUrl}, skipping.`);
        continue;
      }
      // Generate prompt/result using OpenAI
      const generated = await generatePrompt({ theme, description, client });
      console.log('Generated prompt/result:', generated);

      // Generate image using the dedicated module (we pass the browser so it won't disconnect)
      const imageResult = await generateImage({ browser, prompt: generated.prompt_en });

      if (imageResult && imageResult.dataId) {
        // Publish the image using the dedicated module
        const publishResult = await publishImage(pageUrl, imageResult.dataId, generated.title_jp, generated.description_jp, { client });
        imageResult.publishResult = publishResult;
      }

      results.push({
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
