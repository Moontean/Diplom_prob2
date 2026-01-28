// index.js
require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const multer = require('multer');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const connectDB = require('./config/database');
const User = require('./models/User');
const CV = require('./models/CV');
const Assessment = require('./models/Assessment');
const { generateAssessment, evaluateOpenAnswer } = require('./services/llm');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } = require('docx');
const { cvSchema } = require('./services/cvValidation');
const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

if (isProd) {
  app.set('trust proxy', 1);
}

// Подключение к MongoDB
let isDBConnected = false;
connectDB().then((conn) => {
  isDBConnected = !!conn;
}).catch(() => {
  isDBConnected = false;
});

// Fallback: простая база данных пользователей в памяти (если MongoDB недоступна)
const users = new Map();
const assessments = new Map();

// Настройка middleware (увеличиваем лимит тела запроса для больших CV/фото)
app.use(bodyParser.urlencoded({ extended: true, limit: '15mb' }));
app.use(bodyParser.json({ limit: '15mb' }));
const sessionSecret = process.env.SESSION_SECRET || '';
if (!sessionSecret) {
  console.warn('⚠️ SESSION_SECRET не задан. Используется небезопасное значение для dev.');
}

app.use(session({
  secret: sessionSecret || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Раздача статических файлов из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Раздача загруженных файлов (только для авторизованных)
// Перенесено ниже после определения requireAuth

// Логирование всех запросов для отладки
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Ограничитель для генерации тестов
const generateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false
});

// Ограничитель для аутентификации
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Слишком много попыток. Повторите позже.'
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'index.html'));
});

// Маршрут для /home — редирект на корень
app.get('/pages/home', (req, res) => {
  res.redirect('/');
});

// Страница создания резюме
app.get('/pages/make_CV', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'make_cv.html'));
});

// Шаблоны резюме
app.get('/pages/cv-templates', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'cv_templates.html'));
});

// Примеры резюме
app.get('/pages/cv-examples', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'cv_examples.html'));
});

// Статьи
app.get('/pages/articles', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'articles.html'));
});

// Цены
app.get('/pages/pricing', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'pricing.html'));
});

// FAQ
app.get('/pages/faq', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'faq.html'));
});

// Авторизация
app.get('/pages/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'login.html'));
});

// Страница регистрации
app.get('/register', (req, res) => {
  console.log('Маршрут /register запрошен');
  res.sendFile(path.join(__dirname, 'public', 'pages', 'register.html'));
});

// Альтернативный маршрут регистрации
app.get('/pages/register', (req, res) => {
  console.log('Маршрут /pages/register запрошен');
  res.sendFile(path.join(__dirname, 'public', 'pages', 'register.html'));
});

// Личный кабинет
app.get('/pages/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'dashboard.html'));
});

// Статус системы
app.get('/pages/status', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'status.html'));
});

// API для проверки статуса базы данных
app.get('/api/db-status', (req, res) => {
  res.json({ 
    connected: isDBConnected,
    database: isDBConnected ? 'MongoDB' : 'In-Memory',
    timestamp: new Date().toISOString()
  });
});

// POST маршрут для регистрации
app.post('/api/register', authLimiter, async (req, res) => {
  const { email, password, confirmPassword, firstName, lastName } = req.body;
  
  // Валидация
  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ success: false, message: 'Все поля обязательны для заполнения' });
  }
  
  if (password !== confirmPassword) {
    return res.status(400).json({ success: false, message: 'Пароли не совпадают' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Пароль должен содержать минимум 6 символов' });
  }
  
  try {
    if (isDBConnected) {
      // Используем MongoDB
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'Пользователь с таким email уже существует' });
      }
      
      const newUser = new User({
        firstName,
        lastName,
        email,
        password // Пароль будет автоматически захеширован в pre-save hook
      });
      
      await newUser.save();
      
      res.json({ success: true, message: 'Регистрация прошла успешно!' });
    } else {
      // Fallback: используем in-memory хранилище
      if (users.has(email)) {
        return res.status(400).json({ success: false, message: 'Пользователь с таким email уже существует' });
      }
      
      const hashedPassword = await bcrypt.hash(password, 10);
      
      users.set(email, {
        email,
        password: hashedPassword,
        firstName,
        lastName,
        registeredAt: new Date(),
        resumes: []
      });
      
      res.json({ success: true, message: 'Регистрация прошла успешно!' });
    }
  } catch (error) {
    console.error('Ошибка регистрации:', error);
    if (error.code === 11000) {
      res.status(400).json({ success: false, message: 'Пользователь с таким email уже существует' });
    } else if (error.name === 'ValidationError') {
      const firstError = Object.values(error.errors)[0];
      res.status(400).json({ success: false, message: firstError.message });
    } else {
      res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
  }
});

// POST маршрут для входа
app.post('/api/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email и пароль обязательны' });
  }
  
  try {
    if (isDBConnected) {
      // Используем MongoDB
      const user = await User.findOne({ email }).select('+password');
      if (!user || !user.isActive) {
        return res.status(401).json({ success: false, message: 'Неверный email или пароль' });
      }
      
      const isValidPassword = await user.comparePassword(password);
      if (!isValidPassword) {
        return res.status(401).json({ success: false, message: 'Неверный email или пароль' });
      }
      
      // Обновляем последний вход
      user.lastLogin = new Date();
      await user.save();
      
      // Создаем сессию
      req.session.userId = user._id;
      req.session.user = user.getPublicProfile();
      
      res.json({
        success: true,
        message: 'Вход выполнен успешно!',
        user: req.session.user
      });
    } else {
      // Fallback: используем in-memory хранилище
      const user = users.get(email);
      if (!user) {
        return res.status(401).json({ success: false, message: 'Неверный email или пароль' });
      }
      
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ success: false, message: 'Неверный email или пароль' });
      }
      
      req.session.userId = email;
      req.session.user = {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      };
      
      res.json({
        success: true,
        message: 'Вход выполнен успешно!',
        user: req.session.user
      });
    }
  } catch (error) {
    console.error('Ошибка входа:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Маршрут для выхода
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Ошибка при выходе' });
    }
    res.json({ success: true, message: 'Выход выполнен успешно' });
  });
});

// Маршрут для проверки авторизации
app.get('/api/user', (req, res) => {
  if (req.session.userId) {
    res.json({ authenticated: true, user: req.session.user });
  } else {
    res.json({ authenticated: false });
  }
});

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'photo') {
      // Для фотографий
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Разрешены только изображения'), false);
      }
    } else if (file.fieldname === 'resume') {
      // Для документов резюме
      const allowedMimes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Разрешены только PDF, DOC и DOCX файлы'), false);
      }
    } else {
      cb(new Error('Неизвестный тип поля'), false);
    }
  }
});

// Middleware для проверки авторизации
function requireAuth(req, res, next) {
  if (req.session.userId) {
    next();
  } else {
    res.status(401).json({ success: false, message: 'Требуется авторизация' });
  }
}

function validateCv(req, res, next) {
  const parsed = cvSchema.safeParse(req.body);
  if (!parsed.success) {
    const errors = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
    return res.status(400).json({ success: false, message: 'Неверные данные CV', errors });
  }
  req.validatedCv = parsed.data;
  next();
}

// Защищённая раздача загруженных файлов
app.use('/uploads', requireAuth, express.static(path.join(__dirname, 'uploads')));

// Получение последнего результата теста пользователя (без процентов)
async function getLatestAssessmentResult(userId) {
  try {
    if (isDBConnected) {
      const records = await Assessment.find({ userId }).sort({ createdAt: -1 }).lean();
      let latest = null;
      for (const rec of records) {
        if (!rec.submissions?.length) continue;
        const lastSub = rec.submissions[rec.submissions.length - 1];
        if (!lastSub) continue;
        if (!latest || new Date(lastSub.evaluatedAt || rec.createdAt) > new Date(latest.evaluatedAt || latest.createdAt)) {
          latest = {
            profession: rec.profession,
            difficulty: rec.difficulty,
            totalQuestions: rec.questions?.length || rec.numQuestions || 0,
            score: lastSub.totalScore,
            evaluatedAt: lastSub.evaluatedAt || rec.createdAt
          };
        }
      }
      return latest;
    }

    // Fallback: in-memory
    const list = assessments.get(userId) || [];
    let latest = null;
    for (const rec of list) {
      if (!rec.submissions?.length) continue;
      const lastSub = rec.submissions[rec.submissions.length - 1];
      if (!lastSub) continue;
      if (!latest || new Date(lastSub.evaluatedAt || rec.createdAt) > new Date(latest.evaluatedAt || latest.createdAt)) {
        latest = {
          profession: rec.profession,
          difficulty: rec.difficulty,
          totalQuestions: rec.questions?.length || rec.numQuestions || 0,
          score: lastSub.totalScore,
          evaluatedAt: lastSub.evaluatedAt || rec.createdAt
        };
      }
    }
    return latest;
  } catch (err) {
    console.error('Ошибка получения теста для письма:', err);
    return null;
  }
}

// ===== API МАРШРУТЫ ДЛЯ CV =====

// Получение списка CV пользователя
app.get('/api/cv/list', requireAuth, async (req, res) => {
  try {
    if (isDBConnected) {
      const cvs = await CV.findByUserId(req.session.userId);
      res.json({
        success: true,
        cvs: cvs.map(cv => ({
          _id: cv._id,
          title: cv.title,
          updatedAt: cv.updatedAt,
          personalInfo: {
            fullName: cv.personalInfo?.fullName || '',
            jobPosition: cv.personalInfo?.jobPosition || ''
          }
        }))
      });
    } else {
      // Fallback для in-memory storage
      res.json({ success: true, cvs: [] });
    }
  } catch (error) {
    console.error('Ошибка получения списка CV:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Создание нового CV
app.post('/api/cv/create', requireAuth, async (req, res) => {
  try {
    if (isDBConnected) {
      const newCV = new CV({
        userId: req.session.userId,
        title: req.body.title || 'Новое резюме',
        personalInfo: {},
        employment: [],
        education: [],
        skills: [],
        languages: []
      });
      
      await newCV.save();
      res.json({
        success: true,
        message: 'Резюме создано успешно',
        cv: newCV
      });
    } else {
      // Fallback
      res.json({
        success: true,
        message: 'Резюме создано успешно (in-memory)',
        cv: { _id: Date.now(), title: req.body.title || 'Новое резюме' }
      });
    }
  } catch (error) {
    console.error('Ошибка создания CV:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Получение конкретного CV
app.get('/api/cv/:id', requireAuth, async (req, res) => {
  try {
    if (isDBConnected) {
      const cv = await CV.findOne({ _id: req.params.id, userId: req.session.userId });
      if (!cv) {
        return res.status(404).json({ success: false, message: 'Резюме не найдено' });
      }
      res.json({ success: true, cv });
    } else {
      // Fallback
      res.json({ success: true, cv: { _id: req.params.id, title: 'Тестовое резюме' } });
    }
  } catch (error) {
    console.error('Ошибка получения CV:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Сохранение CV
app.post('/api/cv/save', requireAuth, validateCv, async (req, res) => {
  try {
    const payload = req.validatedCv || {};
    if (isDBConnected) {
      const { _id, ...cvData } = payload;
      
      let cv;
      if (_id) {
        // Обновление существующего CV
        cv = await CV.findOneAndUpdate(
          { _id, userId: req.session.userId },
          cvData,
          { new: true, runValidators: true }
        );
        if (!cv) {
          return res.status(404).json({ success: false, message: 'Резюме не найдено' });
        }
      } else {
        // Создание нового CV
        cv = new CV({
          userId: req.session.userId,
          ...cvData
        });
        await cv.save();
      }
      
      res.json({
        success: true,
        message: 'Резюме сохранено успешно',
        cv: cv
      });
    } else {
      // Fallback
      res.json({
        success: true,
        message: 'Резюме сохранено успешно (in-memory)'
      });
    }
  } catch (error) {
    console.error('Ошибка сохранения CV:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Ошибка валидации данных',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Удаление CV
app.delete('/api/cv/:id', requireAuth, async (req, res) => {
  try {
    if (isDBConnected) {
      const cv = await CV.findOneAndDelete({ _id: req.params.id, userId: req.session.userId });
      if (!cv) {
        return res.status(404).json({ success: false, message: 'Резюме не найдено' });
      }
      res.json({ success: true, message: 'Резюме удалено успешно' });
    } else {
      // Fallback
      res.json({ success: true, message: 'Резюме удалено успешно (in-memory)' });
    }
  } catch (error) {
    console.error('Ошибка удаления CV:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Загрузка фото профиля
app.post('/api/cv/upload-photo', requireAuth, upload.single('photo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Файл не загружен' });
    }
    
    const photoUrl = `/uploads/${req.file.filename}`;
    res.json({
      success: true,
      message: 'Фото загружено успешно',
      photoUrl: photoUrl
    });
  } catch (error) {
    console.error('Ошибка загрузки фото:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Экспорт CV в PDF
app.post('/api/cv/download', requireAuth, validateCv, async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const cv = req.validatedCv || {};
    const fs = require('fs');

    // Выбор системного шрифта с поддержкой кириллицы (Windows/Linux)
    const pickFont = () => {
      const candidates = [
        { regular: 'C:/Windows/Fonts/arial.ttf', bold: 'C:/Windows/Fonts/arialbd.ttf' },
        { regular: 'C:/Windows/Fonts/segoeui.ttf', bold: 'C:/Windows/Fonts/seguisb.ttf' },
        { regular: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', bold: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' },
        { regular: '/usr/share/fonts/truetype/freefont/FreeSans.ttf', bold: '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf' }
      ];
      for (const p of candidates) {
        if (fs.existsSync(p.regular)) {
          return p;
        }
      }
      return null;
    };
    const fontPaths = pickFont();

    // Маппинг акцентного цвета по шаблону
    const accentMap = {
      modern: '#2563eb',
      classic: '#111827',
      minimal: '#374151',
      creative: '#7c3aed'
    };
    const accent = accentMap[cv.template] || accentMap.modern;

    res.setHeader('Content-Type', 'application/pdf');
    const filename = `${(cv.title || 'resume').replace(/[^\w\-]+/g, '_')}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);

    // Заголовок
    if (fontPaths) doc.font(fontPaths.bold);
    doc.fillColor(accent).fontSize(22).text(cv.title || 'Моё резюме', { continued: false });
    if (fontPaths) doc.font(fontPaths.regular);

    // Подзаголовок (должность)
    const p = cv.personalInfo || {};
    const headline = p['job-position'] || p.jobPosition || '';
    if (headline) {
      if (fontPaths) doc.font(fontPaths.regular);
      doc.moveDown(0.3).fillColor('#374151').fontSize(12).text(headline);
    }

    // Контакты в строку
    const contacts = [
      p.email ? `Email: ${p.email}` : null,
      p.phone ? `Тел: ${p.phone}` : null,
      p.city ? `Город: ${p.city}` : null,
      p.website ? `Сайт: ${p.website}` : null,
      p.linkedin ? `LinkedIn: ${p.linkedin}` : null
    ].filter(Boolean);
    if (contacts.length) {
      if (fontPaths) doc.font(fontPaths.regular);
      doc.moveDown(0.5).fillColor('#6b7280').fontSize(10).text(contacts.join('  •  '));
    }

    // Фото (если base64)
    const photo = p.photo;
    let photoBox = null;
    if (photo && typeof photo === 'string' && photo.startsWith('data:image/')) {
      try {
        const base64 = photo.split(',')[1];
        const buf = Buffer.from(base64, 'base64');
        const photoSize = 144; // увеличили картинку в PDF в 2 раза
        const photoX = doc.page.width - 50 - photoSize;
        const photoY = 50; // Сдвиг по Y

        // Без рамок/обрезки: показываем как есть, просто вписываем в квадрат с сохранением пропорций
        doc.image(buf, photoX, photoY, { fit: [photoSize, photoSize], align: 'center', valign: 'center' });

        photoBox = { x: photoX, y: photoY, size: photoSize };
      } catch (_) {}
    }

    // Сдвигаем курсор ниже фото, чтобы линии/секции не пересекали его по вертикали
    if (photoBox) {
      const targetY = photoBox.y + photoBox.size + 12;
      if (doc.y < targetY) {
        doc.y = targetY;
      }
    }

    let sectionCount = 0;
    const addSection = (title) => {
      sectionCount += 1;
      if (fontPaths) doc.font(fontPaths.bold);
      doc.moveDown().fillColor(accent).fontSize(14).text(title);
      if (sectionCount > 1) {
        const lineEnd = photoBox ? Math.max(120, photoBox.x - 12) : doc.page.width - 50;
        doc.moveTo(50, doc.y + 2).lineTo(lineEnd, doc.y + 2).strokeColor('#e5e7eb').stroke();
      }
      doc.moveDown(0.3);
      if (fontPaths) doc.font(fontPaths.regular);
      doc.fillColor('#111827').fontSize(11);
    };

    // Персональные данные (кроме того, что уже показали)
    const personalPairs = [];
    const fullName = [p['given-name'] || p.givenName, p['family-name'] || p.familyName].filter(Boolean).join(' ');
    if (fullName) personalPairs.push(['Имя', fullName]);
    if (p.address) personalPairs.push(['Адрес', p.address]);
    if (p['postal-code'] || p.postalCode) personalPairs.push(['Индекс', p['postal-code'] || p.postalCode]);
    if (personalPairs.length) {
      addSection('Персональные данные');
      personalPairs.forEach(([k, v]) => doc.text(`${k}: ${v}`));
    }

    // Опыт работы
    const employment = Array.isArray(cv.employment) ? cv.employment : [];
    if (employment.length) {
      addSection('Опыт работы');
      employment.forEach((item) => {
        const position = [item.position, item.company].filter(Boolean).join(' · ');
        const period = [item.start_date || item.startDate, item.current ? 'по наст. время' : (item.end_date || item.endDate)].filter(Boolean).join(' — ');
        if (position) doc.fontSize(12).text(position);
        if (period) doc.fillColor('#6b7280').fontSize(10).text(period);
        if (item.description) doc.fillColor('#111827').fontSize(11).text(item.description);
        doc.moveDown(0.5);
        doc.fillColor('#111827');
      });
    }

    // Образование
    const education = Array.isArray(cv.education) ? cv.education : [];
    if (education.length) {
      addSection('Образование');
      education.forEach((item) => {
        const school = item.school || '';
        const degree = [item.degree, item.level].filter(Boolean).join(' · ');
        const years = [item.start_year || item.startYear, item.end_year || item.endYear].filter(Boolean).join(' — ');
        if (school) doc.fontSize(12).text(school);
        if (degree) doc.fillColor('#6b7280').fontSize(10).text(degree);
        if (years) doc.fillColor('#6b7280').fontSize(10).text(years);
        doc.moveDown(0.5);
        doc.fillColor('#111827');
      });
    }

    // Навыки
    const skills = Array.isArray(cv.skills) ? cv.skills : [];
    if (skills.length) {
      addSection('Навыки');
      const line = skills.map(s => `${s.skill || ''}${s.level ? ' · ' + s.level : ''}`).filter(Boolean).join('  •  ');
      if (line) doc.text(line);
    }

    // Языки
    const languages = Array.isArray(cv.languages) ? cv.languages : [];
    if (languages.length) {
      addSection('Языки');
      const line = languages.map(l => `${l.language || ''}${l.level ? ' · ' + l.level : ''}`).filter(Boolean).join('  •  ');
      if (line) doc.text(line);
    }

    // Дополнительные разделы
    const add = cv.additionalSections || {};
    const titleMap = {
      profile: 'Профиль', projects: 'Проекты', certificates: 'Сертификаты', courses: 'Курсы', internships: 'Стажировки',
      activities: 'Дополнительные виды деятельности', references: 'Рекомендации', qualities: 'Качества', achievements: 'Достижения',
      signature: 'Подпись', footer: 'Нижний колонтитул', assessment: 'Результаты теста', custom: 'Собственный раздел'
    };
    for (const [key, content] of Object.entries(add)) {
      if (!content) continue;
      if (key === 'custom' && Array.isArray(content)) {
        content.forEach(entry => {
          if (!entry || (!entry.title && !entry.content)) return;
          addSection(entry.title || 'Собственный раздел');
          doc.text(String(entry.content || ''));
        });
        continue;
      }
      addSection(titleMap[key] || key);
      doc.text(String(content));
    }

    doc.end();
  } catch (error) {
    console.error('Ошибка экспорта PDF:', error);
    // В случае ошибки — корректный JSON
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Ошибка сервера при экспорте PDF' });
    }
  }
});

// Маршрут для CV Builder страницы
app.get('/pages/cv-builder', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'cv-builder.html'));
});

// Страница предварительного просмотра CV
app.get('/pages/cv-preview', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'cv-preview.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
  console.log(`📊 База данных: ${isDBConnected ? 'MongoDB подключена' : 'Работа в режиме in-memory'}`);
  console.log('📄 Доступные маршруты:');
  console.log('   GET /');
  console.log('   GET /register'); 
  console.log('   GET /pages/register');
  console.log('   GET /pages/login');
  console.log('   GET /pages/dashboard');
  console.log('   GET /pages/cv-builder');
  console.log('   POST /api/register');
  console.log('   POST /api/login');
  console.log('   POST /api/logout');
  console.log('   GET /api/user');
  console.log('📝 CV API маршруты:');
  console.log('   GET /api/cv/list');
  console.log('   POST /api/cv/create');
  console.log('   GET /api/cv/:id');
  console.log('   POST /api/cv/save');
  console.log('   DELETE /api/cv/:id');
  console.log('   POST /api/cv/upload-photo');
  console.log('   POST /api/cv/download');
  console.log('🧪 Assessment API маршруты:');
  console.log('   POST /api/assessment/generate');
  console.log('   POST /api/assessment/submit');
  console.log('   GET  /api/assessment/:id');
  console.log('   GET  /api/assessment');
});

// ===== API МАРШРУТЫ ДЛЯ ОЦЕНОК (AI ТЕСТЫ) =====

// Страница тестов (UI)
app.get('/pages/assessment', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'assessment.html'));
});

// Генерация теста
app.post('/api/assessment/generate', requireAuth, generateLimiter, async (req, res) => {
  const { profession, difficulty = 'junior', numQuestions = 10, mix = 'mixed' } = req.body || {};
  if (!profession || typeof profession !== 'string') {
    return res.status(400).json({ success: false, message: 'Укажите профессию' });
  }
  try {
    const data = await generateAssessment({ profession, difficulty, numQuestions, mix });

    // Разделим answerKey и вопросы
    const answerKey = [];
    const questions = data.questions.map(q => {
      if (q.type === 'mcq' && typeof q.correctIndex === 'number') {
        answerKey.push({ id: q.id, correctIndex: q.correctIndex });
        // Не возвращаем правильный ответ на клиент
        const { correctIndex, ...rest } = q;
        return rest;
      }
      return q;
    });

    let assessmentId;
    if (isDBConnected) {
      const doc = new Assessment({
        userId: req.session.userId,
        profession,
        difficulty,
        numQuestions,
        questions,
        answerKey
      });
      await doc.save();
      assessmentId = doc._id.toString();
    } else {
      // In-memory
      assessmentId = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      assessments.set(assessmentId, {
        _id: assessmentId,
        userId: req.session.userId,
        profession,
        difficulty,
        numQuestions,
        questions,
        answerKey,
        submissions: [],
        createdAt: new Date()
      });
    }

    res.json({ success: true, assessmentId, questions });
  } catch (error) {
    console.error('Ошибка генерации теста:', error);
    const msg = error?.message?.includes('Gemini') ? 'Проблема с AI провайдером' : 'Ошибка сервера';
    res.status(500).json({ success: false, message: msg });
  }
});

// Отправка ответов и оценка
app.post('/api/assessment/submit', requireAuth, async (req, res) => {
  const { assessmentId, answers } = req.body || {};
  if (!assessmentId || !Array.isArray(answers)) {
    return res.status(400).json({ success: false, message: 'Неверные параметры' });
  }
  try {
    let assessment;
    if (isDBConnected) {
      assessment = await Assessment.findOne({ _id: assessmentId, userId: req.session.userId });
    } else {
      assessment = assessments.get(assessmentId);
      if (assessment && assessment.userId?.toString() !== req.session.userId?.toString()) {
        assessment = null;
      }
    }
    if (!assessment) {
      return res.status(404).json({ success: false, message: 'Тест не найден' });
    }

    const byId = new Map(assessment.questions.map(q => [q.id, q]));
    const keyById = new Map(assessment.answerKey.map(k => [k.id, k.correctIndex]));

    const breakdown = [];
    let totalScore = 0;
    for (const item of answers) {
      const q = byId.get(item.id);
      if (!q) continue;
      if (q.type === 'mcq') {
        const correctIndex = keyById.get(q.id);
        const isCorrect = typeof correctIndex === 'number' && item.answer === correctIndex;
        breakdown.push({ id: q.id, type: q.type, correct: isCorrect, score: isCorrect ? 1 : 0, reasoning: isCorrect ? 'Верно' : 'Неверно' });
        totalScore += isCorrect ? 1 : 0;
      } else if (q.type === 'open') {
        const evalRes = await evaluateOpenAnswer({ question: q, answer: String(item.answer || '') });
        breakdown.push({ id: q.id, type: q.type, correct: undefined, score: evalRes.score, reasoning: evalRes.reasoning });
        totalScore += evalRes.score;
      }
    }

    // Нормируем по числу вопросов
    const normalizedScore = assessment.questions.length ? totalScore / assessment.questions.length : 0;

    // Сохранение сабмита
    const submission = {
      answers: answers.map(a => ({ id: a.id, answer: a.answer, score: breakdown.find(b => b.id === a.id)?.score || null, feedback: breakdown.find(b => b.id === a.id)?.reasoning || '' })),
      totalScore: normalizedScore,
      breakdown,
      evaluatedAt: new Date()
    };

    if (isDBConnected) {
      assessment.submissions.push(submission);
      await assessment.save();
    } else {
      assessment.submissions.push(submission);
      assessments.set(assessmentId, assessment);
    }

    res.json({ success: true, score: normalizedScore, breakdown });
  } catch (error) {
    console.error('Ошибка оценки теста:', error);
    const msg = error?.message?.includes('Gemini') ? 'Проблема с AI провайдером' : 'Ошибка сервера';
    res.status(500).json({ success: false, message: msg });
  }
});

// Получить тест
app.get('/api/assessment/:id', requireAuth, async (req, res) => {
  const id = req.params.id;
  try {
    let assessment;
    if (isDBConnected) {
      assessment = await Assessment.findOne({ _id: id, userId: req.session.userId });
    } else {
      assessment = assessments.get(id);
      if (assessment && assessment.userId?.toString() !== req.session.userId?.toString()) {
        assessment = null;
      }
    }
    if (!assessment) return res.status(404).json({ success: false, message: 'Тест не найден' });

    // Не отдаём answerKey
    const { answerKey, ...rest } = assessment.toObject ? assessment.toObject() : assessment;
    res.json({ success: true, assessment: rest });
  } catch (error) {
    console.error('Ошибка получения теста:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Список тестов пользователя
app.get('/api/assessment', requireAuth, async (req, res) => {
  try {
    let list = [];
    if (isDBConnected) {
      list = await Assessment.findByUserId(req.session.userId);
      list = list.map(doc => ({
        _id: doc._id,
        profession: doc.profession,
        difficulty: doc.difficulty,
        numQuestions: doc.numQuestions,
        createdAt: doc.createdAt,
        submissionsCount: doc.submissions?.length || 0
      }));
    } else {
      for (const v of assessments.values()) {
        if (v.userId?.toString() === req.session.userId?.toString()) {
          list.push({ _id: v._id, profession: v.profession, difficulty: v.difficulty, numQuestions: v.numQuestions, createdAt: v.createdAt, submissionsCount: v.submissions?.length || 0 });
        }
      }
      // сортировка по дате
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    res.json({ success: true, assessments: list });
  } catch (error) {
    console.error('Ошибка списка тестов:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Последний результат теста пользователя (для прикрепления к CV)
app.get('/api/assessment/latest', requireAuth, async (req, res) => {
  try {
    let latest = null;

    if (isDBConnected) {
      latest = await Assessment.findOne({ userId: req.session.userId, submissions: { $exists: true, $ne: [] } })
        .sort({ 'submissions.evaluatedAt': -1, createdAt: -1 })
        .lean();
    } else {
      for (const v of assessments.values()) {
        if (v.userId?.toString() !== req.session.userId?.toString()) continue;
        if (!v.submissions?.length) continue;
        if (!latest || new Date(v.submissions[v.submissions.length - 1].evaluatedAt || v.createdAt) > new Date(latest.submissions[latest.submissions.length - 1].evaluatedAt || latest.createdAt)) {
          latest = v;
        }
      }
    }

    if (!latest || !latest.submissions?.length) {
      return res.status(404).json({ success: false, message: 'У вас пока нет завершённых тестов.' });
    }

    const submission = latest.submissions[latest.submissions.length - 1];
    const totalQuestions = latest.questions?.length || latest.numQuestions || 0;
    res.json({
      success: true,
      result: {
        profession: latest.profession,
        difficulty: latest.difficulty,
        totalQuestions,
        score: submission.totalScore,
        submittedAt: submission.evaluatedAt || latest.createdAt,
        breakdown: submission.breakdown || []
      }
    });
  } catch (error) {
    console.error('Ошибка получения последнего теста:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Экспорт CV в Word (DOCX)
app.post('/api/cv/download-docx', requireAuth, validateCv, async (req, res) => {
  try {
    const cv = req.validatedCv || {};
    const children = [];

    const dataUrlToBuffer = (dataUrl) => {
      if (!dataUrl || typeof dataUrl !== 'string') return null;
      const match = dataUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
      if (!match) return null;
      try {
        return Buffer.from(match[2], 'base64');
      } catch (_) {
        return null;
      }
    };

    const addHeading = (text, level = HeadingLevel.HEADING_2) => {
      if (!text) return;
      children.push(new Paragraph({ text, heading: level, spacing: { after: 150 } }));
    };

    const addParagraph = (text, opts = {}) => {
      if (!text) return;
      children.push(new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 120 } }));
    };

    const addBullet = (text) => {
      if (!text) return;
      children.push(new Paragraph({ text, bullet: { level: 0 }, spacing: { after: 60 } }));
    };

    const p = cv.personalInfo || {};
    const fullName = [p['given-name'] || p.givenName, p['family-name'] || p.familyName].filter(Boolean).join(' ');
    const title = cv.title || 'Моё резюме';
    addHeading(title, HeadingLevel.HEADING_1);
    const headline = p['job-position'] || p.jobPosition || '';
    if (headline) addParagraph(headline, { bold: true });

    // Фото
    if (cv.settings?.includePhoto !== false && p.photo) {
      const photoBuffer = dataUrlToBuffer(p.photo);
      if (photoBuffer) {
        children.push(new Paragraph({
          children: [new ImageRun({ data: photoBuffer, transformation: { width: 120, height: 120 } })],
          spacing: { after: 150 }
        }));
      }
    }

    const contacts = [
      p.email ? `Email: ${p.email}` : null,
      p.phone ? `Тел: ${p.phone}` : null,
      p.city ? `Город: ${p.city}` : null,
      p.website ? `Сайт: ${p.website}` : null,
      p.linkedin ? `LinkedIn: ${p.linkedin}` : null
    ].filter(Boolean).join('  •  ');
    if (contacts) addParagraph(contacts);

    // Персональные данные
    const personalLines = [];
    if (fullName) personalLines.push(`Имя: ${fullName}`);
    if (p.address) personalLines.push(`Адрес: ${p.address}`);
    if (p['postal-code'] || p.postalCode) personalLines.push(`Индекс: ${p['postal-code'] || p.postalCode}`);
    if (personalLines.length) {
      addHeading('Персональные данные');
      personalLines.forEach(addParagraph);
    }

    // Опыт
    const employment = Array.isArray(cv.employment) ? cv.employment : [];
    if (employment.length) {
      addHeading('Опыт работы');
      employment.forEach(item => {
        const position = [item.position, item.company].filter(Boolean).join(' · ');
        const period = [item.start_date || item.startDate, item.current ? 'по наст. время' : (item.end_date || item.endDate)].filter(Boolean).join(' — ');
        if (position) addParagraph(position, { bold: true });
        if (period) addParagraph(period, { italics: true });
        if (item.description) addParagraph(item.description);
        children.push(new Paragraph({})); // пустая строка
      });
    }

    // Образование
    const education = Array.isArray(cv.education) ? cv.education : [];
    if (education.length) {
      addHeading('Образование');
      education.forEach(item => {
        if (item.school) addParagraph(item.school, { bold: true });
        const degree = [item.degree, item.level].filter(Boolean).join(' · ');
        if (degree) addParagraph(degree);
        const years = [item.start_year || item.startYear, item.end_year || item.endYear].filter(Boolean).join(' — ');
        if (years) addParagraph(years, { italics: true });
        children.push(new Paragraph({}));
      });
    }

    // Навыки
    const skills = Array.isArray(cv.skills) ? cv.skills : [];
    if (skills.length) {
      addHeading('Навыки');
      skills.forEach(s => addBullet(`${s.skill || ''}${s.level ? ' · ' + s.level : ''}`.trim()));
    }

    // Языки
    const languages = Array.isArray(cv.languages) ? cv.languages : [];
    if (languages.length) {
      addHeading('Языки');
      languages.forEach(l => addBullet(`${l.language || ''}${l.level ? ' · ' + l.level : ''}`.trim()));
    }

    // Дополнительные разделы
    const add = cv.additionalSections || {};
    const titleMap = {
      profile: 'Профиль', projects: 'Проекты', certificates: 'Сертификаты', courses: 'Курсы', internships: 'Стажировки',
      activities: 'Дополнительные виды деятельности', references: 'Рекомендации', qualities: 'Качества', achievements: 'Достижения',
      signature: 'Подпись', footer: 'Нижний колонтитул', assessment: 'Результаты теста', custom: 'Собственный раздел'
    };
    for (const [key, content] of Object.entries(add)) {
      if (!content) continue;
      if (key === 'custom' && Array.isArray(content)) {
        content.forEach(entry => {
          if (!entry || (!entry.title && !entry.content)) return;
          addHeading(entry.title || 'Собственный раздел');
          addParagraph(String(entry.content || ''));
        });
        continue;
      }
      addHeading(titleMap[key] || key);
      addParagraph(String(content));
    }

    const doc = new Document({ sections: [{ children }] });
    const filename = `${(cv.title || 'resume').replace(/[^\w\-]+/g, '_')}.docx`;
    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(buffer);
  } catch (error) {
    console.error('Ошибка экспорта DOCX:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Ошибка сервера при экспорте DOCX' });
    }
  }
});

// Генерация сопроводительного письма на основе данных CV и последнего теста
app.post('/api/cv/cover-letter', requireAuth, validateCv, async (req, res) => {
  try {
    const cv = req.validatedCv || {};
    const p = cv.personalInfo || {};
    const employment = Array.isArray(cv.employment) ? cv.employment : [];
    const skills = Array.isArray(cv.skills) ? cv.skills : [];
    const education = Array.isArray(cv.education) ? cv.education : [];
    const add = cv.additionalSections || {};

    const fullName = [p['given-name'] || p.givenName, p['family-name'] || p.familyName].filter(Boolean).join(' ');
    const jobTitle = p['job-position'] || p.jobPosition || 'специалист';
    const city = p.city || '';
    const contacts = [p.email, p.phone].filter(Boolean).join(' | ');

    // Последний тест (упоминаем без процентов)
    const assessment = await getLatestAssessmentResult(req.session.userId);

    const firstJob = employment[0] || {};
    const expLineParts = [];
    if (firstJob.position) expLineParts.push(firstJob.position);
    if (firstJob.company) expLineParts.push(firstJob.company);
    const expLine = expLineParts.join(' — ');

    const skillLine = skills
      .map(s => s.skill || '')
      .filter(Boolean)
      .slice(0, 8)
      .join(', ');

    const educationLine = education
      .map(e => [e.degree, e.level, e.school].filter(Boolean).join(', '))
      .filter(Boolean)[0] || '';

    const profileText = add.profile ? String(add.profile).trim() : '';

    const paragraphs = [];
    paragraphs.push('Здравствуйте!');

    const intro = fullName
      ? `Меня зовут ${fullName}. Рассматриваю роль ${jobTitle}${city ? ' в ' + city : ''}.`
      : `Рассматриваю роль ${jobTitle}${city ? ' в ' + city : ''}.`;
    paragraphs.push(intro);

    if (expLine) {
      paragraphs.push(`Ключевой опыт: ${expLine}.`);
    }

    if (skillLine) {
      paragraphs.push(`Сильные стороны: ${skillLine}.`);
    }

    if (educationLine) {
      paragraphs.push(`Образование: ${educationLine}.`);
    }

    if (profileText) {
      paragraphs.push(profileText);
    }

    if (assessment && assessment.score >= 0.65) {
      const assessBits = [];
      if (assessment.profession) assessBits.push(`по направлению ${assessment.profession}`);
      if (assessment.difficulty) assessBits.push(`уровень ${assessment.difficulty}`);
      const assessStr = assessBits.join(', ');
      paragraphs.push(`Недавно прошел(а) внутреннюю оценку ${assessStr || ''} и успешно подтвердил(а) актуальные знания.`.trim());
    }

    paragraphs.push('Буду рад(а) обсудить, как могу быть полезен(на) команде.');
    if (contacts) {
      paragraphs.push(`Связаться со мной: ${contacts}.`);
    }

    const letter = paragraphs.join('\n\n');
    res.json({ success: true, letter });
  } catch (error) {
    console.error('Ошибка генерации сопроводительного письма:', error);
    res.status(500).json({ success: false, message: 'Не удалось сгенерировать сопроводительное письмо' });
  }
});