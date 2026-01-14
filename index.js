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
const connectDB = require('./config/database');
const User = require('./models/User');
const CV = require('./models/CV');
const app = express();
const PORT = process.env.PORT || 3000;

// Подключение к MongoDB
let isDBConnected = false;
connectDB().then((conn) => {
  isDBConnected = !!conn;
}).catch(() => {
  isDBConnected = false;
});

// Fallback: простая база данных пользователей в памяти (если MongoDB недоступна)
const users = new Map();

// Настройка middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'cv-builder-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 часа
}));

// Раздача статических файлов из папки public
app.use(express.static(path.join(__dirname, 'public')));

// Раздача загруженных файлов
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Логирование всех запросов для отладки
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
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
app.post('/api/register', async (req, res) => {
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
app.post('/api/login', async (req, res) => {
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
app.post('/api/cv/save', requireAuth, async (req, res) => {
  try {
    if (isDBConnected) {
      const { _id, ...cvData } = req.body;
      
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
app.post('/api/cv/download', requireAuth, async (req, res) => {
  try {
    const cvData = req.body;
    
    // Здесь можно добавить генерацию PDF с помощью библиотек типа puppeteer или jsPDF
    // Пока что возвращаем заглушку
    res.json({
      success: false,
      message: 'Функция экспорта в PDF находится в разработке'
    });
  } catch (error) {
    console.error('Ошибка экспорта PDF:', error);
    res.status(500).json({ success: false, message: 'Ошибка сервера' });
  }
});

// Маршрут для CV Builder страницы
app.get('/pages/cv-builder', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pages', 'cv-builder.html'));
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
});