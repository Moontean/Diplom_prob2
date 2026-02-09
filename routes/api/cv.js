const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth');
const { check, validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const CV = require('../../models/CV');
const User = require('../../models/User');

// @route    GET api/cv/me
// @desc     Get current user's CV
// @access   Private
router.get('/me', auth, async (req, res) => {
  try {
    const cv = await CV.findOne({ user: req.user.id });

    if (!cv) {
      return res.status(400).json({ msg: 'There is no CV for this user' });
    }

    res.json(cv);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route    POST api/cv
// @desc     Create or update user CV
// @access   Private
router.post(
  '/',
  [auth, [check('cvData', 'CV data is required').not().isEmpty()]],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { cvData, template } = req.body;

    const cvFields = {};
    cvFields.user = req.user.id;
    if (cvData) cvFields.cvData = cvData;
    if (template) cvFields.template = template;

    try {
      let cv = await CV.findOne({ user: req.user.id });

      if (cv) {
        // Update
        cv = await CV.findOneAndUpdate(
          { user: req.user.id },
          { $set: cvFields },
          { new: true }
        );
        return res.json(cv);
      }

      // Create
      cv = new CV(cvFields);
      await cv.save();
      res.json(cv);
    } catch (err) {
      console.error(err.message);
      res.status(500).send('Server Error');
    }
  }
);

// @route    GET api/cv
// @desc     Get all CVs
// @access   Public (for testing, should be private in production)
router.get('/', async (req, res) => {
  try {
    const cvs = await CV.find().populate('user', ['name']);
    res.json(cvs);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});

// @route    POST api/cv/download-docx
// @desc     Generate DOCX from template with user data
// @access   Public
router.post('/download-docx', async (req, res) => {
  try {
    const { userData, selectedTemplate } = req.body;

    if (!userData) {
      return res.status(400).json({ success: false, message: 'Данные резюме отсутствуют' });
    }

    // Определяем путь к шаблону
    let templatePath;
    if (selectedTemplate === '/cv_templates/free-experienced-template-resume.docx') {
      templatePath = path.join(__dirname, '../../public/cv_templates/free-experienced-template-resume.docx');
    } else if (selectedTemplate === '/cv_templates/free-resume-example-entry-level.docx') {
      templatePath = path.join(__dirname, '../../public/cv_templates/free-resume-example-entry-level.docx');
    } else {
      // Если шаблон не выбран, возвращаем заглушку
      return res.status(400).json({ 
        success: false, 
        message: 'Шаблон не выбран. Пожалуйста, выберите шаблон на странице создания резюме.' 
      });
    }

    // Проверяем существование файла шаблона
    if (!fs.existsSync(templatePath)) {
      return res.status(404).json({ success: false, message: 'Файл шаблона не найден' });
    }

    // Читаем шаблон
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    // Подготавливаем данные для подстановки
    const templateData = {
      // Личная информация
      firstName: userData.personalInfo['given-name'] || '',
      lastName: userData.personalInfo['family-name'] || '',
      email: userData.personalInfo.email || '',
      phone: userData.personalInfo.phone || '',
      address: userData.personalInfo.address || '',
      city: userData.personalInfo.city || '',
      postalCode: userData.personalInfo['postal-code'] || '',
      jobPosition: userData.personalInfo['job-position'] || '',
      website: userData.personalInfo.website || '',
      linkedin: userData.personalInfo.linkedin || '',
      birthdate: userData.personalInfo.birthdate || '',

      // Профиль / Career Objective
      careerObjective: userData.additionalSections?.profile || '',
      profile: userData.additionalSections?.profile || '',

      // Опыт работы
      employment: (userData.employment || []).map(job => ({
        position: job.position || '',
        company: job.company || '',
        startDate: job.start_date || job.startDate || '',
        endDate: job.current ? 'Настоящее время' : (job.end_date || job.endDate || ''),
        jobDescription: job.description || '',
        current: job.current || false
      })),

      // Образование
      education: (userData.education || []).map(edu => ({
        degree: edu.degree || '',
        school: edu.school || '',
        level: edu.level || '',
        startYear: edu.start_year || edu.startYear || '',
        endYear: edu.end_year || edu.endYear || '',
        fieldOfStudy: edu.degree || ''
      })),

      // Навыки
      skills: (userData.skills || []).map(skill => ({
        skillName: skill.skill || '',
        skillLevel: skill.level || ''
      })),
      skillsList: (userData.skills || []).map(s => s.skill).filter(Boolean).join(', '),

      // Языки
      languages: (userData.languages || []).map(lang => ({
        language: lang.language || '',
        level: lang.level || ''
      })),

      // Дополнительные секции
      projects: userData.additionalSections?.projects || '',
      certificates: userData.additionalSections?.certificates || '',
      courses: userData.additionalSections?.courses || '',
      achievements: userData.additionalSections?.achievements || '',
      internships: userData.additionalSections?.internships || '',
      activities: userData.additionalSections?.activities || '',
      references: userData.additionalSections?.references || '',
      qualities: userData.additionalSections?.qualities || '',
    };

    // Заполняем шаблон данными
    doc.setData(templateData);

    try {
      doc.render();
    } catch (error) {
      console.error('Ошибка рендеринга шаблона:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Ошибка заполнения шаблона', 
        error: error.message 
      });
    }

    // Генерируем DOCX
    const buf = doc.getZip().generate({
      type: 'nodebuffer',
      compression: 'DEFLATE'
    });

    // Имя файла
    const fileName = `${userData.personalInfo['given-name'] || 'Resume'}_${userData.personalInfo['family-name'] || 'CV'}.docx`;

    // Отправляем файл
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buf);

  } catch (err) {
    console.error('Ошибка генерации DOCX:', err);
    res.status(500).json({ success: false, message: 'Ошибка сервера при генерации DOCX' });
  }
});

module.exports = router;
