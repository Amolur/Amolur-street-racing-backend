const rateLimit = require('express-rate-limit');

// Строгий лимит для регистрации/входа
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 5, // максимум 5 попыток
    message: { error: 'Слишком много попыток входа, попробуйте через 15 минут' },
    standardHeaders: true,
    legacyHeaders: false,
    // Хранилище для production
    store: process.env.NODE_ENV === 'production' ? undefined : undefined,
    // Ключ для идентификации пользователя
    keyGenerator: (req) => {
        return req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    },
    // Обработчик при превышении лимита
    handler: (req, res) => {
        console.log('Rate limit exceeded for IP:', req.ip);
        res.status(429).json({ error: 'Слишком много попыток входа, попробуйте через 15 минут' });
    }
});

// Общий лимит для всех запросов
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { error: 'Слишком много запросов, попробуйте позже' }
});

// Лимит для сохранения игры
const gameSaveLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: { error: 'Слишком частое сохранение, подождите немного' }
});

module.exports = {
    generalLimiter,
    authLimiter,
    gameSaveLimiter
};