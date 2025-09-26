#!/usr/bin/env node
const puppeteer = require('puppeteer-core');
const OpenAI = require('openai');

(async () => {
  try {
    // Connect to the already-running Chrome with remote debugging on port 9222
    const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' });

    // Open a new page and navigate to the target URL
    const page = await browser.newPage();
    await page.goto('https://www.seaart.ai/ja/event-center/daily', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Give extra time for client-side rendering (fallback: page.waitForTimeout may not be available on connected puppeteer)
    await new Promise(resolve => setTimeout(resolve, 800));

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

    // Output debug + extracted results
    // Use OpenAI to expand theme/description into title (JP), description (JP), and prompt (EN)
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY not set. Set it in the environment and retry.");
      await browser.disconnect();
      process.exit(1);
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const schema = {
      type: "object",
      properties: {
        title_jp: { type: "string", description: "作品タイトル（日本語・50文字以内）" },
        description_jp: { type: "string", description: "作品解説（日本語・150文字以内）" },
        prompt_en: { type: "string", description: "SeaArt 用 英語プロンプト（先頭に \"masterpiece, best quality,\" を含む）" }
      },
      required: ["title_jp","description_jp","prompt_en"],
      additionalProperties: false
    };

    const systemMessage = `
あなたはAI画像生成サービス「SeaArt.ai」を使いこなすプロのイラストレーターまたは写真家です。
出力は必ずJSONで、スキーマに従ってください（keys: title_jp, description_jp, prompt_en）。
title_jp は日本語で50文字以内、description_jp は日本語で150文字以内にまとめてください。
prompt_en は英語で出力し、必ず先頭に "masterpiece, best quality," を挿入し、カンマ区切りで背景、構図、ライティング、カメラ設定（写実的指定時）などを詳細に書いてください。
「写実的」という語が入力に含まれている場合はphotorealistic（写真風）にしてください。指定がない場合はillustration（イラスト風）にしてください。
アスペクト比の指定がない場合は aspect ratio 2:3 を想定して prompt_en に含めてください。
必ず追加のプロパティを出力しないでください。
`;

    const userMessage = `テーマ: ${theme || ''}\n説明: ${description || ''}`;

    let aiResponse = null;
    try {
      // Use JSON mode fallback (some model snapshots may not produce json_schema structured outputs reliably)
      let res = await client.responses.create({
        model: "gpt-5",
        input: [
          { role: "system", content: systemMessage },
          { role: "user", content: userMessage }
        ],
        reasoning: {
          effort: "low"
        },
        text: {
          format: {
            type: "json_object"
          }
        },
        max_output_tokens: 16000
      });

      // If the response is incomplete (reasoning / thought tokens only), retry once with a stricter instruction to return only JSON.
      if (res && res.status === 'incomplete') {
        try {
          console.error("OpenAI returned incomplete. incomplete_details:", res.incomplete_details || null);
          const systemMessageNoThought = systemMessage + "\n重要: 絶対に思考過程（chain-of-thought）や説明を出力に含めないでください。出力は純粋なJSONオブジェクトのみで、いかなる説明も含めないでください。";
          const retryRes = await client.responses.create({
            model: "gpt-5",
            input: [
              { role: "system", content: systemMessageNoThought },
              { role: "user", content: userMessage }
            ],
            text: {
              format: {
                type: "json_object"
              }
            },
            max_output_tokens: 16000
          });
          // replace res with retry result for downstream parsing
          res = retryRes;
        } catch (e) {
          console.error("Retry request failed:", e);
        }
      }

      // Debug: dump important parts of the raw response to help diagnose parsing issues
      try {
        console.error("OpenAI response status:", res.status || null);
        console.error("OpenAI output_text (first 2000 chars):", typeof res.output_text === 'string' ? res.output_text.slice(0,2000) : null);
        console.error("OpenAI output_parsed:", res.output_parsed ? JSON.stringify(res.output_parsed, null, 2) : null);
        if (res.output && Array.isArray(res.output)) {
          console.error("OpenAI output (summary):", res.output.slice(0,3).map(o => {
            return {
              id: o.id,
              type: o.type,
              content_preview: o.content ? o.content.map(c => {
                return { type: c.type, text_preview: (typeof c.text === 'string' ? c.text.slice(0,200) : null) };
              }) : undefined
            };
          }));
        }
      } catch (e) {
        console.error("Failed to log OpenAI response for debugging:", e);
      }

      // Parse response robustly: try output_parsed, then output_text, then extract first JSON object substring as fallback.
      let outputText = null;
      if (res && res.output_parsed) {
        aiResponse = res.output_parsed;
      } else {
        // try to obtain textual output
        outputText = typeof res.output_text === 'string' ? res.output_text : null;
        if (!outputText && res && res.output && Array.isArray(res.output)) {
          // look for any content item with text
          for (const o of res.output) {
            if (o.content && Array.isArray(o.content)) {
              for (const c of o.content) {
                if (c.type === 'output_text' && typeof c.text === 'string') {
                  outputText = c.text;
                  break;
                }
                if (c.type === 'message' && typeof c.text === 'string') {
                  outputText = c.text;
                  break;
                }
              }
            }
            if (outputText) break;
          }
        }

        if (outputText) {
          try {
            aiResponse = JSON.parse(outputText);
          } catch (e) {
            // attempt to extract the first JSON object in the text
            const m = outputText.match(/(\{[\s\S]*\})/);
            if (m) {
              try {
                aiResponse = JSON.parse(m[1]);
              } catch (e2) {
                console.error("Failed to parse extracted JSON substring:", e2);
              }
            } else {
              console.error("No JSON substring found in output_text.");
            }
          }
        }
      }

      if (!aiResponse) {
        console.warn("Failed to parse structured response. Falling back to empty fields and raw text for prompt_en.");
        const fallbackText = (typeof outputText === 'string' && outputText.length > 0) ? outputText : (res && res.output_text ? res.output_text : "");
        aiResponse = { title_jp: "", description_jp: "", prompt_en: fallbackText };
      }

    } catch (err) {
      console.error("OpenAI request failed:", err);
      await browser.disconnect();
      process.exit(1);
    }

    // Output combined debug + AI result
    console.log(JSON.stringify({
      /* debug: {
        themeSpan: themeSpanDebug,
        description: descriptionDebug,
        openai_raw: aiResponse
      }, */
      result: { theme, description },
      generated: aiResponse
    }, null, 2));

    // Disconnect (do not close remote Chrome)
    await browser.disconnect();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
