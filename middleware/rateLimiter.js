const rateLimit = require('express-rate-limit');

// Общий лимит для всех запросов
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // максимум 100 запросов
    message: 'Слишком много запросов, попробуйте позже'
});

// Строгий лимит для регистрации/входа
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 5, // максимум 5 попыток
    message: 'Слишком много попыток входа, попробуйте через 15 минут'
});

// Лимит для сохранения игры
const gameSaveLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 минута
    max: 10, // максимум 10 сохранений в минуту
    message: 'Слишком частое сохранение, подождите немного'
});

module.exports = {
    generalLimiter,
    authLimiter,
    gameSaveLimiter
};