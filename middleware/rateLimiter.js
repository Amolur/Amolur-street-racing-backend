const rateLimit = require('express-rate-limit');

// Общий лимит для всех запросов
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // максимум 100 запросов
    message: 'Слишком много запросов, попробуйте позже',
    standardHeaders: true,
    legacyHeaders: false,
    // Важно для Render!
    skip: (req) => {
        return req.ip === '::1' || req.ip === '127.0.0.1';
    }
});

// Строгий лимит для регистрации/входа
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 5, // максимум 5 попыток
    message: 'Слишком много попыток входа, попробуйте через 15 минут',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Не считать успешные попытки
    // Важно для Render!
    skip: (req) => {
        return req.ip === '::1' || req.ip === '127.0.0.1';
    }
});

// Лимит для сохранения игры
const gameSaveLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 минута
    max: 10, // максимум 10 сохранений в минуту
    message: 'Слишком частое сохранение, подождите немного',
    standardHeaders: true,
    legacyHeaders: false,
    // Важно для Render!
    skip: (req) => {
        return req.ip === '::1' || req.ip === '127.0.0.1';
    }
});

module.exports = {
    generalLimiter,
    authLimiter,
    gameSaveLimiter
};