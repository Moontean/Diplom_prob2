const mongoose = require('mongoose');

const BreakdownSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, required: true },
  correct: { type: Boolean, default: null },
  score: { type: Number, default: null },
  reasoning: { type: String, default: '' }
}, { _id: false });

const AnswerSchema = new mongoose.Schema({
  id: { type: String, required: true },
  answer: { type: mongoose.Schema.Types.Mixed, required: true }, // индекс для mcq или текст для open
  score: { type: Number, default: null },
  feedback: { type: String, default: '' }
}, { _id: false });

const SubmissionSchema = new mongoose.Schema({
  answers: [AnswerSchema],
  totalScore: { type: Number, required: true },
  breakdown: [BreakdownSchema],
  evaluatedAt: { type: Date, default: Date.now }
}, { _id: false });

const QuestionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, enum: ['mcq', 'open'], required: true },
  prompt: { type: String, required: true },
  options: [{ type: String }],
  correctIndex: { type: Number },
  explanation: { type: String },
  rubric: {
    keyPoints: [{ type: String }],
    scoring: { type: String }
  }
}, { _id: false });

const AssessmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  profession: { type: String, required: true },
  difficulty: { type: String, enum: ['junior', 'middle', 'senior'], default: 'junior' },
  numQuestions: { type: Number, default: 10 },
  questions: [QuestionSchema],
  // Ключи ответов для MCQ отдельно, чтобы не отдавать на клиент
  answerKey: [{ id: String, correctIndex: Number }],
  submissions: [SubmissionSchema],
  createdAt: { type: Date, default: Date.now }
});

AssessmentSchema.statics.findByUserId = function(userId) {
  return this.find({ userId }).sort({ createdAt: -1 });
};

module.exports = mongoose.models.Assessment || mongoose.model('Assessment', AssessmentSchema);
