// services/semanticAnalyzer.js
// Semantic Analysis Service - LLaVA integration for mapping PDF blocks to CV fields
// AI determines WHAT each block means, not how to render it

require('dotenv').config();
const { z } = require('zod');

// Lazy imports
let GoogleGenerativeAI = null;

const OAI_BASE_URL = process.env.OPENAI_BASE_URL || process.env.OAI_BASE_URL || 'http://127.0.0.1:1234/v1';
const OAI_API_KEY = process.env.OPENAI_API_KEY || process.env.OAI_API_KEY || '';
const OAI_MODEL_VISION = process.env.OPENAI_VISION_MODEL || process.env.OAI_MODEL || 'llava-v1.6-7b';

let geminiModel = null;

/**
 * CV field types that AI can identify
 */
const CV_FIELD_TYPES = [
    'fullName',
    'firstName',
    'lastName',
    'jobTitle',
    'email',
    'phone',
    'address',
    'city',
    'postalCode',
    'country',
    'website',
    'linkedin',
    'github',
    'birthdate',
    'summary',
    'profilePhoto',
    'experienceHeader',
    'experienceTitle',
    'experienceCompany',
    'experienceDate',
    'experienceDescription',
    'educationHeader',
    'educationDegree',
    'educationInstitution',
    'educationDate',
    'educationDescription',
    'skillsHeader',
    'skill',
    'languageHeader',
    'language',
    'certificateHeader',
    'certificate',
    'projectHeader',
    'projectTitle',
    'projectDescription',
    'referenceHeader',
    'referenceName',
    'referenceContact',
    'sectionHeader',
    'bodyText',
    'unknown'
];

// Zod schema for AI response validation
const SemanticMappingSchema = z.object({
    mappings: z.array(z.object({
        blockId: z.string(),
        fieldType: z.enum(CV_FIELD_TYPES),
        confidence: z.number().min(0).max(1).optional(),
        groupId: z.string().optional() // For grouping related items (e.g., experience entries)
    })),
    sections: z.array(z.object({
        type: z.string(),
        startBlockId: z.string(),
        endBlockId: z.string().optional()
    })).optional()
});

async function ensureGemini() {
    if (geminiModel) return true;
    try {
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) return false;

        if (!GoogleGenerativeAI) {
            const mod = await import('@google/generative-ai');
            GoogleGenerativeAI = mod.GoogleGenerativeAI;
        }
        const genAI = new GoogleGenerativeAI(geminiKey);
        geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        return true;
    } catch (err) {
        console.warn('⚠️ Gemini initialization failed:', err.message);
        return false;
    }
}

/**
 * Extract JSON from AI response
 */
function extractJSON(text) {
    if (!text) return null;
    const fenceMatch = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/i);
    const raw = fenceMatch ? fenceMatch[1] : text;
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(raw.slice(start, end + 1)); } catch (_) { }
    }
    try { return JSON.parse(raw); } catch (_) { return null; }
}

/**
 * Build prompt for semantic analysis
 */
function buildSemanticPrompt(blocks) {
    const blockList = blocks.map(b => ({
        id: b.id,
        text: b.text,
        bbox: b.bbox,
        fontSize: b.font?.size || 12,
        hint: b.semanticHint || null
    }));

    return `You are a resume/CV semantic analyzer. Given a list of text blocks extracted from a PDF resume, identify what each block represents.

Available field types:
- fullName, firstName, lastName - person's name
- jobTitle - professional title/position
- email, phone - contact information
- address, city, postalCode, country - location
- website, linkedin, github - online profiles
- birthdate - date of birth
- summary - professional summary/about section
- experienceHeader, experienceTitle, experienceCompany, experienceDate, experienceDescription - work experience
- educationHeader, educationDegree, educationInstitution, educationDate, educationDescription - education
- skillsHeader, skill - skills section
- languageHeader, language - languages
- certificateHeader, certificate - certifications
- projectHeader, projectTitle, projectDescription - projects
- referenceHeader, referenceName, referenceContact - references
- sectionHeader - generic section header
- bodyText - generic body text
- unknown - cannot identify

TEXT BLOCKS TO ANALYZE:
${JSON.stringify(blockList, null, 2)}

Return ONLY valid JSON in this format:
{
  "mappings": [
    { "blockId": "block_1_0", "fieldType": "fullName", "confidence": 0.95 },
    { "blockId": "block_1_1", "fieldType": "email", "confidence": 0.99 }
  ],
  "sections": [
    { "type": "experience", "startBlockId": "block_1_5" },
    { "type": "education", "startBlockId": "block_1_15" }
  ]
}`;
}

/**
 * Build prompt for multimodal (image + blocks) analysis
 */
function buildMultimodalPrompt(blocks) {
    const blockList = blocks.map(b => ({
        id: b.id,
        text: b.text.substring(0, 100), // Truncate long texts
        x: Math.round(b.bbox.x),
        y: Math.round(b.bbox.y),
        fontSize: Math.round(b.font?.size || 12)
    }));

    return `Analyze this resume image along with the extracted text blocks. Map each block to a CV field type.

TEXT BLOCKS (with positions):
${JSON.stringify(blockList, null, 2)}

Field types: fullName, firstName, lastName, jobTitle, email, phone, address, city, postalCode, website, linkedin, github, birthdate, summary, experienceHeader, experienceTitle, experienceCompany, experienceDate, experienceDescription, educationHeader, educationDegree, educationInstitution, educationDate, skillsHeader, skill, languageHeader, language, sectionHeader, bodyText, unknown

Return ONLY valid JSON:
{
  "mappings": [
    { "blockId": "block_1_0", "fieldType": "fullName", "confidence": 0.95 }
  ]
}`;
}

/**
 * Analyze semantic meaning using heuristics (fallback when AI unavailable)
 * @param {Object} structure - Parsed PDF structure from pdfStructureParser
 * @returns {Object} Semantic mapping
 */
function analyzeWithHeuristics(structure) {
    const mappings = [];

    for (const page of structure.pages) {
        // First, process by lines (more reliable for names, titles)
        let lineIndex = 0;
        for (const line of page.lines) {
            const text = line.text.trim();
            if (!text) continue;

            let fieldType = 'bodyText';

            // Use semantic hints if available
            if (line.semanticHint) {
                fieldType = line.semanticHint;
            } else {
                // Heuristic rules for first few lines
                if (lineIndex === 0 && line.fontSize > 16) {
                    // First large line is usually name
                    const words = text.split(/\s+/);
                    if (words.length >= 1 && words.length <= 4) {
                        fieldType = 'fullName';
                    }
                } else if (lineIndex === 1 && line.fontSize > 12) {
                    fieldType = 'jobTitle';
                }

                // Pattern matching
                if (/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(text)) {
                    fieldType = 'email';
                } else if (/^[\+]?[\d\s\(\)\-\.]{7,20}$/.test(text) && /\d{3,}/.test(text)) {
                    fieldType = 'phone';
                } else if (/linkedin\.com/i.test(text)) {
                    fieldType = 'linkedin';
                } else if (/github\.com/i.test(text)) {
                    fieldType = 'github';
                } else if (/^https?:\/\//i.test(text)) {
                    fieldType = 'website';
                }

                // Section headers
                if (line.fontSize > 13) {
                    const lower = text.toLowerCase();
                    if (/^(experience|work|employment|опыт|работа)/i.test(lower)) {
                        fieldType = 'experienceHeader';
                    } else if (/^(education|образование|university)/i.test(lower)) {
                        fieldType = 'educationHeader';
                    } else if (/^(skills|навыки|abilities|умения)/i.test(lower)) {
                        fieldType = 'skillsHeader';
                    } else if (/^(languages|языки)/i.test(lower)) {
                        fieldType = 'languageHeader';
                    } else if (/^(projects|проекты)/i.test(lower)) {
                        fieldType = 'projectHeader';
                    } else if (/^(about|summary|profile|о себе|профиль)/i.test(lower)) {
                        fieldType = 'summary';
                    }
                }
            }

            // Map line and its blocks
            mappings.push({
                blockId: line.id,
                fieldType: fieldType,
                confidence: line.semanticHint ? 0.8 : 0.5,
                lineText: text
            });

            lineIndex++;
        }

        // Also map individual blocks
        for (const block of page.blocks) {
            if (block.semanticHint) {
                mappings.push({
                    blockId: block.id,
                    fieldType: block.semanticHint,
                    confidence: 0.7
                });
            }
        }
    }

    return { mappings, sections: [] };
}

/**
 * Analyze semantic meaning using AI (Gemini or OpenAI-compatible/LLaVA)
 * @param {Object} structure - Parsed PDF structure
 * @param {string} imageBase64 - Optional base64 image for multimodal analysis
 * @returns {Promise<Object>} Semantic mapping
 */
async function analyzeWithAI(structure, imageBase64 = null) {
    // Flatten blocks from all pages
    const allBlocks = [];
    for (const page of structure.pages) {
        allBlocks.push(...page.blocks.slice(0, 50)); // Limit to prevent token overflow
    }

    // Try Gemini first (better multimodal support)
    const useGemini = await ensureGemini();

    if (useGemini && geminiModel) {
        try {
            let result;
            if (imageBase64) {
                // Multimodal analysis with image
                const match = imageBase64.match(/^data:(image\/\w+);base64,(.*)$/i);
                const mime = match ? match[1] : 'image/png';
                const data = match ? match[2] : imageBase64.replace(/^data:.*?;base64,/, '');

                const response = await geminiModel.generateContent([
                    { inlineData: { mimeType: mime, data } },
                    { text: buildMultimodalPrompt(allBlocks) }
                ]);
                result = response?.response?.text?.() || '';
            } else {
                // Text-only analysis
                const response = await geminiModel.generateContent(buildSemanticPrompt(allBlocks));
                result = response?.response?.text?.() || '';
            }

            const parsed = extractJSON(result);
            if (parsed) {
                const validated = SemanticMappingSchema.safeParse(parsed);
                if (validated.success) {
                    return validated.data;
                }
                // Partial parsing
                if (parsed.mappings && Array.isArray(parsed.mappings)) {
                    return { mappings: parsed.mappings, sections: parsed.sections || [] };
                }
            }
        } catch (err) {
            console.warn('Gemini semantic analysis failed:', err.message);
        }
    }

    // Fallback: OpenAI-compatible API (LLaVA, LM Studio, etc.)
    if (OAI_BASE_URL) {
        try {
            let base = OAI_BASE_URL.replace(/\/$/, '');
            if (!/\/v1$/i.test(base)) base = `${base}/v1`;
            const url = `${base}/chat/completions`;

            const headers = { 'Content-Type': 'application/json' };
            if (OAI_API_KEY) headers['Authorization'] = `Bearer ${OAI_API_KEY}`;

            let messages;
            if (imageBase64) {
                // Multimodal with image
                messages = [{
                    role: 'user',
                    content: [
                        { type: 'text', text: buildMultimodalPrompt(allBlocks) },
                        { type: 'image_url', image_url: { url: imageBase64 } }
                    ]
                }];
            } else {
                // Text-only
                messages = [
                    { role: 'system', content: 'You are a CV/resume semantic analyzer. Return only valid JSON.' },
                    { role: 'user', content: buildSemanticPrompt(allBlocks) }
                ];
            }

            const body = {
                model: OAI_MODEL_VISION,
                messages,
                temperature: 0.1,
                max_tokens: 4096
            };

            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });

            if (response.ok) {
                const json = await response.json();
                const content = json?.choices?.[0]?.message?.content || '';
                const parsed = extractJSON(content);
                if (parsed?.mappings) {
                    return { mappings: parsed.mappings, sections: parsed.sections || [] };
                }
            }
        } catch (err) {
            console.warn('OpenAI-compatible semantic analysis failed:', err.message);
        }
    }

    // Final fallback: heuristics
    console.log('Using heuristic semantic analysis (no AI available)');
    return analyzeWithHeuristics(structure);
}

/**
 * Merge semantic mappings with PDF structure
 * @param {Object} structure - Parsed PDF structure
 * @param {Object} semantics - Semantic mapping from AI
 * @returns {Object} Structure with semantic fields
 */
function mergeStructureWithSemantics(structure, semantics) {
    const mappingById = new Map();
    for (const m of semantics.mappings) {
        mappingById.set(m.blockId, m);
    }

    for (const page of structure.pages) {
        for (const block of page.blocks) {
            const mapping = mappingById.get(block.id);
            if (mapping) {
                block.fieldType = mapping.fieldType;
                block.confidence = mapping.confidence || 0.5;
                block.groupId = mapping.groupId;
            }
        }

        for (const line of page.lines) {
            const mapping = mappingById.get(line.id);
            if (mapping) {
                line.fieldType = mapping.fieldType;
                line.confidence = mapping.confidence || 0.5;
                line.groupId = mapping.groupId;
            }
        }
    }

    structure.sections = semantics.sections || [];
    return structure;
}

/**
 * Full semantic analysis pipeline
 * @param {Object} structure - Parsed PDF structure from pdfStructureParser
 * @param {string} imageBase64 - Optional base64 image for better analysis
 * @param {boolean} useAI - Whether to use AI (default: true, fallback to heuristics if unavailable)
 * @returns {Promise<Object>} Structure with semantic annotations
 */
async function analyzeSemantics(structure, imageBase64 = null, useAI = true) {
    let semantics;

    if (useAI) {
        semantics = await analyzeWithAI(structure, imageBase64);
    } else {
        semantics = analyzeWithHeuristics(structure);
    }

    return mergeStructureWithSemantics(structure, semantics);
}

module.exports = {
    analyzeSemantics,
    analyzeWithAI,
    analyzeWithHeuristics,
    mergeStructureWithSemantics,
    CV_FIELD_TYPES
};
