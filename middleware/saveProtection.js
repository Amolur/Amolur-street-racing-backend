// middleware/saveProtection.js
// Защита от потери данных при сохранении

const saveProtection = (req, res, next) => {
    // Добавляем заголовки для предотвращения кеширования
    res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    });
    
    // Увеличиваем таймаут для сохранений
    if (req.path.includes('/save')) {
        req.setTimeout(30000); // 30 секунд для сохранения
    }
    
    next();
};

module.exports = saveProtection;