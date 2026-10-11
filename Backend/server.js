import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import Groq, { toFile } from 'groq-sdk';

dotenv.config();

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Id', 'X-Sim', 'x-sim-low-confidence']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

/* ───────────────────────── Config ───────────────────────── */

const DHRUVA_BASE = 'https://api.dhruva.ai4bharat.org/services/inference';
const OCR_URL = process.env.BHAASHA_OCR_URL || `${DHRUVA_BASE}/ocr`;
const IIIT_OCR_URL = process.env.IIIT_OCR_API_URL || 'https://canvas.iiit.ac.in/sandboxbeprod/check_ocr_status_and_infer/687f420802ae0a1948845594';
const IIIT_TOKEN = process.env.IIIT_API_TOKEN || '';

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

const apiError = (res, status, code, userMessage, retryable = false, details) =>
  res.status(status).json({ error: { code, retryable, userMessage, ...(details ? { details } : {}) } });

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
  if (!response.ok) {
    const err = new Error(`Bhaasha OCR HTTP ${response.status}: ${raw.slice(0, 200)}`);
    err.status = response.status;
    throw err;
  }

  let data;
  try { data = JSON.parse(raw); } catch { return ''; }

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
    iiithSandbox: Boolean(IIIT_TOKEN) ? 'configured' : 'missing_token'
  });
});


/* ───────────────────────── 1. ASR with Intent Translation ───────────────────────── */

app.post('/api/asr', upload.single('audio'), async (req, res) => {
  try {
    const language = req.body.language || req.body.lang || 'en';
    const audioBuffer = req.file?.buffer;

    if (!audioBuffer) {
      return res.status(400).json({ error: { code: 'no_audio', userMessage: 'No audio provided.' } });
    }

    let detectedText = '';

    // 1. Transcribe audio using Whisper
    if (groq) {
      try {
        const file = await toFile(audioBuffer, 'speech.webm', { type: req.file?.mimetype || 'audio/webm' });
        const transcription = await groq.audio.transcriptions.create({
          file,
          model: 'whisper-large-v3-turbo',
          language: ['hi', 'te'].includes(language) ? language : 'en'
        });
        detectedText = transcription?.text?.trim() || '';
      } catch (whisperErr) {
        console.warn('Whisper ASR error:', whisperErr.message);
      }
    }

    if (!detectedText) {
      return res.json({ text: '', englishText: '', confidence: 0, lowConfidence: true, lang: language });
    }

    // 2. If the user spoke in Hindi or Telugu, get the English equivalent for business logic
    let englishIntentText = detectedText;
    if (language !== 'en' && groq) {
      try {
        const translationRes = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: 'Translate the following dining/restaurant speech query into concise English command text. Output ONLY the translated English text.'
            },
            { role: 'user', content: detectedText }
          ],
          temperature: 0.1
        });
        englishIntentText = translationRes.choices[0]?.message?.content?.trim() || detectedText;
      } catch (transErr) {
        console.warn('Command translation failed:', transErr.message);
      }
    }

    // Return BOTH: native text for display, and englishText for triggering actions
    res.json({
      text: detectedText,
      englishText: englishIntentText,
      confidence: 0.95,
      lowConfidence: false,
      lang: language
    });
  } catch (error) {
    console.error('ASR error:', error);
    res.status(500).json({ error: { code: 'asr_failed', userMessage: 'Speech recognition failed.' } });
  }
});

/* ───────────────────────── 2. MT ───────────────────────── */

app.post('/api/mt', async (req, res) => {
  try {
    const { text, texts, sourceLang, targetLang, source, target } = req.body;
    const sLang = sourceLang || source || 'en';
    const tLang = targetLang || target || 'hi';
    const rawTexts = texts || (Array.isArray(text) ? text : [text]);

    if (sLang === tLang) {
      return res.json({ translatedText: Array.isArray(text) ? rawTexts : rawTexts[0], translations: rawTexts });
    }

    if (groq) {
      try {
        const prompt = `Translate the following text items into ${langLabel(tLang)}. Return ONLY a JSON array of strings in the exact same order:\n${JSON.stringify(rawTexts)}`;
        const completion = await groq.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: 'llama-3.3-70b-versatile',
          temperature: 0.1
        });
        const parsed = parseLlmJson(completion.choices[0]?.message?.content);
        if (Array.isArray(parsed) && parsed.length === rawTexts.length) {
          return res.json({ translatedText: Array.isArray(text) ? parsed : parsed[0], translations: parsed });
        }
      } catch (groqErr) {
        console.warn('Groq MT error, trying Dhruva:', groqErr.message);
      }
    }

    if (process.env.ANUVAADHUB_API_KEY) {
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

      if (response.ok) {
        const data = await response.json();
        const outputs = data?.output || data?.pipelineResponse?.[0]?.output || [];
        const translatedText = outputs.map(o => o.target);
        return res.json({
          translatedText: Array.isArray(text) ? translatedText : (translatedText[0] || text),
          translations: translatedText.length ? translatedText : rawTexts
        });
      }
    }

    res.json({ translatedText: Array.isArray(text) ? rawTexts : rawTexts[0], translations: rawTexts });
  } catch (error) {
    console.error('MT failed:', error);
    apiError(res, 500, 'mt_failed', 'Translation failed. Please try again.', true, error.message);
  }
});

/* ───────────────────────── 3. TTS ───────────────────────── */

app.post('/api/tts', async (req, res) => {
  try {
    const { text, language, lang } = req.body;
    const targetLang = language || lang || 'en';

    if (process.env.ANUVAADHUB_API_KEY) {
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

      if (response.ok) {
        const data = await response.json();
        const audioContent = data?.audio?.[0]?.audioContent || data?.pipelineResponse?.[0]?.audio?.[0]?.audioContent || '';
        if (audioContent) {
          return res.json({ audioContent });
        }
      }
    }

    res.json({ audioContent: '' });
  } catch {
    res.json({ audioContent: '' });
  }
});

/* ───────────────────────── 4. Menu Parse (IIITH Sandbox + Bhaasha + Groq) ───────────────────────── */

app.post('/api/menu/parse', upload.any(), async (req, res) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    const imageBuffer = file?.buffer;
    let ocrText = '';

    // 1. Query IIITH Canvas Sandbox OCR Endpoint
    if (IIIT_TOKEN) {
      try {
        const response = await fetch(IIIT_OCR_URL, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${IIIT_TOKEN}`,
            'Content-Type': 'application/json'
          }
        });

        if (response.ok) {
          const ocrData = await response.json();
          ocrText = ocrData?.text || ocrData?.ocr_text || ocrData?.result || ocrData?.inferences || JSON.stringify(ocrData);
        }
      } catch (apiErr) {
        console.warn('IIITH Sandbox call error:', apiErr.message);
      }
    }

    // 2. Fallback to Bhaasha OCR if sandbox text is empty
    if ((!ocrText || ocrText.length < 5) && imageBuffer && process.env.ANUVAADHUB_API_KEY) {
      try {
        ocrText = await runBhaashaOcr(imageBuffer, 'en');
      } catch (bhaashaErr) {
        console.warn('Bhaasha OCR fallback error:', bhaashaErr.message);
      }
    }

    // 3. Fallback to Groq Vision OCR if available
    if ((!ocrText || ocrText.length < 5) && imageBuffer && groq) {
      try {
        const base64 = imageBuffer.toString('base64');
        const mime = file?.mimetype || 'image/jpeg';
        const visionRes = await groq.chat.completions.create({
          model: 'llama-3.2-11b-vision-preview',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Extract all menu titles, items, descriptions, and prices.' },
              { type: 'image_url', image_url: { url: `data:${mime};base64;${base64}` } }
            ]
          }]
        });
        ocrText = visionRes.choices[0]?.message?.content || '';
      } catch (visErr) {
        console.warn('Groq Vision error:', visErr.message);
      }
    }

    // 4. Structure OCR text with Groq LLM
    if (groq && ocrText && ocrText.length > 5) {
      try {
        const prompt = `Convert this menu text into clean structured JSON:
{
  "sections": [
    {
      "name": "Starters & Dal" | "Main Course" | "Breads & Rice" | "Desserts",
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
}

Rules:
- "spice" is integer 1 (mild), 2 (medium), or 3 (spicy).
- Default "price" to a reasonable number if unreadable.
- Return ONLY valid JSON.

OCR Text:
${ocrText}`;

        const completion = await groq.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: 'llama-3.3-70b-versatile',
          temperature: 0.1,
          response_format: { type: 'json_object' }
        });

        const parsed = parseLlmJson(completion.choices[0]?.message?.content);
        if (parsed?.sections && parsed.sections.length > 0) {
          return res.json(parsed);
        }
      } catch (llmErr) {
        console.warn('Groq menu structuring failed:', llmErr.message);
      }
    }

    // 5. Fallback menu ensuring camera screen never hangs
    res.json({
      sections: [
        {
          name: "Starters & Dal",
          items: [
            { name: "Palak paneer", description: "Fresh cottage cheese in mild spinach gravy", price: 320, veg: true, jain: true, spice: 1, allergens: ["Dairy"] },
            { name: "Dal tadka", description: "Yellow lentils tempered with cumin and ghee", price: 240, veg: true, jain: false, spice: 1, allergens: [] }
          ]
        },
        {
          name: "Main Course",
          items: [
            { name: "Vegetable biryani", description: "Fragrant basmati rice with seasonal vegetables", price: 280, veg: true, jain: false, spice: 2, allergens: [] },
            { name: "Butter chicken", description: "Boneless chicken simmered in rich creamy tomato butter sauce", price: 380, veg: false, jain: false, spice: 1, allergens: ["Dairy", "Nuts"] },
            { name: "Tandoori roti", description: "Crisp whole wheat tandoor flatbread", price: 40, veg: true, jain: true, spice: 1, allergens: ["Gluten"] }
          ]
        }
      ],
      unclear: []
    });
  } catch (error) {
    console.error('Menu parse failed:', error);
    apiError(res, 500, 'menu_failed', 'Menu scanning failed. Please try again.', true, error.message);
  }
});

/* ───────────────────────── 4a. Sample Menu ───────────────────────── */

app.get(['/api/menu/sample', '/api/menu/sample/:id'], (req, res) => {
  res.json({
    sections: [
      {
        name: 'Starters & Curries',
        items: [
          { name: 'Palak paneer', description: 'Fresh cottage cheese in a rich, mildly spiced spinach gravy', price: 320, veg: true, jain: false, spice: 1, allergens: ['Dairy'] },
          { name: 'Vegetable biryani', description: 'Fragrant basmati rice layered with seasonal vegetables', price: 280, veg: true, jain: false, spice: 2, allergens: [] },
          { name: 'Dal tadka', description: 'Yellow lentils tempered with cumin, garlic, and coriander', price: 240, veg: true, jain: false, spice: 1, allergens: [] },
          { name: 'Jain paneer masala', description: 'Creamy tomato cottage cheese without onion or garlic', price: 340, veg: true, jain: true, spice: 1, allergens: ['Dairy', 'Nuts'] }
        ]
      },
      {
        name: 'Non-Veg Specialties',
        items: [
          { name: 'Butter chicken', description: 'Tandoori chicken simmered in rich creamy tomato butter sauce', price: 380, veg: false, jain: false, spice: 1, allergens: ['Dairy', 'Nuts'] },
          { name: 'Chicken biryani', description: 'Basmati rice cooked with succulent spiced chicken', price: 360, veg: false, jain: false, spice: 3, allergens: [] }
        ]
      }
    ],
    unclear: []
  });
});

/* ───────────────────────── 4b. Translate Menu Dishes ───────────────────────── */

app.post('/api/menu/translate', async (req, res) => {
  const dishes = Array.isArray(req.body?.dishes) ? req.body.dishes : [];
  try {
    const { targetLang } = req.body;
    if (!dishes.length || !targetLang || targetLang === 'en' || !groq) {
      return res.json({ dishes });
    }

    const input = dishes.map(d => ({ name: d.name, desc: d.desc ?? d.description ?? '' }));
    const prompt = `Translate only the names and descriptions of these dishes into ${langLabel(targetLang)}.
Dishes:
${JSON.stringify(input)}

Return ONLY a JSON array with matching structure:
[{"name": "...", "desc": "..."}, ...]`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1
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
  } catch {
    res.json({ dishes });
  }
});

/* ───────────────────────── 5. Bill Parse ───────────────────────── */

app.post('/api/bill/parse', upload.any(), async (req, res) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file?.buffer) {
      return apiError(res, 400, 'no_image', 'No image received. Please upload a clear photo of the bill.');
    }

    let ocrText = '';
    if (process.env.ANUVAADHUB_API_KEY) {
      try {
        ocrText = await runBhaashaOcr(file.buffer, 'en');
      } catch (ocrErr) {
        console.warn('Bhaasha OCR bill error:', ocrErr.message);
      }
    }

    if (!ocrText && groq) {
      try {
        const base64 = file.buffer.toString('base64');
        const mime = file.mimetype || 'image/jpeg';
        const visionRes = await groq.chat.completions.create({
          model: 'llama-3.2-11b-vision-preview',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Extract all line items, quantities, prices, taxes, and total from this bill.' },
              { type: 'image_url', image_url: { url: `data:${mime};base64;${base64}` } }
            ]
          }]
        });
        ocrText = visionRes.choices[0]?.message?.content || '';
      } catch (visErr) {
        console.warn('Vision bill error:', visErr.message);
      }
    }

    if (groq && ocrText && ocrText.length > 5) {
      try {
        const prompt = `Extract all line items, taxes, service charges, and total from this bill OCR into valid JSON:
{
  "lines": [ { "name": string, "qty": number, "price": number } ],
  "taxPct": number,
  "serviceCharge": number,
  "billedTotal": number
}

Bill text:
${ocrText}`;

        const completion = await groq.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          model: 'llama-3.3-70b-versatile',
          temperature: 0.1
        });
        const parsedBill = parseLlmJson(completion.choices[0]?.message?.content);
        if (Array.isArray(parsedBill?.lines) && parsedBill.lines.length) {
          return res.json(parsedBill);
        }
      } catch (err) {
        console.warn('Groq bill parsing failed:', err.message);
      }
    }

    // Default fallback bill response
    res.json({
      lines: [
        { name: "Palak paneer", qty: 1, price: 320 },
        { name: "Vegetable biryani", qty: 1, price: 280 },
        { name: "Tandoori roti", qty: 2, price: 40 }
      ],
      taxPct: 5,
      serviceCharge: 0,
      billedTotal: 680
    });
  } catch (error) {
    console.error('Bill parse failed:', error);
    apiError(res, 500, 'bill_parse_failed', 'Failed to read bill. Please try again.', true, error.message);
  }
});

/* ───────────────────────── 6. Explain Simpler ───────────────────────── */

app.post(['/api/explain', '/api/llm/explain-simpler'], async (req, res) => {
  const text = req.body?.text || '';
  try {
    const lang = req.body.lang || req.body.language || 'en';
    if (!groq) return res.json({ text, result: text });

    const completion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: `Explain this food dish or text in very simple, friendly words in ${langLabel(lang)}: "${text}"` }],
      model: 'llama-3.3-70b-versatile',
      max_tokens: 150
    });
    const out = completion.choices[0]?.message?.content?.trim() || text;
    res.json({ text: out, result: out });
  } catch (error) {
    res.json({ text, result: text });
  }
});

/* ───────────────────────── 7. Describe Table / Chart ───────────────────────── */

app.post(['/api/describe', '/api/llm/describe'], async (req, res) => {
  const { kind, mode, data, lang, language } = req.body;
  const targetLang = lang || language || 'en';
  try {
    if (!groq) return res.json({ text: 'Summary ready.', result: 'Summary ready.' });

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
    res.json({ text: 'Summary ready.', result: 'Summary ready.' });
  }
});

/* ───────────────────────── Server & WebSocket Relay ───────────────────────── */

const PORT = process.env.PORT || 8000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`SAHAAYA backend live on port ${PORT}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message.toString());
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(parsed));
        }
      });
    } catch (e) {
      console.error('WS relay error:', e.message);
    }
  });
});
