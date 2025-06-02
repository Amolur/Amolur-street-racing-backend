const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { gameSaveLimiter } = require('../middleware/rateLimiter');

// Все игровые роуты требуют авторизации
router.use(authMiddleware);

// Получить данные игрока
router.get('/data', async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Восстанавливаем топливо перед отправкой данных
        user.regenerateFuel();
        await user.save();
        
        res.json({
            username: user.username,
            gameData: user.gameData
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения данных' });
    }
});

// Сохранить игровые данные
router.post('/save', gameSaveLimiter, async (req, res) => {
    try {
        const { gameData } = req.body;
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Проверяем повышение уровня на сервере для защиты от читеров
        if (gameData.experience !== undefined) {
            user.gameData.experience = gameData.experience;
            const levelUpResult = user.checkLevelUp();
            
            if (levelUpResult.levelsGained > 0) {
                console.log(`Игрок ${user.username} повысил уровень до ${user.gameData.level}`);
            }
        }
        
        // Обновляем остальные данные
        Object.keys(gameData).forEach(key => {
            if (key !== 'experience' && key !== 'level' && key !== 'money') {
                user.gameData[key] = gameData[key];
            }
        });
        
        // Для денег и уровня делаем дополнительные проверки
        if (gameData.money !== undefined && gameData.money >= 0) {
            user.gameData.money = gameData.money;
        }
        
        await user.save();
        
        res.json({ 
            success: true,
            gameData: user.gameData 
        });
    } catch (error) {
        console.error('Ошибка сохранения:', error);
        res.status(500).json({ error: 'Ошибка сохранения данных' });
    }
});

// Добавить опыт (защищенный эндпоинт для начисления опыта после гонки)
router.post('/add-experience', async (req, res) => {
    try {
        const { amount, source } = req.body;
        
        if (!amount || amount < 0) {
            return res.status(400).json({ error: 'Неверное количество опыта' });
        }
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const oldLevel = user.gameData.level;
        user.gameData.experience += amount;
        
        const levelUpResult = user.checkLevelUp();
        
        await user.save();
        
        res.json({
            success: true,
            experience: user.gameData.experience,
            level: user.gameData.level,
            leveledUp: levelUpResult.levelsGained > 0,
            reward: levelUpResult.totalReward
        });
        
    } catch (error) {
        console.error('Ошибка добавления опыта:', error);
        res.status(500).json({ error: 'Ошибка добавления опыта' });
    }
});

// Таблица лидеров
router.get('/leaderboard', async (req, res) => {
    try {
        const { page = 1, limit = 50 } = req.query;
        const skip = (page - 1) * limit;
        
        const leaders = await User.find({})
            .select('username gameData.stats.wins gameData.stats.totalRaces gameData.money gameData.level gameData.experience')
            .sort({ 
                'gameData.level': -1, 
                'gameData.experience': -1,
                'gameData.money': -1 
            })
            .limit(parseInt(limit))
            .skip(skip);
        
        const leaderboard = leaders.map((user, index) => ({
            position: skip + index + 1,
            username: user.username,
            wins: user.gameData.stats.wins,
            totalRaces: user.gameData.stats.totalRaces,
            winRate: user.gameData.stats.totalRaces > 0 
                ? ((user.gameData.stats.wins / user.gameData.stats.totalRaces) * 100).toFixed(1)
                : 0,
            money: user.gameData.money,
            level: user.gameData.level,
            experience: user.gameData.experience
        }));
        
        res.json(leaderboard);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения таблицы лидеров' });
    }
});

// Получить достижения игрока
router.get('/achievements', async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        res.json({
            achievements: user.gameData.achievements || [],
            total: user.gameData.achievements ? user.gameData.achievements.length : 0
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения достижений' });
    }
});

// Проверить и разблокировать достижение
router.post('/unlock-achievement', async (req, res) => {
    try {
        const { achievementId, name, description } = req.body;
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const unlocked = user.unlockAchievement(achievementId, name, description);
        
        if (unlocked) {
            await user.save();
            res.json({ 
                success: true, 
                message: 'Достижение разблокировано!',
                achievement: { achievementId, name, description }
            });
        } else {
            res.json({ 
                success: false, 
                message: 'Достижение уже разблокировано' 
            });
        }
        
    } catch (error) {
        res.status(500).json({ error: 'Ошибка разблокировки достижения' });
    }
});

// Начать гонку (с проверкой топлива)
router.post('/start-race', async (req, res) => {
    try {
        const { carIndex, fuelCost } = req.body;
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Восстанавливаем топливо
        user.regenerateFuel();
        
        // Проверяем достаточно ли топлива
        const car = user.gameData.cars[carIndex];
        if (!car) {
            return res.status(400).json({ error: 'Машина не найдена' });
        }
        
        if (car.fuel < fuelCost) {
            const regenTime = user.getFuelRegenTime(carIndex);
            return res.status(400).json({ 
                error: 'Недостаточно топлива',
                currentFuel: car.fuel,
                requiredFuel: fuelCost,
                regenTimeMinutes: regenTime
            });
        }
        
        // Тратим топливо
        const success = user.spendFuel(carIndex, fuelCost);
        if (!success) {
            return res.status(400).json({ error: 'Не удалось потратить топливо' });
        }
        
        await user.save();
        
        res.json({
            success: true,
            remainingFuel: car.fuel,
            maxFuel: car.maxFuel
        });
        
    } catch (error) {
        console.error('Ошибка старта гонки:', error);
        res.status(500).json({ error: 'Ошибка старта гонки' });
    }
});

// Получить статус топлива для всех машин
router.get('/fuel-status', async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Восстанавливаем топливо
        user.regenerateFuel();
        await user.save();
        
        const fuelStatus = user.gameData.cars.map((car, index) => ({
            carId: car.id,
            carName: car.name,
            fuel: car.fuel,
            maxFuel: car.maxFuel,
            regenTimeMinutes: user.getFuelRegenTime(index)
        }));
        
        res.json({ fuelStatus });
        
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения статуса топлива' });
    }
});

module.exports = router;