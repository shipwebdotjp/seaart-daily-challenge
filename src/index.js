#!/usr/bin/env node
const puppeteer = require('puppeteer-core');
const OpenAI = require('openai');
const { fetchTheme } = require('./get-theme');
const { generatePrompt } = require('./get-prompt');
const { generateImage } = require('./generate-image');

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

    // Fetch theme/description using the dedicated module (we pass the browser so it won't disconnect)
    const { theme, description, debug } = await fetchTheme({ browser });

    // Create OpenAI client and generate prompt/result
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const generated = await generatePrompt({ theme, description, client });
    //const generated = { title_jp: '美しい風景', description_jp: '山と日の出の写真', prompt_en: 'masterpiece, best quality, a beautiful landscape, mountains, sunrise, photorealistic, detailed, vibrant colors, 2:3' };

    // Generate image using the dedicated module (we pass the browser so it won't disconnect)
    const imageResult = await generateImage({ browser, prompt: generated.prompt_en });
    //console.log('Image generation result:', imageResult);
    // Output combined result
    console.log(JSON.stringify({
      result: { theme, description },
      generated
    }, null, 2));
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
