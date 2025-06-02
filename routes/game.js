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
        
        // Проверяем и обновляем ежедневные задания
        const tasksReset = user.checkAndResetDailyTasks();
        if (tasksReset) {
            console.log(`Ежедневные задания сброшены для пользователя ${user.username}`);
        }
        
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
        
        // Проверяем и обновляем ежедневные задания
        user.checkAndResetDailyTasks();
        
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
        
        // Обновляем прогресс ежедневных заданий если они изменились
        if (gameData.dailyTasks) {
            user.gameData.dailyTasks = gameData.dailyTasks;
        }
        if (gameData.dailyStats) {
            user.gameData.dailyStats = gameData.dailyStats;
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

// НОВОЕ: Получить награду за ежедневное задание
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

// НОВОЕ: Обновить прогресс задания (для серверной валидации)
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
        
        // НОВОЕ: Обновляем прогресс заданий
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
            dailyTasks: user.gameData.dailyTasks // Возвращаем обновленные задания
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

router.get('/tasks-reset-time', async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const timeLeft = user.getTimeUntilTasksReset();
        
        res.json({
            timeLeft: timeLeft,
            expiresAt: user.gameData.dailyTasks?.expiresAt
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения времени' });
    }
});
module.exports = router;
