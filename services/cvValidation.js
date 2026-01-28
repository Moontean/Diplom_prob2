const { z } = require('zod');

const MAX_STR = 500;
const MAX_LONG = 2000;
const MAX_ITEMS = 50;
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // ~2MB base64 payload

const shortStr = z.string().trim().max(MAX_STR);
const longStr = z.string().trim().max(MAX_LONG);

const dataUrl = z
  .string()
  .trim()
  .max(MAX_PHOTO_BYTES * 1.4) // base64 overhead
  .regex(/^data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+$/, 'Неверный формат изображения')
  .refine((v) => {
    try {
      const base64 = v.split(',')[1] || '';
      return Buffer.byteLength(base64, 'base64') <= MAX_PHOTO_BYTES;
    } catch (_) {
      return false;
    }
  }, 'Изображение слишком большое (макс 2MB)');

const employmentItem = z.object({
  position: shortStr.optional(),
  company: shortStr.optional(),
  start_date: shortStr.optional(),
  startDate: shortStr.optional(),
  end_date: shortStr.optional(),
  endDate: shortStr.optional(),
  current: z.boolean().optional(),
  description: longStr.optional()
});

const educationItem = z.object({
  school: shortStr.optional(),
  degree: shortStr.optional(),
  level: shortStr.optional(),
  start_year: shortStr.optional(),
  startYear: shortStr.optional(),
  end_year: shortStr.optional(),
  endYear: shortStr.optional()
});

const skillItem = z.object({
  skill: shortStr.optional(),
  level: shortStr.optional()
});

const languageItem = z.object({
  language: shortStr.optional(),
  level: shortStr.optional()
});

const customSection = z.object({
  title: shortStr.optional(),
  content: longStr.optional()
});

const personalInfo = z.object({
  'given-name': shortStr.optional(),
  givenName: shortStr.optional(),
  'family-name': shortStr.optional(),
  familyName: shortStr.optional(),
  'job-position': shortStr.optional(),
  jobPosition: shortStr.optional(),
  email: shortStr.optional(),
  phone: shortStr.optional(),
  address: longStr.optional(),
  'postal-code': shortStr.optional(),
  postalCode: shortStr.optional(),
  city: shortStr.optional(),
  birthdate: shortStr.optional(),
  website: shortStr.optional(),
  linkedin: shortStr.optional(),
  photo: dataUrl.optional()
});

const additionalSections = z.object({
  profile: longStr.optional(),
  projects: longStr.optional(),
  certificates: longStr.optional(),
  courses: longStr.optional(),
  internships: longStr.optional(),
  activities: longStr.optional(),
  references: longStr.optional(),
  qualities: longStr.optional(),
  achievements: longStr.optional(),
  signature: longStr.optional(),
  footer: longStr.optional(),
  assessment: longStr.optional(),
  custom: z.array(customSection).max(10).optional()
}).optional();

const settings = z.object({
  fontSize: shortStr.optional(),
  colorScheme: shortStr.optional(),
  includePhoto: z.boolean().optional()
}).optional();

const cvSchema = z.object({
  _id: z.string().optional(),
  title: shortStr.optional(),
  personalInfo: personalInfo.optional(),
  employment: z.array(employmentItem).max(MAX_ITEMS).optional(),
  education: z.array(educationItem).max(MAX_ITEMS).optional(),
  skills: z.array(skillItem).max(MAX_ITEMS).optional(),
  languages: z.array(languageItem).max(MAX_ITEMS).optional(),
  additionalSections,
  template: shortStr.optional(),
  settings
});

module.exports = { cvSchema };
