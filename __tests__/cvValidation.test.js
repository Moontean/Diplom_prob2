const { cvSchema } = require('../services/cvValidation');

describe('cvSchema', () => {
  it('принимает минимально заполненный CV', () => {
    const data = {
      title: 'Резюме',
      personalInfo: { 'given-name': 'Иван', 'family-name': 'Иванов' },
      employment: [{ position: 'Dev', company: 'Acme' }]
    };
    const parsed = cvSchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });

  it('отклоняет слишком длинные строки', () => {
    const longText = 'a'.repeat(2001);
    const data = { additionalSections: { profile: longText } };
    const parsed = cvSchema.safeParse(data);
    expect(parsed.success).toBe(false);
  });

  it('отклоняет слишком большой base64 для фото', () => {
    const bigBase64 = 'data:image/png;base64,' + Buffer.alloc(3 * 1024 * 1024).toString('base64');
    const data = { personalInfo: { photo: bigBase64 } };
    const parsed = cvSchema.safeParse(data);
    expect(parsed.success).toBe(false);
  });
});
