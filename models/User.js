const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'Имя обязательно для заполнения'],
    trim: true,
    maxlength: [50, 'Имя не должно превышать 50 символов']
  },
  lastName: {
    type: String,
    required: [true, 'Фамилия обязательна для заполнения'],
    trim: true,
    maxlength: [50, 'Фамилия не должна превышать 50 символов']
  },
  email: {
    type: String,
    required: [true, 'Email обязателен для заполнения'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Пожалуйста, введите корректный email']
  },
  password: {
    type: String,
    required: [true, 'Пароль обязателен для заполнения'],
    minlength: [6, 'Пароль должен содержать минимум 6 символов'],
    select: false // Не возвращать пароль в запросах по умолчанию
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  registeredAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date
  },
  stripeCustomerId: {
    type: String,
    index: true
  },
  subscriptionStatus: {
    type: String,
    enum: ['none', 'trialing', 'active', 'past_due', 'canceled'],
    default: 'none'
  },
  currentPeriodEnd: {
    type: Date
  },
  planId: {
    type: String
  },
  priceId: {
    type: String
  },
  resumes: [{
    title: String,
    template: String,
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    data: mongoose.Schema.Types.Mixed
  }]
}, {
  timestamps: true
});

// Хеширование пароля перед сохранением
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Метод для сравнения паролей
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Метод для получения публичной информации о пользователе
userSchema.methods.getPublicProfile = function() {
  return {
    _id: this._id,
    firstName: this.firstName,
    lastName: this.lastName,
    email: this.email,
    role: this.role,
    registeredAt: this.registeredAt,
    lastLogin: this.lastLogin,
    subscriptionStatus: this.subscriptionStatus || 'none',
    planId: this.planId || null,
    priceId: this.priceId || null,
    currentPeriodEnd: this.currentPeriodEnd || null
  };
};

// Виртуальное поле для полного имени
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Индексы для оптимизации
userSchema.index({ registeredAt: -1 });

module.exports = mongoose.model('User', userSchema);