const express = require('express');
const router = express.Router();
const { ChatMessage, News } = require('../models/Chat');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { createLimiter } = require('../middleware/rateLimiter');

// Лимитер для чата - 10 сообщений в минуту
const chatLimiter = createLimiter(
    60 * 1000, // 1 минута
    10, // максимум 10 сообщений
    'Слишком много сообщений, подождите минуту'
);

// Получить последние сообщения чата
router.get('/messages', authMiddleware, async (req, res) => {
    try {
        const { limit = 50, before } = req.query;
        
        let query = { isDeleted: false };
        if (before) {
            query.timestamp = { $lt: new Date(before) };
        }
        
        const messages = await ChatMessage.find(query)
            .sort({ timestamp: -1 })
            .limit(parseInt(limit))
            .lean();
            
        // Переворачиваем массив, чтобы старые сообщения были первыми
        messages.reverse();
        
        res.json({ 
            success: true, 
            messages 
        });
    } catch (error) {
        console.error('Ошибка получения сообщений:', error);
        res.status(500).json({ error: 'Ошибка получения сообщений' });
    }
});

// Отправить сообщение в чат
router.post('/send', authMiddleware, chatLimiter, async (req, res) => {
    try {
        const { message } = req.body;
        
        if (!message || message.trim().length === 0) {
            return res.status(400).json({ error: 'Сообщение не может быть пустым' });
        }
        
        if (message.length > 500) {
            return res.status(400).json({ error: 'Сообщение слишком длинное (максимум 500 символов)' });
        }
        
        // Получаем данные пользователя
        const user = await User.findById(req.userId).lean();
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Создаем сообщение
        const chatMessage = new ChatMessage({
            userId: req.userId,
            username: user.username,
            message: message.trim(),
            userLevel: user.gameData.level || 1,
            userRating: user.gameData.rating || 1000
        });
        
        await chatMessage.save();
        
        res.json({ 
            success: true, 
            message: chatMessage 
        });
    } catch (error) {
        console.error('Ошибка отправки сообщения:', error);
        res.status(500).json({ error: 'Ошибка отправки сообщения' });
    }
});

// Получить активные новости
router.get('/news', async (req, res) => {
    try {
        const { limit = 10, category } = req.query;
        
        let query = { 
            isActive: true,
            $or: [
                { expiresAt: null },
                { expiresAt: { $gte: new Date() } }
            ]
        };
        
        if (category && category !== 'all') {
            query.category = category;
        }
        
        const news = await News.find(query)
            .sort({ priority: -1, createdAt: -1 })
            .limit(parseInt(limit))
            .lean();
            
        res.json({ 
            success: true, 
            news 
        });
    } catch (error) {
        console.error('Ошибка получения новостей:', error);
        res.status(500).json({ error: 'Ошибка получения новостей' });
    }
});

// Получить количество непрочитанных новостей (опционально)
router.get('/news/unread-count', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        const lastCheck = user.lastNewsCheck || new Date(0);
        
        const count = await News.countDocuments({
            isActive: true,
            createdAt: { $gt: lastCheck },
            $or: [
                { expiresAt: null },
                { expiresAt: { $gte: new Date() } }
            ]
        });
        
        res.json({ 
            success: true, 
            unreadCount: count 
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения количества новостей' });
    }
});

// Отметить новости как прочитанные
router.post('/news/mark-read', authMiddleware, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.userId, {
            lastNewsCheck: new Date()
        });
        
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка обновления статуса' });
    }
});

// Админские эндпоинты (для будущего использования)
router.post('/news/create', authMiddleware, async (req, res) => {
    try {
        // Проверка на админа (нужно добавить поле isAdmin в User модель)
        const user = await User.findById(req.userId);
        if (!user.isAdmin) {
            return res.status(403).json({ error: 'Нет прав доступа' });
        }
        
        const { title, content, category, priority, expiresIn } = req.body;
        
        const news = new News({
            title,
            content,
            category: category || 'general',
            priority: priority || 0,
            expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 3600000) : null
        });
        
        await news.save();
        
        res.json({ success: true, news });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка создания новости' });
    }
});

module.exports = router;