const mongoose = require('mongoose');

// Схема для сообщений чата
const chatMessageSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    username: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true,
        maxlength: 500
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    userLevel: {
        type: Number,
        default: 1
    },
    userRating: {
        type: Number,
        default: 1000
    }
});

// Схема для новостей/объявлений
const newsSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        maxlength: 100
    },
    content: {
        type: String,
        required: true,
        maxlength: 1000
    },
    author: {
        type: String,
        default: 'Администрация'
    },
    category: {
        type: String,
        enum: ['update', 'event', 'maintenance', 'general'],
        default: 'general'
    },
    priority: {
        type: Number,
        default: 0 // Чем выше число, тем важнее новость
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    expiresAt: {
        type: Date,
        default: null
    }
});

// Индексы для оптимизации
chatMessageSchema.index({ timestamp: -1 });
chatMessageSchema.index({ userId: 1 });
newsSchema.index({ createdAt: -1 });
newsSchema.index({ isActive: 1, priority: -1 });

const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
const News = mongoose.model('News', newsSchema);

module.exports = { ChatMessage, News };