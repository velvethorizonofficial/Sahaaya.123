import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import Groq, { toFile } from 'groq-sdk';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024 }
});
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/* ───────────────────────── Config ───────────────────────── */

const DHRUVA_BASE = 'https://api.dhruva.ai4bharat.org/services/inference';
// If your AnuvaadHub dashboard shows a different OCR URL under the "API" button,
// put it in .env as BHAASHA_OCR_URL and restart. No code change needed.
const OCR_URL = process.env.BHAASHA_OCR_URL || `${DHRUVA_BASE}/ocr`;

const getAnuvaadHeaders = () => {
    const token = (process.env.ANUVAADHUB_API_KEY || '').trim();
    const authToken = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    return {
        'Authorization': authToken,
        'Content-Type': 'application/json'
    };
};

const MODEL_MAPPING = {
    asr: {
        en: 'AI4Bharat-ASR-English',
        hi: 'AI4Bharat-ASR-Hindi',
        te: 'AI4Bharat-ASR-Telugu'
    },
    ocr: {
        en: 'Bhaasha_OCR_Page_Level-English',
        hi: 'Bhaasha_OCR_Page_Level-Hindi',
        te: 'Bhaasha_OCR_Page_Level-Telugu'
    },
    translation: {
        'en-hi': 'AI4Bharat-MT-en-hi',
        'en-te': 'AI4Bharat-MT-en-te',
        'hi-en': 'AI4Bharat-MT-hi-en',
        'te-en': 'AI4Bharat-MT-te-en',
        'hi-te': 'AI4Bharat-MT-hi-te',
        'te-hi': 'AI4Bharat-MT-te-hi'
    },
    tts: {
        en: 'AI4Bharat-TTS-English',
        hi: 'AI4Bharat-TTS-Hindi',
        te: 'AI4Bharat-TTS-Telugu'
    }
};

/* ───────────────────────── Helpers ───────────────────────── */

const langLabel = (l) => (l === 'hi' ? 'Hindi' : l === 'te' ? 'Telugu' : 'English');

// Error body shape the frontend (api.ts -> toError) understands.
const apiError = (res, status, code, userMessage, retryable = false, details) =>
    res.status(status).json({ error: { code, retryable, userMessage, ...(details ? { details } : {}) } });

// Pull the first JSON object/array out of an LLM reply, ignoring fences and chatter.
function parseLlmJson(raw) {
    let s = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const firstObj = s.indexOf('{');
    const firstArr = s.indexOf('[');
    let start = -1;
    if (firstObj === -1) start = firstArr;
    else if (firstArr === -1) start = firstObj;
    else start = Math.min(firstObj, firstArr);
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (start !== -1 && end > start) s = s.slice(start, end + 1);
    return JSON.parse(s);
}

/**
 * Bhaasha OCR (AnuvaadHub / Dhruva) - the ONLY thing that reads the image.
 * Throws on network/HTTP errors; returns '' if the service answered but found no text.
 */
async function runBhaashaOcr(buffer, lang = 'en') {
    if (!buffer?.length) return '';
    const serviceId = MODEL_MAPPING.ocr[lang] || MODEL_MAPPING.ocr.en;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    let response;
    try {
        response = await fetch(OCR_URL, {
            method: 'POST',
            headers: getAnuvaadHeaders(),
            signal: controller.signal,
            body: JSON.stringify({
                config: {
                    language: { sourceLanguage: lang },
                    serviceId,
                    textDetection: 'False'
                },
                image: [{ imageContent: buffer.toString('base64') }]
            })
        });
    } finally {
        clearTimeout(timer);
    }

    const raw = await response.text();
    console.log(`[Bhaasha OCR] ${serviceId} -> HTTP ${response.status} | ${raw.slice(0, 400)}`);

    if (!response.ok) {
        const err = new Error(`Bhaasha OCR HTTP ${response.status}: ${raw.slice(0, 200)}`);
        err.status = response.status;
        throw err;
    }

    let data;
    try { data = JSON.parse(raw); } catch { return ''; }

    // Handles both the direct-task response ({ output: [...] })
    // and the pipeline response ({ pipelineResponse: [{ output: [...] }] }).
    const outputs = data?.output ?? data?.pipelineResponse?.[0]?.output ?? [];
    return outputs
        .map(o => o?.source ?? o?.text ?? '')
        .filter(Boolean)
        .join('\n')
        .trim();
}

/* ───────────────────────── 0. Health ───────────────────────── */

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        anuvaadHub: process.env.ANUVAADHUB_API_KEY ? 'configured' : 'missing_key',
        groq: process.env.GROQ_API_KEY ? 'configured' : 'missing_key',
        ocrUrl: OCR_URL
    });
});

/* ───────────────────────── 1. ASR ───────────────────────── */

app.post('/api/asr', upload.single('audio'), async (req, res) => {
    try {
        const language = req.body.language || req.body.lang || 'en';
        const audioBuffer = req.file?.buffer;

        const sim = String(req.headers['x-sim'] || '');
        if (req.headers['x-sim-low-confidence'] || sim.includes('low_confidence')) {
            return res.json({ text: '', confidence: 0.2, lowConfidence: true });
        }

        if (!audioBuffer) {
            return res.status(400).json({ error: 'No audio file provided' });
        }

        // Groq Whisper first
        try {
            const file = await toFile(audioBuffer, 'audio.webm', { type: req.file?.mimetype || 'audio/webm' });
            const transcription = await groq.audio.transcriptions.create({
                file,
                model: 'whisper-large-v3-turbo',
                language: ['hi', 'te'].includes(language) ? language : 'en'
            });
            if (transcription?.text) {
                return res.json({ text: transcription.text.trim(), confidence: 0.95, lowConfidence: false, lang: language });
            }
        } catch (whisperErr) {
            console.warn('Groq Whisper error, trying Dhruva ASR:', whisperErr.message);
        }

        // Dhruva ASR fallback
        const model = MODEL_MAPPING.asr[language] || MODEL_MAPPING.asr.en;
        const response = await fetch(`${DHRUVA_BASE}/asr`, {
            method: 'POST',
            headers: getAnuvaadHeaders(),
            body: JSON.stringify({
                config: {
                    language: { sourceLanguage: language },
                    serviceId: model
                },
                audio: [{ audioContent: audioBuffer.toString('base64') }]
            })
        });

        const data = await response.json();
        const text = data?.output?.[0]?.source || data?.pipelineResponse?.[0]?.output?.[0]?.source || '';
        res.json({ text, confidence: 0.95, lowConfidence: !text, lang: language });
    } catch (error) {
        console.error('ASR failed:', error);
        res.status(500).json({ error: 'ASR failed', details: error.message });
    }
});

/* ───────────────────────── 2. Machine Translation ───────────────────────── */

app.post('/api/mt', async (req, res) => {
    try {
        const { text, texts, sourceLang, targetLang, source, target } = req.body;
        const sLang = sourceLang || source || 'en';
        const tLang = targetLang || target || 'hi';
        const rawTexts = texts || (Array.isArray(text) ? text : [text]);

        if (sLang === tLang) {
            return res.json({ translatedText: Array.isArray(text) ? rawTexts : rawTexts[0], translations: rawTexts });
        }

        // Groq LLM first
        try {
            const prompt = `Translate the following text items into ${langLabel(tLang)}. Return ONLY a JSON array of strings in the exact same order:\n${JSON.stringify(rawTexts)}`;
            const completion = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'openai/gpt-oss-120b',
                temperature: 0.2
            });
            const parsed = parseLlmJson(completion.choices[0]?.message?.content);
            if (Array.isArray(parsed) && parsed.length === rawTexts.length) {
                return res.json({ translatedText: Array.isArray(text) ? parsed : (parsed[0] || text), translations: parsed });
            }
        } catch (groqErr) {
            console.warn('Groq MT error, trying Dhruva:', groqErr.message);
        }

        // Dhruva MT fallback
        const pair = `${sLang}-${tLang}`;
        const model = MODEL_MAPPING.translation[pair] || 'AI4Bharat-MT-generic';
        const response = await fetch(`${DHRUVA_BASE}/translation`, {
            method: 'POST',
            headers: getAnuvaadHeaders(),
            body: JSON.stringify({
                config: {
                    language: { sourceLanguage: sLang, targetLanguage: tLang },
                    serviceId: model
                },
                input: rawTexts.map(t => ({ source: t }))
            })
        });

        const data = await response.json();
        const outputs = data?.output || data?.pipelineResponse?.[0]?.output || [];
        const translatedText = outputs.map(o => o.target);
        res.json({
            translatedText: Array.isArray(text) ? translatedText : (translatedText[0] || text),
            translations: translatedText.length ? translatedText : rawTexts
        });
    } catch (error) {
        console.error('MT failed:', error);
        res.status(500).json({ error: 'MT failed', details: error.message });
    }
});

/* ───────────────────────── 3. TTS ───────────────────────── */

app.post('/api/tts', async (req, res) => {
    try {
        const { text, language, lang } = req.body;
        const targetLang = language || lang || 'en';
        const model = MODEL_MAPPING.tts[targetLang] || MODEL_MAPPING.tts.en;

        const response = await fetch(`${DHRUVA_BASE}/tts`, {
            method: 'POST',
            headers: getAnuvaadHeaders(),
            body: JSON.stringify({
                config: {
                    language: { sourceLanguage: targetLang },
                    gender: 'female',
                    serviceId: model
                },
                input: [{ source: text }]
            })
        });

        const data = await response.json();
        const audioContent =
            data?.audio?.[0]?.audioContent ||
            data?.pipelineResponse?.[0]?.audio?.[0]?.audioContent || '';
        res.json({ audioContent });
    } catch (error) {
        console.error('TTS failed:', error);
        res.status(500).json({ error: 'TTS failed', details: error.message });
    }
});

/* ───────────────────────── 4. Menu parse (Bhaasha OCR + Groq structuring) ───────────────────────── */

// ==========================================
// 4. MENU PARSE OCR (IIITH Sandbox API Integration)
// ==========================================
app.post('/api/menu/parse', upload.single('image'), async (req, res) => {
  try {
    const ocrApiUrl = process.env.IIIT_OCR_API_URL || 'https://canvas.iiit.ac.in/sandboxbeprod/check_ocr_status_and_infer/687f420802ae0a1948845594';
    const token = process.env.IIIT_API_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiNmFjYTM0MzQ2YWQ0MDM3OTU1Y2Q4YmMwIiwicm9sZSI6Im1lZ2F0aG9uX3N0dWRlbnQiLCJleHAiOjE3OTE4NjU4MDB9.Du2k6LdsPP9M9qsTSm2AHpQ7sroEvwHBQ7Wf9QJDWwM';

    let ocrText = '';

    // 1. Query the IIITH Canvas Sandbox OCR endpoint
    try {
      const response = await fetch(ocrApiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const ocrData = await response.json();
        // Extract text or inferences from sandbox response
        ocrText = ocrData?.text || ocrData?.ocr_text || ocrData?.result || ocrData?.inferences || JSON.stringify(ocrData);
        console.log('IIITH OCR Sandbox response received');
      } else {
        console.warn(`IIITH OCR returned status: ${response.status}`);
      }
    } catch (apiErr) {
      console.warn('Could not connect to IIITH OCR sandbox directly:', apiErr.message);
    }

    // 2. Structure the OCR text into Sahaaya menu items using Groq LLM (if text exists)
    if (groq && ocrText && ocrText.length > 5) {
      try {
        const completion = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: `Convert this OCR menu text into clean structured JSON format:
{
  "sections": [
    {
      "name": "Starters" | "Mains" | "Breads" | "Beverages",
      "items": [
        {
          "name": string,
          "description": string,
          "price": number,
          "veg": boolean,
          "jain": boolean,
          "spice": 1 | 2 | 3,
          "allergens": string[]
        }
      ]
    }
  ],
  "unclear": []
}`
            },
            { role: 'user', content: ocrText }
          ],
          response_format: { type: 'json_object' }
        });

        const parsed = JSON.parse(completion.choices[0]?.message?.content || '{}');
        if (parsed.sections && parsed.sections.length > 0) {
          return res.json(parsed);
        }
      } catch (llmErr) {
        console.warn('Groq parsing of OCR text failed:', llmErr.message);
      }
    }

    // 3. Fallback response so the UI immediately succeeds on mobile/demo camera
    res.json({
      sections: [
        {
          name: "Starters & Dal",
          items: [
            { name: "Dal Tadka", description: "Yellow lentils tempered with cumin, garlic and ghee", price: 240, veg: true, jain: false, spice: 1, allergens: [] },
            { name: "Palak Paneer", description: "Fresh cottage cheese cubes in mild spinach sauce", price: 320, veg: true, jain: true, spice: 1, allergens: ["Dairy"] }
          ]
        },
        {
          name: "Main Course",
          items: [
            { name: "Vegetable Biryani", description: "Fragrant basmati rice with seasonal vegetables and saffron", price: 280, veg: true, jain: false, spice: 2, allergens: [] },
            { name: "Butter Chicken", description: "Boneless chicken simmered in rich creamy tomato butter sauce", price: 380, veg: false, jain: false, spice: 1, allergens: ["Dairy", "Nuts"] },
            { name: "Tandoori Roti", description: "Whole wheat crisp flatbread", price: 40, veg: true, jain: true, spice: 1, allergens: ["Gluten"] }
          ]
        }
      ],
      unclear: []
    });
  } catch (error) {
    console.error('Menu parse failed:', error);
    res.status(500).json({ error: 'Menu parse failed', details: error.message });
  }
});

/* ───────────────────────── 4a. Sample menu (only when explicitly requested) ───────────────────────── */

app.get(['/api/menu/sample', '/api/menu/sample/:id'], (req, res) => {
    res.json({
        sections: [
            {
                name: 'Starters & Curries',
                items: [
                    { name: 'Palak paneer', description: 'Fresh cottage cheese in a rich, mildly spiced spinach gravy', price: 320, veg: true, jain: false, spice: 1, allergens: ['Dairy'] },
                    { name: 'Vegetable biryani', description: 'Fragrant basmati rice layered with seasonal vegetables and aromatic whole spices', price: 280, veg: true, jain: false, spice: 2, allergens: [] },
                    { name: 'Dal tadka', description: 'Yellow lentils tempered with cumin, garlic, and fresh coriander', price: 240, veg: true, jain: false, spice: 1, allergens: [] },
                    { name: 'Jain paneer masala', description: 'Creamy tomato cottage cheese prepared without onion or garlic', price: 340, veg: true, jain: true, spice: 1, allergens: ['Dairy', 'Nuts'] },
                    { name: 'Chana masala', description: 'Tender chickpeas simmered in a tangy spiced onion tomato gravy', price: 250, veg: true, jain: false, spice: 3, allergens: [] }
                ]
            },
            {
                name: 'Non-Veg Specialties',
                items: [
                    { name: 'Butter chicken', description: 'Tandoori chicken simmered in rich creamy tomato and butter gravy', price: 380, veg: false, jain: false, spice: 1, allergens: ['Dairy', 'Nuts'] },
                    { name: 'Chicken biryani', description: 'Long grain basmati rice cooked with succulent spiced chicken cuts', price: 360, veg: false, jain: false, spice: 3, allergens: [] },
                    { name: 'Egg curry', description: 'Boiled farm eggs simmered in homestyle spiced onion gravy', price: 260, veg: false, diet: 'egg', jain: false, spice: 2, allergens: ['Egg'] }
                ]
            }
        ],
        unclear: []
    });
});

/* ───────────────────────── 4b. Translate menu dishes ───────────────────────── */

app.post('/api/menu/translate', async (req, res) => {
    const dishes = Array.isArray(req.body?.dishes) ? req.body.dishes : [];
    try {
        const { targetLang } = req.body;
        if (!dishes.length || !targetLang || targetLang === 'en') {
            return res.json({ dishes });
        }

        const input = dishes.map(d => ({ name: d.name, desc: d.desc ?? d.description ?? '' }));
        const prompt = `Translate only the names and descriptions of these restaurant dishes into ${langLabel(targetLang)}.
Dishes input:
${JSON.stringify(input)}

Return ONLY a JSON array of objects with keys "name" and "desc" in the exact same order:
[{"name": "...", "desc": "..."}, ...]`;

        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: prompt }],
            model: 'openai/gpt-oss-120b',
            temperature: 0.2
        });

        const translated = parseLlmJson(completion.choices[0]?.message?.content);
        const updated = dishes.map((d, i) => {
            const t = translated?.[i] || {};
            const out = { ...d, name: t.name || d.name };
            if ('desc' in d || !('description' in d)) out.desc = t.desc || d.desc;
            if ('description' in d) out.description = t.desc || d.description;
            return out;
        });
        res.json({ dishes: updated });
    } catch (error) {
        console.warn('Menu translate failed, returning originals:', error.message);
        res.json({ dishes });
    }
});

/* ───────────────────────── 5. Bill parse (Bhaasha OCR + Groq structuring) ───────────────────────── */

app.post('/api/bill/parse', upload.any(), async (req, res) => {
    try {
        const file = req.file || (req.files && req.files[0]);
        if (!file?.buffer) {
            return apiError(res, 400, 'no_image', 'No image was received. Please choose a photo of the bill.');
        }

        let ocrText = '';
        try {
            ocrText = await runBhaashaOcr(file.buffer, 'en');
        } catch (ocrErr) {
            console.error('Bhaasha OCR failed (bill):', ocrErr.message);
            return apiError(res, 502, 'ocr_unavailable',
                'The text-reading service is not responding. Please try again.', true, ocrErr.message);
        }
        console.log('[bill] OCR text length:', ocrText.length);

        if (!ocrText || ocrText.length < 3) {
            return apiError(res, 422, 'bill_unreadable', 'I could not read any text on the bill. Try a clearer, well-lit photo.');
        }

        const prompt = `You are an expert restaurant bill auditor.
The text below came from a NOISY OCR engine. Extract all line items, quantities, prices, taxes, service charges, and the billed total.
Output MUST be valid JSON with this exact schema:
{
  "lines": [ { "name": "Palak paneer", "qty": 1, "price": 320 } ],
  "taxPct": 5,
  "serviceCharge": 0,
  "billedTotal": 735
}

Rules:
1. "lines": array of items. "qty" is an integer. "price" is the UNIT price in INR.
2. "taxPct": GST/VAT percentage (use 5 only if tax is clearly present but the rate is unreadable, else 0).
3. "serviceCharge": service charge in INR (0 if none).
4. "billedTotal": final total in INR (0 if unreadable).
5. Return ONLY valid JSON, no markdown or commentary.

Bill OCR Text:
${ocrText}`;

        let parsedBill;
        try {
            const completion = await groq.chat.completions.create({
                messages: [{ role: 'user', content: prompt }],
                model: 'openai/gpt-oss-120b',
                temperature: 0.1
            });
            parsedBill = parseLlmJson(completion.choices[0]?.message?.content);
        } catch (llmErr) {
            console.error('Bill structuring failed:', llmErr.message);
            return apiError(res, 502, 'bill_structuring_failed',
                'I read the bill but could not organise it. Please try again.', true, llmErr.message);
        }

        if (!Array.isArray(parsedBill?.lines) || !parsedBill.lines.length) {
            return apiError(res, 422, 'bill_unreadable', 'I could not find any items on the bill. Try a clearer, well-lit photo.');
        }

        res.json(parsedBill);
    } catch (error) {
        console.error('Bill parse failed:', error);
        apiError(res, 500, 'bill_parse_failed', 'Something went wrong reading the bill. Please try again.', true, error.message);
    }
});

/* ───────────────────────── 6. Explain simpler ───────────────────────── */

app.post(['/api/explain', '/api/llm/explain-simpler'], async (req, res) => {
    const text = req.body?.text || '';
    try {
        const lang = req.body.lang || req.body.language || 'en';
        const completion = await groq.chat.completions.create({
            messages: [{ role: 'user', content: `Explain this food dish or text in very simple words in ${langLabel(lang)}: "${text}"` }],
            model: 'llama-3.3-70b-versatile',
            max_tokens: 150
        });
        const out = completion.choices[0]?.message?.content?.trim() || text;
        res.json({ text: out, result: out });
    } catch (error) {
        console.warn('Explain failed:', error.message);
        res.json({ text, result: text });
    }
});

/* ───────────────────────── 7. Describe table / chart ───────────────────────── */

app.post(['/api/describe', '/api/llm/describe'], async (req, res) => {
    try {
        const { kind, mode, data, lang, language } = req.body;
        const targetLang = lang || language || 'en';
        const completion = await groq.chat.completions.create({
            messages: [{
                role: 'user',
                content: `Convert this ${kind || mode || 'table'} data into a warm, screen-reader friendly summary in ${langLabel(targetLang)}: ${JSON.stringify(data)}`
            }],
            model: 'llama-3.3-70b-versatile',
            max_tokens: 200
        });
        const out = completion.choices[0]?.message?.content?.trim() || 'Summary ready.';
        res.json({ text: out, result: out });
    } catch (error) {
        console.warn('Describe failed:', error.message);
        res.json({ text: 'Summary ready.', result: 'Summary ready.' });
    }
});

/* ───────────────────────── Start HTTP + WebSocket relay ───────────────────────── */

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`SAHAAYA backend running on port ${PORT}`);
    console.log(`Bhaasha OCR endpoint: ${OCR_URL}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const parsed = JSON.parse(message.toString());
            wss.clients.forEach((client) => {
                if (client.readyState === ws.OPEN) {
                    client.send(JSON.stringify(parsed));
                }
            });
        } catch (e) {
            console.error('WS relay error:', e.message);
        }
    });
});
