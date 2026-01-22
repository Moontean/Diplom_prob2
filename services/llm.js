// services/llm.js
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Groq = require('groq-sdk');
const { z } = require('zod');

const AI_PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const OAI_BASE_URL = process.env.OPENAI_BASE_URL || process.env.OAI_BASE_URL || 'http://127.0.0.1:1234/v1';
const OAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OAI_API_KEY || '';
const OAI_MODEL = process.env.OPENAI_MODEL || process.env.OAI_MODEL || 'llm openai/gpt-oss-20b';

// Инициализация клиентов под выбранного провайдера
let geminiModel = null;
let groqClient = null;

try {
  if (AI_PROVIDER === 'gemini') {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      console.warn('⚠️ GEMINI_API_KEY отсутствует в .env.');
    } else {
      const genAI = new GoogleGenerativeAI(geminiKey);
      geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    }
  } else if (AI_PROVIDER === 'groq') {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      console.warn('⚠️ GROQ_API_KEY отсутствует в .env.');
    } else {
      groqClient = new Groq({ apiKey: groqKey });
    }
  }
} catch (err) {
  console.warn('⚠️ Не удалось инициализировать AI провайдера:', err.message);
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
    try { return JSON.parse(candidate); } catch (_) {}
  }
  // Попытка распарсить как JSON напрямую
  try { return JSON.parse(raw); } catch (_) { return null; }
}

async function callLLM(prompt) {
  // Авто-фолбэк: если выбран gemini, но не инициализирован и задан OpenAI-совместимый хост — используем openai
  let provider = AI_PROVIDER;
  if (provider === 'gemini' && !geminiModel && OAI_BASE_URL) {
    provider = 'openai';
  }

  if (provider === 'gemini') {
    if (!geminiModel) throw new Error('Gemini model is not initialized');
    const response = await geminiModel.generateContent(prompt);
    const text = response?.response?.text?.() || response?.text?.();
    return text || '';
  }
  if (provider === 'groq') {
    if (!groqClient) throw new Error('Groq client is not initialized');
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
    const base = OAI_BASE_URL.replace(/\/$/, '');
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
  evaluateOpenAnswer
};
