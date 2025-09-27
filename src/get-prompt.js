const OpenAI = require('openai');

/**
 * Generate title_jp, description_jp and prompt_en from theme/description using OpenAI Responses API.
 *
 * Options:
 *  - theme: string | null
 *  - description: string | null
 *  - client: an existing OpenAI client instance (optional). If not provided, will construct one from OPENAI_API_KEY.
 *  - model: model name (default: 'gpt-5')
 *  - maxOutputTokens: maximum tokens for the response (default: 16000)
 *
 * Returns:
 *  { title_jp, description_jp, prompt_en }
 *
 * Throws on request failures or missing API key (when client not provided).
 */
async function generatePrompt({ theme = null, description = null, client = null, model = 'gpt-5-mini', maxOutputTokens = 16000 } = {}) {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not set. Provide a client or set OPENAI_API_KEY in the environment.');
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  const schema = {
    type: "object",
    properties: {
      title_jp: { type: "string", description: "作品タイトル（日本語・50文字以内）ありきたりのものではなく、独自性や創造性を重視してください。" },
      description_jp: { type: "string", description: "作品解説（日本語・150文字以内）単なる作品の解説ではなく、何をイメージして作成したのか、内面的な描写や自分が特にこだわった部分を含めてください。" },
      prompt_en: { type: "string", description: "SeaArt 用 英語プロンプト（先頭に \"masterpiece, best quality,\" を含む）" }
    },
    required: ["title_jp","description_jp","prompt_en"],
    additionalProperties: false
  };

  const systemMessage = `
あなたはAI画像生成サービス「SeaArt.ai」を使いこなすプロのイラストレーターまたは写真家です。
出力は必ずJSONで、スキーマに従ってください（keys: title_jp, description_jp, prompt_en）。
title_jp は日本語で50文字以内、description_jp は日本語で150文字以内にまとめてください。
prompt_en は英語で出力し、必ず先頭に "masterpiece, best quality, photorealistic," を挿入し、カンマ区切りで背景、構図、ライティング、カメラ設定（写実的指定時）などを詳細に書いてください。
アスペクト比の指定がない場合は aspect ratio 2:3 を想定して prompt_en に含めてください。
必ず追加のプロパティを出力しないでください。
`;

  const userMessage = `テーマ: ${theme || ''}\n説明: ${description || ''}`;

  let res = null;
  try {
    res = await client.responses.create({
      model,
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
      max_output_tokens: maxOutputTokens
    });
  } catch (err) {
    // Wrap and rethrow to allow caller to decide how to handle
    throw new Error('OpenAI request failed: ' + (err && err.message ? err.message : String(err)));
  }

  // If incomplete, retry once with stricter system prompt
  if (res && res.status === 'incomplete') {
    try {
      const systemMessageNoThought = systemMessage + "\n重要: 絶対に思考過程（chain-of-thought）や説明を出力に含めないでください。出力は純粋なJSONオブジェクトのみで、いかなる説明も含めないでください。";
      const retryRes = await client.responses.create({
        model,
        input: [
          { role: "system", content: systemMessageNoThought },
          { role: "user", content: userMessage }
        ],
        text: {
          format: {
            type: "json_object"
          }
        },
        max_output_tokens: maxOutputTokens
      });
      res = retryRes;
    } catch (e) {
      // keep original res if retry fails; we'll attempt to parse whatever we have
      console.error("Retry request failed:", e && e.message ? e.message : e);
    }
  }

  // Debug logging to stderr to assist troubleshooting (non-fatal)
  try {
    console.error("OpenAI response status:", res && res.status ? res.status : null);
    if (res && typeof res.output_text === 'string') {
      console.error("OpenAI output_text (preview):", res.output_text.slice(0, 2000));
    }
    if (res && res.output_parsed) {
      console.error("OpenAI output_parsed:", JSON.stringify(res.output_parsed, null, 2));
    }
  } catch (e) {
    // ignore logging errors
  }

  // Parse response robustly
  let aiResponse = null;
  try {
    if (res && res.output_parsed) {
      aiResponse = res.output_parsed;
    } else {
      // try to obtain textual output
      let outputText = typeof res.output_text === 'string' ? res.output_text : null;
      if (!outputText && res && res.output && Array.isArray(res.output)) {
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
          const m = outputText.match(/(\{[\s\S]*\})/);
          if (m) {
            try {
              aiResponse = JSON.parse(m[1]);
            } catch (e2) {
              console.error("Failed to parse extracted JSON substring:", e2 && e2.message ? e2.message : e2);
            }
          } else {
            console.error("No JSON substring found in output_text.");
          }
        }
      }
    }
  } catch (e) {
    console.error("Failed to parse OpenAI response:", e && e.message ? e.message : e);
  }

  if (!aiResponse) {
    console.warn("Failed to parse structured response. Falling back to empty fields and raw text for prompt_en.");
    const fallbackText = (res && typeof res.output_text === 'string' && res.output_text.length > 0) ? res.output_text : "";
    aiResponse = { title_jp: "", description_jp: "", prompt_en: fallbackText };
  }

  return aiResponse;
}

module.exports = { generatePrompt };
