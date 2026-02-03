const mongoose = require('mongoose');

const PersonalInfoSchema = new mongoose.Schema({
    givenName: { type: String, maxlength: 100 },
    familyName: { type: String, maxlength: 100 },
    jobPosition: { type: String, maxlength: 100 },
    email: { type: String, maxlength: 100 },
    phone: { type: String, maxlength: 20 },
    address: { type: String, maxlength: 200 },
    postalCode: { type: String, maxlength: 10 },
    city: { type: String, maxlength: 100 },
    birthdate: { type: Date },
    website: { type: String, maxlength: 200 },
    linkedin: { type: String, maxlength: 200 },
    photo: { type: String } // base64 encoded image or file path
}, { _id: false });

const EmploymentSchema = new mongoose.Schema({
    position: { type: String, required: true, maxlength: 100 },
    company: { type: String, required: true, maxlength: 100 },
    startDate: { type: String, required: true }, // YYYY-MM format
    endDate: { type: String }, // YYYY-MM format, can be null if current
    current: { type: Boolean, default: false },
    description: { type: String, maxlength: 1000 },
    order: { type: Number, default: 0 }
}, { _id: false });

const EducationSchema = new mongoose.Schema({
    school: { type: String, required: true, maxlength: 200 },
    degree: { type: String, required: true, maxlength: 100 },
    level: { 
        type: String, 
        enum: ['bachelor', 'master', 'phd', 'specialist', 'other'],
        maxlength: 50 
    },
    startYear: { type: Number, min: 1950, max: 2030 },
    endYear: { type: Number, min: 1950, max: 2030 },
    order: { type: Number, default: 0 }
}, { _id: false });

const SkillSchema = new mongoose.Schema({
    skill: { type: String, required: true, maxlength: 100 },
    level: { 
        type: String, 
        enum: ['beginner', 'intermediate', 'advanced', 'expert'],
        required: true 
    },
    order: { type: Number, default: 0 }
}, { _id: false });

const LanguageSchema = new mongoose.Schema({
    language: { type: String, required: true, maxlength: 100 },
    level: { 
        type: String, 
        enum: ['a1', 'a2', 'b1', 'b2', 'c1', 'c2', 'native'],
        required: true 
    },
    order: { type: Number, default: 0 }
}, { _id: false });

const ProjectSchema = new mongoose.Schema({
    name: { type: String, required: true, maxlength: 100 },
    description: { type: String, maxlength: 1000 },
    technologies: [{ type: String, maxlength: 50 }],
    url: { type: String, maxlength: 200 },
    startDate: { type: String }, // YYYY-MM format
    endDate: { type: String }, // YYYY-MM format
    order: { type: Number, default: 0 }
}, { _id: false });

const CertificateSchema = new mongoose.Schema({
    name: { type: String, required: true, maxlength: 100 },
    issuer: { type: String, required: true, maxlength: 100 },
    issueDate: { type: String }, // YYYY-MM format
    expirationDate: { type: String }, // YYYY-MM format
    credentialId: { type: String, maxlength: 100 },
    credentialUrl: { type: String, maxlength: 200 },
    order: { type: Number, default: 0 }
}, { _id: false });

const CVSchema = new mongoose.Schema({
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true
    },
    title: { 
        type: String, 
        default: 'Моё резюме',
        maxlength: 100
    },
    personalInfo: PersonalInfoSchema,
    employment: [EmploymentSchema],
    education: [EducationSchema],
    skills: [SkillSchema],
    languages: [LanguageSchema],
    projects: [ProjectSchema],
    certificates: [CertificateSchema],
    additionalSections: {
        profile: { type: String, maxlength: 2000 }, // Профиль/О себе
        hobbies: { type: String, maxlength: 1000 }, // Хобби
        references: { type: String, maxlength: 1000 }, // Рекомендации
        custom: [{
            title: { type: String, maxlength: 100 },
            content: { type: String, maxlength: 2000 },
            order: { type: Number, default: 0 }
        }]
    },
    template: {
        type: String,
        enum: ['modern', 'classic', 'creative', 'minimal', 'european', 'europass'],
        default: 'modern'
    },
    settings: {
        fontSize: { type: String, default: 'medium' },
        colorScheme: { type: String, default: 'blue' },
        includePhoto: { type: Boolean, default: true },
        sectionOrder: [{
            section: { type: String },
            order: { type: Number }
        }]
    },
    isPublic: { type: Boolean, default: false },
    isTemplate: { type: Boolean, default: false }
}, {
    timestamps: true
});

// Индексы для оптимизации запросов
CVSchema.index({ userId: 1, updatedAt: -1 });
CVSchema.index({ isTemplate: 1 });
CVSchema.index({ isPublic: 1 });

// Виртуальное поле для полного имени
CVSchema.virtual('personalInfo.fullName').get(function() {
    if (this.personalInfo && this.personalInfo.givenName && this.personalInfo.familyName) {
        return `${this.personalInfo.givenName} ${this.personalInfo.familyName}`;
    }
    return '';
});

// Методы схемы
CVSchema.methods.getPublicProfile = function() {
    return {
        _id: this._id,
        title: this.title,
        personalInfo: {
            fullName: this.personalInfo?.fullName || '',
            jobPosition: this.personalInfo?.jobPosition || '',
            city: this.personalInfo?.city || ''
        },
        template: this.template,
        updatedAt: this.updatedAt
    };
};

CVSchema.methods.toPublicJSON = function() {
    const cv = this.toObject();
    delete cv.userId;
    return cv;
};

// Статические методы
CVSchema.statics.findByUserId = function(userId, options = {}) {
    const query = { userId };
    if (options.isTemplate !== undefined) {
        query.isTemplate = options.isTemplate;
    }
    return this.find(query).sort({ updatedAt: -1 });
};

CVSchema.statics.findTemplates = function(limit = 10) {
    return this.find({ isTemplate: true })
               .select('title personalInfo.jobPosition template updatedAt')
               .sort({ updatedAt: -1 })
               .limit(limit);
};

CVSchema.statics.findPublicCVs = function(limit = 10) {
    return this.find({ isPublic: true })
               .select('title personalInfo template updatedAt')
               .sort({ updatedAt: -1 })
               .limit(limit);
};

// Middleware для валидации
CVSchema.pre('save', function(next) {
    // Валидация email
    if (this.personalInfo && this.personalInfo.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(this.personalInfo.email)) {
            return next(new Error('Неверный формат email адреса'));
        }
    }

    // Валидация URL
    const urlFields = ['personalInfo.website', 'personalInfo.linkedin'];
    urlFields.forEach(field => {
        const value = this.get(field);
        if (value) {
            try {
                new URL(value);
            } catch (error) {
                return next(new Error(`Неверный формат URL в поле ${field}`));
            }
        }
    });

    // Валидация дат в образовании
    if (this.education) {
        this.education.forEach(edu => {
            if (edu.startYear && edu.endYear && edu.startYear > edu.endYear) {
                return next(new Error('Год начала обучения не может быть больше года окончания'));
            }
        });
    }

    // Автоматическая сортировка массивов по полю order
    const arrayFields = ['employment', 'education', 'skills', 'languages', 'projects', 'certificates'];
    arrayFields.forEach(field => {
        if (this[field] && Array.isArray(this[field])) {
            this[field].sort((a, b) => (a.order || 0) - (b.order || 0));
        }
    });

    next();
});

// Middleware для обновления даты изменения при сохранении
CVSchema.pre('save', function(next) {
    if (this.isModified() && !this.isNew) {
        this.updatedAt = new Date();
    }
    next();
});

const CV = mongoose.model('CV', CVSchema);

module.exports = CV;