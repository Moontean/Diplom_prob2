// services/llm.js
require('dotenv').config();
const { z } = require('zod');

// Lazy imports to avoid ESM/CommonJS startup crashes
let GoogleGenerativeAI = null;
let Groq = null;

const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const OAI_BASE_URL = process.env.OPENAI_BASE_URL || process.env.OAI_BASE_URL || 'http://127.0.0.1:1234/v1';
const OAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OAI_API_KEY || '';
const OAI_MODEL = process.env.OPENAI_MODEL || process.env.OAI_MODEL || 'llm openai/gpt-oss-20b';

// Инициализация клиентов под выбранного провайдера (ленивая)
let geminiModel = null;
let groqClient = null;

async function ensureGemini() {
  if (geminiModel) return true;
  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      console.warn('⚠️ GEMINI_API_KEY отсутствует в .env.');
      return false;
    }
    if (!GoogleGenerativeAI) {
      // Dynamic ESM import to work under CommonJS
      const mod = await import('@google/generative-ai');
      GoogleGenerativeAI = mod.GoogleGenerativeAI;
    }
    const genAI = new GoogleGenerativeAI(geminiKey);
    geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    console.log('✅ Gemini model initialized: gemini-2.5-flash');
    return true;
  } catch (err) {
    console.warn('⚠️ Не удалось инициализировать Gemini:', err.message);
    return false;
  }
}

async function ensureGroq() {
  if (groqClient) return true;
  try {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      console.warn('⚠️ GROQ_API_KEY отсутствует в .env.');
      return false;
    }
    if (!Groq) {
      // Dynamic ESM/CommonJS import
      const mod = await import('groq-sdk');
      Groq = mod.default || mod.Groq || mod;
    }
    groqClient = new Groq({ apiKey: groqKey });
    return true;
  } catch (err) {
    console.warn('⚠️ Не удалось инициализировать Groq:', err.message);
    return false;
  }
}

// ===== Схемы валидации =====
const MCQQuestionSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal('mcq'),
  prompt: z.string().trim().min(10),
  options: z.array(z.string().trim().min(1)).min(2).max(6),
  correctIndex: z.number().int().min(0),
  explanation: z.string().trim().min(1).optional()
});

const OpenQuestionSchema = z.object({
  id: z.string().trim().min(1),
  type: z.literal('open'),
  prompt: z.string().trim().min(10),
  rubric: z.object({
    keyPoints: z.array(z.string().trim().min(2)).min(2),
    scoring: z.string().trim().min(5)
  })
});

const GeneratedAssessmentSchema = z.object({
  questions: z.array(z.union([MCQQuestionSchema, OpenQuestionSchema])).min(1)
});

const OpenEvaluationSchema = z.object({
  score: z.number().min(0).max(1),
  reasoning: z.string().min(5),
  missed_points: z.array(z.string()).optional()
});

function extractJSON(text) {
  if (!text) return null;
  // Удаляем кодовые блоки ```json ... ```
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  const raw = fenceMatch ? fenceMatch[1] : text;
  // Обрезаем до первой и последней фигурной скобки
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const candidate = raw.slice(start, end + 1);
    try { return JSON.parse(candidate); } catch (_) { }
  }
  // Попытка распарсить как JSON напрямую
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function extractHTML(text) {
  if (!text) return null;
  // Извлекаем из ```html ... ``` или любых тройных кавычек
  const fenceMatch = text.match(/```html\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
  const raw = fenceMatch ? fenceMatch[1] : text;
  // Проверяем наличие HTML-тегов
  const looksHtml = /<!DOCTYPE\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<div[\s>]|<section[\s>]|<style[\s>]/i.test(raw);
  if (looksHtml) return raw.trim();
  return null;
}

async function callLLM(prompt) {
  // Авто-фолбэк: если выбран gemini, но не инициализирован и задан OpenAI-совместимый хост — используем openai
  let provider = AI_PROVIDER;
  if (provider === 'gemini' && !geminiModel && OAI_BASE_URL) {
    provider = 'openai';
  }

  if (provider === 'gemini') {
    if (!geminiModel) {
      const ok = await ensureGemini();
      if (!ok) throw new Error('Gemini model is not initialized');
    }
    const response = await geminiModel.generateContent(prompt);
    const text = response?.response?.text?.() || response?.text?.();
    return text || '';
  }
  if (provider === 'groq') {
    if (!groqClient) {
      const ok = await ensureGroq();
      if (!ok) throw new Error('Groq client is not initialized');
    }
    const completion = await groqClient.chat.completions.create({
      model: 'llama-3.1-70b-versatile',
      messages: [
        { role: 'system', content: 'You are a precise assistant. Return only JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    });
    return completion?.choices?.[0]?.message?.content || '';
  }
  if (provider === 'openai' || provider === 'openai_local' || provider === 'openai-compatible') {
    if (typeof fetch !== 'function') {
      throw new Error('Fetch is not available in this Node version. Use Node 18+ or add a fetch polyfill.');
    }
    // Нормализуем базовый URL: гарантируем наличие /v1
    let base = OAI_BASE_URL.replace(/\/$/, '');
    if (!/\/v1$/i.test(base)) base = `${base}/v1`;
    const url = `${base}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (OAI_API_KEY) headers['Authorization'] = `Bearer ${OAI_API_KEY}`;
    const body = {
      model: OAI_MODEL,
      messages: [
        { role: 'system', content: 'You are a precise assistant. Return only JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3
    };
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI-compatible error: ${res.status} ${errText}`);
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text || '';
    return content || '';
  }
  throw new Error(`Unsupported AI provider: ${provider}`);
}

function sanitizeAndValidate(obj) {
  const result = GeneratedAssessmentSchema.safeParse(obj);
  if (!result.success) {
    const msg = result.error?.issues?.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid assessment JSON: ${msg}`);
  }
  return result.data;
}

// Генерация теста
async function generateAssessment({ profession, difficulty = 'junior', numQuestions = 10, mix = 'mixed' }) {
  const desiredMcq = Math.max(2, Math.round(numQuestions * 0.7));
  const desiredOpen = Math.max(1, numQuestions - desiredMcq);

  const prompt = `Ты экзаменатор. Составь профессиональный тест для кандидата по профессии "${profession}" на уровне "${difficulty}".
Требования:
- Всего вопросов: ${numQuestions}
- Типы: ~${desiredMcq} вопросов с выбором ответа (mcq), ~${desiredOpen} открытых (open)
- Покрыть: основы, ключевые инструменты, практические кейсы, edge-cases
- Уровень сложности: соответствовать уровню \"${difficulty}\"
- ДЛЯ MCQ: поле options (2-6 вариантов), поле correctIndex (0..N), краткое explanation
- ДЛЯ OPEN: поле rubric: keyPoints (минимум 2 пункта), scoring (краткие критерии)
- ВЕРНИ ТОЛЬКО JSON по схеме:
{ "questions": [
  { "id": "q1", "type": "mcq", "prompt": "...", "options": ["..."], "correctIndex": 0, "explanation": "..." },
  { "id": "q2", "type": "open", "prompt": "...", "rubric": { "keyPoints": ["..."], "scoring": "..." } }
] }`;

  // Первая попытка
  const rawText = await callLLM(prompt);
  let obj = extractJSON(rawText);

  // Ретрай, если не получилось
  if (!obj) {
    const retryText = await callLLM(prompt + '\nВерни строго JSON без пояснений, без кодовых блоков.');
    obj = extractJSON(retryText);
  }
  if (!obj) throw new Error('AI provider did not return valid JSON');

  const data = sanitizeAndValidate(obj);
  return data;
}

// Оценка открытых ответов
async function evaluateOpenAnswer({ question, answer }) {
  const prompt = `Ты оценщик ответов кандидата.
Вопрос: ${question.prompt}
Ключевые пункты: ${(question.rubric?.keyPoints || []).join('; ')}
Критерии: ${question.rubric?.scoring || ''}
Ответ кандидата: ${answer}

Требуется оценить от 0 до 1 с кратким объяснением.
Верни строго JSON: { "score": 0.xx, "reasoning": "...", "missed_points": ["..."] }`;

  const rawText = await callLLM(prompt);
  let obj = extractJSON(rawText);
  if (!obj) {
    const retryText = await callLLM(prompt + '\nВерни строго JSON без пояснений, без кодовых блоков.');
    obj = extractJSON(retryText);
  }
  if (!obj) throw new Error('AI provider did not return valid JSON for evaluation');

  const parsed = OpenEvaluationSchema.safeParse(obj);
  if (!parsed.success) {
    const msg = parsed.error?.issues?.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid evaluation JSON: ${msg}`);
  }
  return parsed.data;
}

module.exports = {
  generateAssessment,
  evaluateOpenAnswer,
  // Генерация HTML (Vue совместимый, но без сборки) по изображению первой страницы PDF
  // Поддерживается только провайдер Gemini (нужен GEMINI_API_KEY). Возвращает строку HTML.
  generateHtmlFromImage: async function ({ imageBase64, title = 'Resume', strict = false }) {
    // Сначала пробуем Gemini (мультимодальный ввод изображений).
    // Пробуем Gemini только если задан ключ, чтобы не спамить предупреждениями
    let useGemini = false;
    if (process.env.GEMINI_API_KEY) {
      try {
        useGemini = await ensureGemini();
      } catch (_) {
        useGemini = false;
      }
    }
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      throw new Error('imageBase64 is required');
    }
    // Удаляем префикс data URL, если есть
    const match = imageBase64.match(/^data:(image\/png|image\/jpeg);base64,(.*)$/i);
    const mime = match ? match[1] : 'image/png';
    const data = match ? match[2] : imageBase64;

    const promptText = `Ты — опытный фронтенд разработчик. Твоя задача — на основе изображения (скриншота PDF резюме) создать ОДИН цельный HTML-файл с ВСТРОЕННЫМИ CSS-стилями, МАКСИМАЛЬНО ТОЧНО повторяющий визуальный дизайн.

## КРИТИЧЕСКИ ВАЖНО — ЦВЕТА И ФОНЫ:
1. Внимательно определи ВСЕ цветные области на изображении (сайдбары, заголовки, блоки)
2. Используй ТОЧНЫЕ HEX-коды цветов (например #2F80ED, #1E3A5F, #333333)
3. Для каждой цветной области создай отдельный <div> с background-color
4. Цветные секции должны быть с position: absolute или в CSS Grid/Flexbox

## Структура HTML:
- Начинай с <!DOCTYPE html>
- Весь CSS внутри <style> (без внешних ресурсов)
- Используй абсолютное позиционирование для точного расположения элементов
- Размеры в px для точности

## Пример структуры для резюме с цветным сайдбаром:
\`\`\`html
<div class="resume-page" style="position: relative; width: 595px; height: 842px;">
  <div class="sidebar" style="position: absolute; left: 0; top: 0; width: 200px; height: 100%; background-color: #2F80ED;"></div>
  <div class="main-content" style="position: absolute; left: 200px; top: 0; right: 0; height: 100%; background: #fff;"></div>
</div>
\`\`\`

## Требования:
- Верни ТОЛЬКО чистый HTML (без пояснений, без Markdown-разметки)
- НЕ вставляй исходное изображение как <img>
- Текст должен быть реальным текстом (не картинкой)
- Заголовок: ${title}
- Страница A4 (595x842px) или пропорционально масштабируемая

Начинай ответ с <!DOCTYPE html>`;
    const buildImageFallbackHtml = () => {
      const dataUrl = `data:${mime};base64,${data}`;
      return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>html,body{margin:0;padding:0;background:#f8fafc} .page-wrap{display:flex;align-items:center;justify-content:center;padding:16px} .page{max-width:100%;height:auto;box-shadow:0 2px 8px rgba(0,0,0,.08);background:#fff}</style></head><body><div class="page-wrap"><img class="page" src="${dataUrl}" alt="${title}"></div></body></html>`;
    };

    console.log(`🤖 generateHtmlFromImage: Gemini available = ${useGemini}, has model = ${!!geminiModel}`);

    if (useGemini && geminiModel) {
      console.log('✨ Using Gemini API for HTML generation...');
      try {
        // Первая попытка (основной промпт)
        let res = await geminiModel.generateContent([
          { inlineData: { mimeType: mime, data } },
          { text: promptText }
        ]);
        let text = res?.response?.text?.() || res?.text?.() || '';
        console.log(`📝 Gemini response length: ${text.length} chars`);
        let html = extractHTML(text);
        // Ретрай с более строгими требованиями
        if (!html) {
          console.log('⚠️ First attempt failed, retrying with stricter prompt...');
          const retryPrompt = `${promptText}\nВерни строго чистый HTML, начинай с <!DOCTYPE html>, без Markdown и бэктиков.`;
          res = await geminiModel.generateContent([
            { inlineData: { mimeType: mime, data } },
            { text: retryPrompt }
          ]);
          text = res?.response?.text?.() || res?.text?.() || '';
          html = extractHTML(text);
        }
        if (html) {
          console.log('✅ Gemini successfully generated HTML with colors');
          return html;
        }
        console.log('❌ Gemini failed to generate valid HTML');
        if (strict) throw new Error('AI не вернул валидный HTML');
      } catch (geminiErr) {
        console.error('❌ Gemini error:', geminiErr.message);
        if (strict) throw geminiErr;
      }
      // иначе продолжаем попытку через OpenAI-совместимый хост
    }

    console.log('🔄 Falling back to OpenAI-compatible endpoint...');
    // Fallback: OpenAI-совместимый хост (например LM Studio) с поддержкой мультимодальных сообщений.
    // Нормализуем базовый URL: гарантируем наличие /v1
    let base = OAI_BASE_URL.replace(/\/$/, '');
    if (!/\/v1$/i.test(base)) base = `${base}/v1`;
    const url = `${base}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (OAI_API_KEY) headers['Authorization'] = `Bearer ${OAI_API_KEY}`;
    const timeoutMs = Number(process.env.OAI_REQUEST_TIMEOUT_MS || 60000);
    const fetchWithTimeout = async (payload) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('OAI request timeout')), timeoutMs);
      try {
        return await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    };
    const body = {
      model: OAI_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: promptText },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } }
          ]
        }
      ],
      temperature: 0.2,
      max_tokens: 4096
    };
    let res;
    try {
      res = await fetchWithTimeout(body);
    } catch (netErr) {
      if (strict) throw netErr;
      return buildImageFallbackHtml();
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OpenAI-compatible error: ${res.status} ${errText}`);
    }
    const json = await res.json();
    let text = json?.choices?.[0]?.message?.content || json?.choices?.[0]?.text || '';
    let html = extractHTML(text);
    if (!html) {
      // Вторая попытка с более строгим промптом
      const retryBody = {
        ...body,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `${promptText}\nВерни строго чистый HTML, начинай с <!DOCTYPE html>, без Markdown и бэктиков.` },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${data}` } }
            ]
          }
        ]
      };
      let res2;
      try {
        res2 = await fetchWithTimeout(retryBody);
      } catch (netErr2) {
        if (strict) throw netErr2;
        return buildImageFallbackHtml();
      }
      if (!res2.ok) {
        const errText2 = await res2.text().catch(() => '');
        throw new Error(`OpenAI-compatible error(retry): ${res2.status} ${errText2}`);
      }
      const json2 = await res2.json();
      text = json2?.choices?.[0]?.message?.content || json2?.choices?.[0]?.text || '';
      html = extractHTML(text);
    }
    if (!html) {
      if (strict) throw new Error('AI не вернул валидный HTML');
      // Надёжный фолбэк: формируем валидный HTML с встроенным изображением (пиксель-в-пиксель превью).
      return buildImageFallbackHtml();
    }
    return html;
  }
};
