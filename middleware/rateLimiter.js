const rateLimit = require('express-rate-limit');

// Строгий лимит для регистрации/входа
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 5, // максимум 5 попыток
    message: { error: 'Слишком много попыток входа, попробуйте через 15 минут' },
    standardHeaders: true,
    legacyHeaders: false,
    // ВАЖНО: используем реальный IP клиента
    keyGenerator: (req) => {
        // Получаем реальный IP из заголовков
        return req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress;
    },
    skip: (req) => false // Не пропускаем никого
});

// Общий лимит для всех запросов
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Слишком много запросов, попробуйте позже' },
    keyGenerator: (req) => {
        return req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress;
    }
});

// Лимит для сохранения игры
const gameSaveLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: { error: 'Слишком частое сохранение, подождите немного' },
    keyGenerator: (req) => {
        return req.headers['x-forwarded-for']?.split(',')[0] || 
               req.headers['x-real-ip'] || 
               req.connection.remoteAddress;
    }
});

module.exports = {
    generalLimiter,
    authLimiter,
    gameSaveLimiter
};