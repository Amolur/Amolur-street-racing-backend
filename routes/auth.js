const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authLimiter } = require('../middleware/rateLimiter');

    router.get('/test-limit', authLimiter, (req, res) => {
    res.json({ message: 'Test successful', ip: req.ip });
    });
// Регистрация
    router.post('/register', authLimiter, async (req, res) => {
    console.log('Register attempt from IP:', req.ip); // Добавим лог
    try {
        const { username, password } = req.body;
        
        // Валидация
        if (!username || !password) {
            return res.status(400).json({ error: 'Введите логин и пароль' });
        }
        
        if (username.length < 3) {
            return res.status(400).json({ error: 'Логин должен быть не менее 3 символов' });
        }
        
        // Проверка существования пользователя
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ error: 'Этот логин уже занят' });
        }
        
        // Хеширование пароля
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Создание пользователя
        const user = new User({
            username,
            password: hashedPassword
        });
        
        await user.save();
        
        // Создание токена
        const token = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                gameData: user.gameData
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка при регистрации' });
    }
});

// Вход
    router.post('/login', authLimiter, async (req, res) => {
    // Логируем реальный IP
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0] || 
                     req.headers['x-real-ip'] || 
                     req.ip;
    console.log('Login attempt from real IP:', clientIP);
    
    try {
        const { username, password } = req.body;
        
        // Поиск пользователя
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ error: 'Неверный логин или пароль' });
        }
        
        // Проверка пароля
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(400).json({ error: 'Неверный логин или пароль' });
        }
        
        // Обновление времени последнего входа
        user.lastLogin = new Date();
        await user.save();
        
        // Создание токена
        const token = jwt.sign(
            { userId: user._id },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );
        
        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                gameData: user.gameData
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Ошибка при входе' });
    }
});

module.exports = router;