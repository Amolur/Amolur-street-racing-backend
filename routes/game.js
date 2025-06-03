const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { gameSaveLimiter } = require('../middleware/rateLimiter');

// Все игровые роуты требуют авторизации
router.use(authMiddleware);

// Кеш для таблицы лидеров
const leaderboardCache = new Map();
const CACHE_TTL = 60000; // 1 минута

// Получить данные игрока
router.get('/data', async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password').lean();
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Создаем модель для методов
        const userModel = await User.findById(req.userId);
        
        // Восстанавливаем топливо перед отправкой данных
        userModel.regenerateFuel();
        
        // Проверяем и обновляем ежедневные задания
        const tasksReset = userModel.checkAndResetDailyTasks();
        
        await userModel.save();
        
        res.json({
            username: userModel.username,
            gameData: userModel.gameData
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения данных' });
    }
});

// Оптимизированное сохранение игровых данных
router.post('/save', gameSaveLimiter, async (req, res) => {
    try {
        const { gameData } = req.body;
        
        // Используем updateOne для оптимизации
        const result = await User.updateOne(
            { _id: req.userId },
            { 
                $set: { 
                    gameData: gameData,
                    lastActivity: new Date()
                } 
            }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        res.json({ 
            success: true,
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Ошибка сохранения:', error);
        res.status(500).json({ error: 'Ошибка сохранения данных' });
    }
});

// Получить награду за ежедневное задание
router.post('/claim-daily-task', async (req, res) => {
    try {
        const { taskId } = req.body;
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const result = user.claimTaskReward(taskId);
        
        if (result.success) {
            await user.save();
            
            res.json({
                success: true,
                reward: result.reward,
                bonusReward: result.bonusReward,
                message: result.bonusReward > 0 
                    ? `Получено $${result.reward} за "${result.taskName}" + бонус $${result.bonusReward}!` 
                    : `Получено $${result.reward} за "${result.taskName}"!`,
                gameData: {
                    money: user.gameData.money,
                    dailyTasks: user.gameData.dailyTasks
                }
            });
        } else {
            res.status(400).json({ error: result.error });
        }
    } catch (error) {
        console.error('Ошибка получения награды:', error);
        res.status(500).json({ error: 'Ошибка получения награды' });
    }
});

// Обновить прогресс задания (для серверной валидации)
router.post('/update-task-progress', async (req, res) => {
    try {
        const { statType, amount = 1 } = req.body;
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const updated = user.updateTaskProgress(statType, amount);
        
        if (updated) {
            await user.save();
        }
        
        res.json({
            success: true,
            dailyTasks: user.gameData.dailyTasks
        });
    } catch (error) {
        console.error('Ошибка обновления прогресса:', error);
        res.status(500).json({ error: 'Ошибка обновления прогресса' });
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

// Оптимизированная таблица лидеров с кешированием
router.get('/leaderboard', async (req, res) => {
    try {
        const { page = 1, limit = 50 } = req.query;
        const cacheKey = `leaderboard_${page}_${limit}`;
        
        // Проверяем кеш
        const cached = leaderboardCache.get(cacheKey);
        if (cached && cached.timestamp > Date.now() - CACHE_TTL) {
            return res.json(cached.data);
        }
        
        const skip = (page - 1) * limit;
        
        // Оптимизированный запрос - выбираем только нужные поля
        const leaders = await User.find({})
            .select('username gameData.stats.wins gameData.stats.totalRaces gameData.money gameData.level gameData.experience gameData.rating')
            .sort({ 
                'gameData.level': -1, 
                'gameData.experience': -1,
                'gameData.money': -1 
            })
            .limit(parseInt(limit))
            .skip(skip)
            .lean() // lean() для быстрых read-only запросов
            .maxTimeMS(5000); // Таймаут запроса 5 секунд
        
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
            experience: user.gameData.experience,
            rating: user.gameData.rating || 1000
        }));
        
        // Кешируем результат
        leaderboardCache.set(cacheKey, {
            data: leaderboard,
            timestamp: Date.now()
        });
        
        // Очищаем старый кеш
        if (leaderboardCache.size > 20) {
            const oldestKey = leaderboardCache.keys().next().value;
            leaderboardCache.delete(oldestKey);
        }
        
        res.json(leaderboard);
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения таблицы лидеров' });
    }
});

// Получить достижения игрока
router.get('/achievements', async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('gameData.achievements').lean();
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

// Разблокировать достижение
router.post('/unlock-achievement', async (req, res) => {
    try {
        const { achievementId, name, description } = req.body;
        
        if (!achievementId || !name || !description) {
            return res.status(400).json({ error: 'Недостаточно данных для разблокировки достижения' });
        }
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Проверяем, не разблокировано ли уже
        const alreadyUnlocked = user.gameData.achievements.some(achievement => achievement.id === achievementId);
        
        if (alreadyUnlocked) {
            return res.json({ 
                success: false, 
                message: 'Достижение уже разблокировано' 
            });
        }
        
        // Добавляем достижение
        user.gameData.achievements.push({
            id: achievementId,
            name: name,
            description: description,
            unlockedAt: new Date()
        });
        
        user.gameData.lastAchievementCheck = new Date();
        
        await user.save();
        
        res.json({ 
            success: true, 
            message: 'Достижение разблокировано!',
            achievement: { 
                id: achievementId, 
                name: name, 
                description: description,
                unlockedAt: new Date()
            }
        });
        
    } catch (error) {
        console.error('Ошибка разблокировки достижения:', error);
        res.status(500).json({ error: 'Ошибка разблокировки достижения' });
    }
});

// Массовое разблокирование достижений
router.post('/unlock-achievements-batch', async (req, res) => {
    try {
        const { achievements } = req.body;
        
        if (!achievements || !Array.isArray(achievements)) {
            return res.status(400).json({ error: 'Неверный формат данных' });
        }
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        let newAchievements = [];
        
        achievements.forEach(achievement => {
            const { id, name, description } = achievement;
            
            // Проверяем, не разблокировано ли уже
            const alreadyUnlocked = user.gameData.achievements.some(a => a.id === id);
            
            if (!alreadyUnlocked && id && name && description) {
                user.gameData.achievements.push({
                    id: id,
                    name: name,
                    description: description,
                    unlockedAt: new Date()
                });
                
                newAchievements.push({
                    id: id,
                    name: name,
                    description: description
                });
            }
        });
        
        if (newAchievements.length > 0) {
            user.gameData.lastAchievementCheck = new Date();
            await user.save();
        }
        
        res.json({
            success: true,
            newAchievements: newAchievements,
            message: `Разблокировано ${newAchievements.length} новых достижений`
        });
        
    } catch (error) {
        console.error('Ошибка массового разблокирования:', error);
        res.status(500).json({ error: 'Ошибка разблокирования достижений' });
    }
});

// Обновить рейтинг игрока
router.post('/update-rating', async (req, res) => {
    try {
        const { ratingChange, reason } = req.body;
        
        if (typeof ratingChange !== 'number') {
            return res.status(400).json({ error: 'Неверный формат изменения рейтинга' });
        }
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Обновляем рейтинг
        const oldRating = user.gameData.rating || 1000;
        user.gameData.rating = Math.max(0, oldRating + ratingChange);
        
        await user.save();
        
        res.json({
            success: true,
            oldRating: oldRating,
            newRating: user.gameData.rating,
            change: ratingChange,
            reason: reason || 'Неизвестно'
        });
        
    } catch (error) {
        console.error('Ошибка обновления рейтинга:', error);
        res.status(500).json({ error: 'Ошибка обновления рейтинга' });
    }
});

// Получить расширенную статистику профиля
router.get('/profile-stats', async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password').lean();
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Вычисляем дополнительную статистику
        const winRate = user.gameData.stats.totalRaces > 0 
            ? Math.round((user.gameData.stats.wins / user.gameData.stats.totalRaces) * 100)
            : 0;
            
        const averageMoneyPerRace = user.gameData.stats.totalRaces > 0
            ? Math.round(user.gameData.stats.moneyEarned / user.gameData.stats.totalRaces)
            : 0;
            
        // Определяем ранг игрока
        const rating = user.gameData.rating || 1000;
        let rank = 'Новичок';
        let rankIcon = '🔰';
        let rankColor = '#888888';
        
        if (rating >= 2500) { 
            rank = 'Мастер'; 
            rankIcon = '👑'; 
            rankColor = '#FF4444';
        } else if (rating >= 2000) { 
            rank = 'Золото'; 
            rankIcon = '🥇'; 
            rankColor = '#FFD700';
        } else if (rating >= 1500) { 
            rank = 'Серебро'; 
            rankIcon = '🥈'; 
            rankColor = '#C0C0C0';
        } else if (rating >= 1000) { 
            rank = 'Бронза'; 
            rankIcon = '🥉'; 
            rankColor = '#CD7F32';
        }
        
        res.json({
            username: user.username,
            level: user.gameData.level,
            experience: user.gameData.experience,
            money: user.gameData.money,
            rating: rating,
            rank: {
                name: rank,
                icon: rankIcon,
                color: rankColor
            },
            stats: {
                ...user.gameData.stats,
                winRate: winRate,
                averageMoneyPerRace: averageMoneyPerRace
            },
            achievements: {
                total: user.gameData.achievements ? user.gameData.achievements.length : 0,
                list: user.gameData.achievements || []
            },
            cars: {
                owned: user.gameData.cars.length,
                current: user.gameData.currentCar
            },
            skills: user.gameData.skills,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin
        });
        
    } catch (error) {
        console.error('Ошибка получения статистики профиля:', error);
        res.status(500).json({ error: 'Ошибка получения статистики профиля' });
    }
});

// Начать гонку (с проверкой топлива)
router.post('/start-race', async (req, res) => {
    try {
        const { carIndex, fuelCost, opponentDifficulty, betAmount, won } = req.body;
        
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
        
        // Обновляем прогресс заданий
        user.updateTaskProgress('totalRaces');
        user.updateTaskProgress('fuelSpent', fuelCost);
        
        // Если результат гонки уже известен (для защиты от читов можно перенести логику на сервер)
        if (won !== undefined) {
            if (won) {
                user.updateTaskProgress('wins');
                if (betAmount) {
                    user.updateTaskProgress('moneyEarned', betAmount * 2); // Выигрыш = ставка * 2
                }
            }
        }
        
        await user.save();
        
        res.json({
            success: true,
            remainingFuel: car.fuel,
            maxFuel: car.maxFuel,
            dailyTasks: user.gameData.dailyTasks
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

// Пакетное обновление топлива
router.post('/regenerate-fuel', async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Восстанавливаем топливо для всех машин
        user.regenerateFuel();
        
        // Сохраняем только если были изменения
        if (user.isModified()) {
            await user.save();
        }
        
        res.json({
            success: true,
            cars: user.gameData.cars.map(car => ({
                id: car.id,
                fuel: car.fuel,
                maxFuel: car.maxFuel
            }))
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка обновления топлива' });
    }
});

module.exports = router;