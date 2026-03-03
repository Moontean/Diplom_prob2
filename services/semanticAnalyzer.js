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
        groupId: z.string().optional(),
        sectionId: z.string().optional() // Reference to section for coloring
    })),
    sections: z.array(z.object({
        id: z.string(),
        name: z.string(),
        bbox: z.object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number()
        }).optional(),
        backgroundColor: z.string(), // HEX color
        textColor: z.string().optional() // HEX color for text
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
        geminiModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        console.log('✅ Gemini model initialized: gemini-2.5-flash');
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

    return `Analyze this resume image along with the extracted text blocks. 

TASK 1 - VISUAL SECTIONS & COLORS:
Identify ALL distinct visual regions/sections with different background colors.
Look for: headers, sidebars, main content areas, skill bars, progress indicators, colored boxes, banners.
For EACH section provide the EXACT background color in HEX format and the text color used in that section.

TASK 2 - FIELD MAPPINGS:
Map each text block to its CV field type.

TEXT BLOCKS (with positions):
${JSON.stringify(blockList, null, 2)}

Field types: fullName, firstName, lastName, jobTitle, email, phone, address, city, postalCode, website, linkedin, github, birthdate, summary, experienceHeader, experienceTitle, experienceCompany, experienceDate, experienceDescription, educationHeader, educationDegree, educationInstitution, educationDate, skillsHeader, skill, languageHeader, language, sectionHeader, bodyText, unknown

Return ONLY valid JSON with this EXACT structure:
{
  "sections": [
    { 
      "id": "section_1", 
      "name": "header", 
      "bbox": {"x": 0, "y": 0, "width": 600, "height": 120},
      "backgroundColor": "#2563EB",
      "textColor": "#FFFFFF"
    },
    { 
      "id": "section_2", 
      "name": "sidebar", 
      "bbox": {"x": 0, "y": 120, "width": 200, "height": 680},
      "backgroundColor": "#1E293B",
      "textColor": "#E2E8F0"
    }
  ],
  "mappings": [
    { "blockId": "block_1_0", "fieldType": "fullName", "confidence": 0.95, "sectionId": "section_1" }
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

    // Detect sections from structure
    const sections = detectSectionsFromStructure(structure);

    return { mappings, sections };
}

/**
 * Detect MAJOR sections from text structure
 * Creates only key zones: header, contact bar, and main content sections
 * All sections span full page width
 * Uses EXACT bounding boxes from PDF blocks for precise sizing
 */
function detectSectionsFromStructure(structure) {
    const allSections = [];

    for (const page of structure.pages) {
        const pageWidth = page.width || 612;
        const pageHeight = page.height || 792;
        const pageNum = page.pageNumber || 1;

        // Collect all blocks with their Y positions
        const allBlocks = [...(page.blocks || [])].sort((a, b) =>
            (a.bbox?.y || 0) - (b.bbox?.y || 0)
        );

        if (allBlocks.length === 0) continue;

        // Find header block (name - usually largest font at top)
        let headerBlock = null;
        let headerTopY = Infinity;
        let headerBottomY = 0;

        // Find contact blocks (email, phone, address)
        const contactBlocks = [];
        let contactTopY = Infinity;
        let contactBottomY = 0;

        // First pass: identify header and contact blocks
        for (const block of allBlocks) {
            const y = block.bbox?.y || 0;
            const h = block.bbox?.height || 20;
            const fontSize = block.font?.size || 12;
            const text = (block.text || '').trim();
            const textLower = text.toLowerCase();

            // Header: large font in first 150px of page (name)
            if (y < 150 && fontSize > 16) {
                if (!headerBlock || fontSize > (headerBlock.font?.size || 0)) {
                    headerBlock = block;
                }
                headerTopY = Math.min(headerTopY, y);
                headerBottomY = Math.max(headerBottomY, y + h);
            }

            // Contact info: email, phone, or address patterns
            const isContact = (
                /@/.test(text) ||                                    // email
                /\d{3}[-.\s]?\d{3}[-.\s]?\d{4,5}/.test(text) ||     // phone
                /example\.com|exemple\.com/i.test(text) ||           // email domain
                /township|street|avenue|city|zip|\d{5}/i.test(textLower) // address
            );

            if (isContact && y < 250) {
                contactBlocks.push(block);
                contactTopY = Math.min(contactTopY, y);
                contactBottomY = Math.max(contactBottomY, y + h);
            }
        }

        // Create major zones with EXACT boundaries
        const pageSections = [];
        let sectionIndex = 1;

        // If header found, calculate header zone from page top to header bottom
        if (headerBlock && headerBottomY > 0) {
            // Header zone ends where contact starts OR at header bottom
            const headerZoneEnd = contactTopY < Infinity ? contactTopY : headerBottomY;

            pageSections.push({
                id: `page${pageNum}_section_${sectionIndex++}`,
                name: 'header',
                bbox: {
                    x: 0,
                    y: 0,
                    width: pageWidth,
                    height: headerZoneEnd  // From top of page to header zone end
                },
                backgroundColor: '#B8D4E8',
                textColor: '#1A1A1A',
                pageNumber: pageNum
            });
        }

        // Contact bar zone - exact height from contact blocks
        if (contactBlocks.length > 0 && contactTopY < Infinity) {
            const contactHeight = contactBottomY - contactTopY;

            pageSections.push({
                id: `page${pageNum}_section_${sectionIndex++}`,
                name: 'contact',
                bbox: {
                    x: 0,
                    y: contactTopY,
                    width: pageWidth,
                    height: Math.max(contactHeight, 30)  // Minimum height for visibility
                },
                backgroundColor: '#4A5568',
                textColor: '#FFFFFF',
                pageNumber: pageNum
            });
        }

        // Main content area - from end of contact bar to page bottom
        const contentStartY = contactBottomY > 0 ? contactBottomY : (headerBottomY > 0 ? headerBottomY : 0);

        if (contentStartY > 0 && contentStartY < pageHeight - 50) {
            pageSections.push({
                id: `page${pageNum}_section_${sectionIndex++}`,
                name: 'content',
                bbox: {
                    x: 0,
                    y: contentStartY,
                    width: pageWidth,
                    height: pageHeight - contentStartY
                },
                backgroundColor: '#FFFFFF',
                textColor: '#333333',
                pageNumber: pageNum
            });
        }

        allSections.push(...pageSections);
    }

    return allSections;
}

/**
 * Analyze semantic meaning using AI (Gemini or OpenAI-compatible/LLaVA)
 * @param {Object} structure - Parsed PDF structure
 * @param {string} imageBase64 - Optional base64 image for multimodal analysis
 * @returns {Promise<Object>} Semantic mapping
 */
async function analyzeWithAI(structure, imageBase64 = null) {
    // Flatten blocks from all pages - limit to prevent token overflow
    const allBlocks = [];
    for (const page of structure.pages) {
        // Take only first 20 blocks per page to stay within context limits
        allBlocks.push(...page.blocks.slice(0, 20));
        if (allBlocks.length >= 30) break; // Max 30 blocks total for AI
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

    // Create section lookup map
    const sectionsById = new Map();
    const sections = semantics.sections || [];
    for (const s of sections) {
        sectionsById.set(s.id, s);
    }

    for (const page of structure.pages) {
        // Store sections for this page only (filter by pageNumber)
        page.colorSections = sections.filter(s =>
            !s.pageNumber || s.pageNumber === page.pageNumber
        );

        for (const block of page.blocks) {
            const mapping = mappingById.get(block.id);
            if (mapping) {
                block.fieldType = mapping.fieldType;
                block.confidence = mapping.confidence || 0.5;
                block.groupId = mapping.groupId;

                // Apply section colors to block
                if (mapping.sectionId) {
                    const section = sectionsById.get(mapping.sectionId);
                    if (section) {
                        block.sectionId = section.id;
                        block.backgroundColor = section.backgroundColor;
                        block.textColor = section.textColor;
                    }
                }
            }

            // Fallback: find section by position if not mapped
            if (!block.backgroundColor && sections.length > 0) {
                const matchingSection = findSectionForPosition(block.bbox, sections);
                if (matchingSection) {
                    block.sectionId = matchingSection.id;
                    block.backgroundColor = matchingSection.backgroundColor;
                    block.textColor = matchingSection.textColor;
                }
            }
        }

        for (const line of page.lines) {
            const mapping = mappingById.get(line.id);
            if (mapping) {
                line.fieldType = mapping.fieldType;
                line.confidence = mapping.confidence || 0.5;
                line.groupId = mapping.groupId;

                // Apply section colors to line
                if (mapping.sectionId) {
                    const section = sectionsById.get(mapping.sectionId);
                    if (section) {
                        line.sectionId = section.id;
                        line.backgroundColor = section.backgroundColor;
                        line.textColor = section.textColor;
                    }
                }
            }

            // Fallback: find section by position
            if (!line.backgroundColor && sections.length > 0) {
                const matchingSection = findSectionForPosition(line.bbox, sections);
                if (matchingSection) {
                    line.sectionId = matchingSection.id;
                    line.backgroundColor = matchingSection.backgroundColor;
                    line.textColor = matchingSection.textColor;
                }
            }
        }
    }

    structure.sections = sections;
    return structure;
}

/**
 * Find which section contains a given position
 */
function findSectionForPosition(bbox, sections) {
    if (!bbox || !sections || sections.length === 0) return null;

    const centerX = bbox.x + (bbox.width || 0) / 2;
    const centerY = bbox.y + (bbox.height || 0) / 2;

    for (const section of sections) {
        if (!section.bbox) continue;

        const inX = centerX >= section.bbox.x && centerX <= section.bbox.x + section.bbox.width;
        const inY = centerY >= section.bbox.y && centerY <= section.bbox.y + section.bbox.height;

        if (inX && inY) {
            return section;
        }
    }

    return null;
}

/**
 * Full semantic analysis pipeline
 * Analyzes EACH PAGE separately with its own image
 * @param {Object} structure - Parsed PDF structure from pdfStructureParser
 * @param {Object|string} options - Options object or base64 image string for backward compatibility
 * @returns {Promise<Object>} Structure with semantic annotations
 */
async function analyzeSemantics(structure, options = {}) {
    let useAI = true;

    // Handle backward compatibility
    if (typeof options === 'string') {
        // Old format - single image (ignore, use per-page images)
    } else if (options && typeof options === 'object') {
        useAI = options.useAI !== false;
    }

    // Analyze each page separately to get page-specific sections
    const allMappings = [];
    const allSections = [];

    for (const page of structure.pages || []) {
        const pageNum = page.pageNumber || 1;
        const pageImage = page.aiImage || page.backgroundImage || null;

        console.log(`📄 Analyzing page ${pageNum}...`, pageImage ? `with image (${pageImage.length} chars)` : 'no image');

        let pageSemantics;

        if (useAI && pageImage) {
            // Try AI analysis for this specific page  
            pageSemantics = await analyzePageWithAI(page, pageImage, pageNum);
        }

        // Fallback to heuristics for this page
        if (!pageSemantics || !pageSemantics.sections || pageSemantics.sections.length === 0) {
            pageSemantics = analyzePageWithHeuristics(page, pageNum);
        }

        // Collect mappings and sections with pageNumber
        if (pageSemantics.mappings) {
            for (const m of pageSemantics.mappings) {
                m.pageNumber = pageNum;
                allMappings.push(m);
            }
        }

        if (pageSemantics.sections) {
            for (const s of pageSemantics.sections) {
                s.pageNumber = pageNum;
                allSections.push(s);
            }
        }

        console.log(`   ✅ Page ${pageNum}: ${pageSemantics.sections?.length || 0} sections found`);
    }

    const semantics = {
        mappings: allMappings,
        sections: allSections
    };

    return mergeStructureWithSemantics(structure, semantics);
}

/**
 * Analyze a single page with AI (Gemini)
 */
async function analyzePageWithAI(page, imageBase64, pageNum) {
    const useGemini = await ensureGemini();

    if (!useGemini || !geminiModel || !imageBase64) {
        return { mappings: [], sections: [] };
    }

    try {
        const match = imageBase64.match(/^data:(image\/\w+);base64,(.*)$/i);
        const mime = match ? match[1] : 'image/png';
        const data = match ? match[2] : imageBase64.replace(/^data:.*?;base64,/, '');

        const prompt = buildPageColorPrompt(page, pageNum);

        const response = await geminiModel.generateContent([
            { inlineData: { mimeType: mime, data } },
            { text: prompt }
        ]);

        const result = response?.response?.text?.() || '';
        const parsed = extractJSON(result);

        if (parsed && parsed.sections) {
            // Ensure all sections have pageNumber
            for (const s of parsed.sections) {
                s.pageNumber = pageNum;
            }
            return { mappings: parsed.mappings || [], sections: parsed.sections };
        }
    } catch (err) {
        console.warn(`AI analysis failed for page ${pageNum}:`, err.message);
    }

    return { mappings: [], sections: [] };
}

/**
 * Build prompt for page color analysis
 */
function buildPageColorPrompt(page, pageNum) {
    const pageWidth = page.width || 612;
    const pageHeight = page.height || 792;

    return `Analyze this resume/CV page image and identify all colored rectangular regions/sections.

PAGE INFO:
- Page number: ${pageNum}
- Page size: ${pageWidth} x ${pageHeight} pixels

TASK: Find ALL distinct background color regions on this page.
Look for: header areas, contact bars, sidebar sections, colored banners, section backgrounds.

For EACH colored region, provide:
1. Exact bounding box coordinates (x, y, width, height)
2. Background color in HEX format (e.g., #B8D4E8)
3. Text color used in that region
4. Section name (header, contact, content, sidebar, etc.)

IMPORTANT:
- All sections must span FULL PAGE WIDTH (width = ${pageWidth})
- x coordinate should be 0 for full-width sections
- Be PRECISE with y and height values based on what you see
- Include white sections too

Return ONLY valid JSON:
{
  "sections": [
    {
      "id": "page${pageNum}_section_1",
      "name": "header",
      "bbox": {"x": 0, "y": 0, "width": ${pageWidth}, "height": 80},
      "backgroundColor": "#B8D4E8",
      "textColor": "#1A1A1A"
    },
    {
      "id": "page${pageNum}_section_2", 
      "name": "contact",
      "bbox": {"x": 0, "y": 80, "width": ${pageWidth}, "height": 35},
      "backgroundColor": "#4A5568",
      "textColor": "#FFFFFF"
    },
    {
      "id": "page${pageNum}_section_3",
      "name": "content", 
      "bbox": {"x": 0, "y": 115, "width": ${pageWidth}, "height": ${pageHeight - 115}},
      "backgroundColor": "#FFFFFF",
      "textColor": "#333333"
    }
  ]
}`;
}

/**
 * Analyze a single page with heuristics (fallback)
 */
function analyzePageWithHeuristics(page, pageNum) {
    const pageWidth = page.width || 612;
    const pageHeight = page.height || 792;
    const sections = [];
    const mappings = [];

    // Sort blocks by Y position
    const allBlocks = [...(page.blocks || [])].sort((a, b) =>
        (a.bbox?.y || 0) - (b.bbox?.y || 0)
    );

    if (allBlocks.length === 0) {
        // No blocks - just white background
        sections.push({
            id: `page${pageNum}_section_1`,
            name: 'content',
            bbox: { x: 0, y: 0, width: pageWidth, height: pageHeight },
            backgroundColor: '#FFFFFF',
            textColor: '#333333',
            pageNumber: pageNum
        });
        return { mappings, sections };
    }

    // ONLY first page gets special treatment (header + contact bar)
    if (pageNum === 1) {
        let headerBottomY = 0;
        let contactTopY = -1;
        let contactBottomY = 0;

        // Find header (large font at top)
        for (const block of allBlocks) {
            const y = block.bbox?.y || 0;
            const h = block.bbox?.height || 20;
            const fontSize = block.font?.size || 12;

            if (y < 150 && fontSize > 16) {
                headerBottomY = Math.max(headerBottomY, y + h);
            }
        }

        // Find contact info (email, phone)
        for (const block of allBlocks) {
            const y = block.bbox?.y || 0;
            const h = block.bbox?.height || 20;
            const text = (block.text || '');

            const isContact = /@/.test(text) || /\d{3}[-.\s]?\d{3}[-.\s]?\d{4,5}/.test(text);

            if (isContact && y < 250) {
                if (contactTopY < 0) contactTopY = y;
                contactBottomY = Math.max(contactBottomY, y + h);
            }
        }

        let sectionIndex = 1;

        // Header section (light blue)
        if (headerBottomY > 0) {
            const headerEnd = contactTopY > 0 ? contactTopY : headerBottomY;
            sections.push({
                id: `page${pageNum}_section_${sectionIndex++}`,
                name: 'header',
                bbox: { x: 0, y: 0, width: pageWidth, height: headerEnd },
                backgroundColor: '#B8D4E8',
                textColor: '#1A1A1A',
                pageNumber: pageNum
            });
        }

        // Contact bar (dark gray)
        if (contactTopY > 0) {
            sections.push({
                id: `page${pageNum}_section_${sectionIndex++}`,
                name: 'contact',
                bbox: { x: 0, y: contactTopY, width: pageWidth, height: contactBottomY - contactTopY },
                backgroundColor: '#4A5568',
                textColor: '#FFFFFF',
                pageNumber: pageNum
            });
        }

        // Content area (white)
        const contentStart = contactBottomY > 0 ? contactBottomY : headerBottomY;
        if (contentStart < pageHeight - 50) {
            sections.push({
                id: `page${pageNum}_section_${sectionIndex++}`,
                name: 'content',
                bbox: { x: 0, y: contentStart, width: pageWidth, height: pageHeight - contentStart },
                backgroundColor: '#FFFFFF',
                textColor: '#333333',
                pageNumber: pageNum
            });
        }
    } else {
        // Pages 2+: just white background
        sections.push({
            id: `page${pageNum}_section_1`,
            name: 'content',
            bbox: { x: 0, y: 0, width: pageWidth, height: pageHeight },
            backgroundColor: '#FFFFFF',
            textColor: '#333333',
            pageNumber: pageNum
        });
    }

    return { mappings, sections };
}

module.exports = {
    analyzeSemantics,
    analyzeWithAI,
    analyzeWithHeuristics,
    mergeStructureWithSemantics,
    CV_FIELD_TYPES
};
