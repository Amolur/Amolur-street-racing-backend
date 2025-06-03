const rateLimit = require('express-rate-limit');

// Более гибкие настройки для разных типов запросов
const createLimiter = (windowMs, max, message, skipCondition = null) => {
    return rateLimit({
        windowMs,
        max,
        message: { error: message },
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: (req) => {
            // Получаем реальный IP из заголовков
            return req.headers['x-forwarded-for']?.split(',')[0] || 
                   req.headers['x-real-ip'] || 
                   req.connection.remoteAddress;
        },
        skip: (req) => {
            // Пропускаем проверку для локальной разработки
            const ip = req.ip || req.connection.remoteAddress;
            const isLocal = ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
            
            // Применяем дополнительное условие пропуска, если оно есть
            if (skipCondition && typeof skipCondition === 'function') {
                return isLocal || skipCondition(req);
            }
            
            return isLocal;
        },
        handler: (req, res) => {
            // Логируем превышение лимита
            console.warn(`Rate limit exceeded for IP: ${req.ip}, Path: ${req.path}`);
            res.status(429).json({ error: message });
        }
    });
};

// Строгий лимит для регистрации/входа
const authLimiter = createLimiter(
    15 * 60 * 1000, // 15 минут
    5, // максимум 5 попыток
    'Слишком много попыток входа, попробуйте через 15 минут'
);

// Общий лимит для всех запросов
const generalLimiter = createLimiter(
    15 * 60 * 1000, // 15 минут
    200, // увеличен до 200 запросов
    'Слишком много запросов, попробуйте позже'
);

// Лимит для сохранения игры (более мягкий)
const gameSaveLimiter = createLimiter(
    1 * 60 * 1000, // 1 минута
    20, // увеличен до 20 запросов в минуту
    'Слишком частое сохранение, подождите немного',
    (req) => {
        // Пропускаем ограничение для автосохранения
        return req.body && req.body.autoSave === true;
    }
);

// Лимит для игровых действий (гонки, покупки)
const gameActionLimiter = createLimiter(
    5 * 60 * 1000, // 5 минут
    30, // 30 действий за 5 минут
    'Слишком много игровых действий, подождите немного'
);

// Лимит для получения данных
const dataFetchLimiter = createLimiter(
    1 * 60 * 1000, // 1 минута
    60, // 60 запросов в минуту
    'Слишком частые запросы данных'
);

// Динамический лимитер на основе роли пользователя
const createDynamicLimiter = (baseMax = 100) => {
    return (req, res, next) => {
        // Можно настроить разные лимиты для разных пользователей
        let maxRequests = baseMax;
        
        // Например, для премиум пользователей можно увеличить лимит
        if (req.user && req.user.isPremium) {
            maxRequests = baseMax * 2;
        }
        
        const limiter = createLimiter(
            15 * 60 * 1000,
            maxRequests,
            'Превышен лимит запросов'
        );
        
        return limiter(req, res, next);
    };
};

module.exports = {
    generalLimiter,
    authLimiter,
    gameSaveLimiter,
    gameActionLimiter,
    dataFetchLimiter,
    createDynamicLimiter,
    createLimiter // Экспортируем для создания кастомных лимитеров
};