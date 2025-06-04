const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { gameSaveLimiter } = require('../middleware/rateLimiter');
const { validateSaveData, detectCheating } = require('../middleware/validator');
const gameLogic = require('../utils/gameLogic');
const eventManager = require('../utils/eventManager');

// Создаем простой логгер если securityLogger не существует
let securityLogger;
try {
    securityLogger = require('../utils/securityLogger');
} catch (error) {
    // Простой fallback логгер
    securityLogger = {
        logSuspiciousActivity: (userId, username, activity, data) => {
            console.warn(`[SECURITY] User ${username} (${userId}): ${activity}`);
        }
    };
}

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
            userId: userModel._id,
            username: userModel.username,
            gameData: userModel.gameData
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения данных' });
    }
});

// Защищенное сохранение с логированием
router.post('/save', gameSaveLimiter, validateSaveData, async (req, res) => {
    try {
        const { gameData } = req.body;
        
        const currentUser = await User.findById(req.userId);
        if (!currentUser) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Добавляем метку времени последнего сохранения
        gameData.lastSaveTimestamp = new Date();
        
        // Проверяем на читы (мягкая проверка)
        const suspiciousChanges = detectCheating(currentUser.gameData, gameData);
        if (suspiciousChanges.length > 0) {
            securityLogger.logSuspiciousActivity(
                req.userId,
                currentUser.username,
                'Подозрительные изменения при сохранении',
                {
                    changes: suspiciousChanges,
                    ip: req.ip || req.connection.remoteAddress
                }
            );
            
            if (!currentUser.suspiciousActivityCount) {
                currentUser.suspiciousActivityCount = 0;
            }
            currentUser.suspiciousActivityCount++;
            
            if (currentUser.suspiciousActivityCount > 10) {
                currentUser.flaggedForReview = true;
            }
        }
        
        // Сохраняем данные
        currentUser.gameData = gameData;
        currentUser.lastActivity = new Date();
        
        // Используем опции для оптимизации
        await currentUser.save({ 
            validateBeforeSave: false, // Пропускаем валидацию для скорости
            timestamps: true 
        });
        
        // Отправляем подтверждение с временной меткой
        res.json({ 
            success: true,
            timestamp: new Date(),
            savedAt: gameData.lastSaveTimestamp
        });
    } catch (error) {
        console.error('Ошибка сохранения:', error);
        
        // Детальная информация об ошибке в логах
        if (error.name === 'ValidationError') {
            console.error('Детали валидации:', error.errors);
        }
        
        res.status(500).json({ 
            error: 'Ошибка сохранения данных',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// НОВЫЙ ЗАЩИЩЕННЫЙ эндпоинт для проведения гонки с поддержкой типов
router.post('/race', async (req, res) => {
    try {
        const { carIndex, opponentIndex, betAmount, raceType = 'classic', fuelCost } = req.body;
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const car = user.gameData.cars[carIndex];
        if (!car) {
            return res.status(400).json({ error: 'Машина не найдена' });
        }
        
        // Генерируем соперников на сервере
        const opponents = gameLogic.generateOpponents(user.gameData.level);
        const opponent = opponents[opponentIndex];
        if (!opponent) {
            return res.status(400).json({ error: 'Соперник не найден' });
        }
        
        // Проверяем деньги
        if (user.gameData.money < betAmount) {
            return res.status(400).json({ error: 'Недостаточно денег для ставки' });
        }
        
        // Определяем модификаторы типа гонки
        const raceTypeModifiers = {
            classic: { fuelMult: 1, rewardMult: 1, xpMult: 1 },
            drift: { fuelMult: 0.8, rewardMult: 1.2, xpMult: 1.5 },
            sprint: { fuelMult: 0.5, rewardMult: 0.7, xpMult: 0.8 },
            endurance: { fuelMult: 2, rewardMult: 2, xpMult: 2.5 }
        };
        
        const modifiers = raceTypeModifiers[raceType] || raceTypeModifiers.classic;
        
        // Расчет топлива с учетом типа гонки
        const baseFuelCost = opponent.fuelCost;
        const actualFuelCost = fuelCost || Math.ceil(opponent.fuelCost * modifiers.fuelMult);
        const currentFuel = user.getFuelForCar(carIndex);
        
        if (currentFuel < actualFuelCost) {
            return res.status(400).json({ error: 'Недостаточно топлива' });
        }
        
        // РАСЧЕТ РЕЗУЛЬТАТА НА СЕРВЕРЕ с учетом типа гонки
        const raceResult = gameLogic.calculateRaceResult(
            car, 
            user.gameData.skills, 
            opponent.difficulty,
            raceType
        );
        
        // Проверяем активное событие
        const currentEvent = await eventManager.getCurrentEvent();
        let eventBonus = null;
        
        // Расчет наград с учетом типа гонки
        const baseReward = Math.floor(opponent.reward * modifiers.rewardMult);
        const originalXP = gameLogic.calculateXPGain(raceResult.won, opponent.difficulty, betAmount);
        let xpGained = Math.floor(originalXP * modifiers.xpMult);
        let finalReward = baseReward;
        
        // Применяем эффекты события
        if (currentEvent) {
            switch (currentEvent.type) {
                case 'double_rewards':
                    if (raceResult.won) {
                        finalReward = baseReward * 2;
                        eventBonus = `💰 Двойная награда! +$${finalReward - baseReward}`;
                    }
                    break;
                case 'bonus_xp':
                    xpGained = Math.floor(xpGained * 2);
                    eventBonus = `⭐ Двойной опыт! +${xpGained - Math.floor(originalXP * modifiers.xpMult)} XP`;
                    break;
                case 'free_fuel':
                    eventBonus = `⛽ Бесплатная гонка!`;
                    break;
            }
        }
        
        // Обновляем топливо с учетом события
        if (!currentEvent || currentEvent.type !== 'free_fuel') {
            user.spendFuel(carIndex, actualFuelCost);
        }
        
        // Обновляем статистику
        user.gameData.stats.totalRaces++;
        
        if (raceResult.won) {
            user.gameData.stats.wins++;
            user.gameData.money += finalReward;
            user.gameData.stats.moneyEarned += finalReward;
            
            // Специальная статистика для типов гонок
            if (!user.gameData.stats.raceTypeWins) {
                user.gameData.stats.raceTypeWins = {};
            }
            user.gameData.stats.raceTypeWins[raceType] = (user.gameData.stats.raceTypeWins[raceType] || 0) + 1;
        } else {
            user.gameData.stats.losses++;
            user.gameData.money -= betAmount;
            user.gameData.stats.moneySpent += betAmount;
        }
        
        // Добавляем опыт
        user.gameData.experience += xpGained;
        
        // Проверяем уровень
        const levelResult = gameLogic.checkLevelUp(user.gameData.level, user.gameData.experience);
        if (levelResult.leveledUp) {
            user.gameData.level = levelResult.newLevel;
            user.gameData.money += levelResult.reward;
        }
        
        // НОВАЯ СИСТЕМА ПОЛУЧЕНИЯ НАВЫКОВ НА СЕРВЕРЕ
        const skillResult = gameLogic.tryGetSkill(
            user.gameData.skills,
            raceResult.won,
            raceType,
            opponent.difficulty
        );
        
        if (skillResult.success) {
            user.gameData.skills[skillResult.skill]++;
        }
        
        // Обновляем задания
        user.updateTaskProgress('totalRaces');
        user.updateTaskProgress('fuelSpent', (!currentEvent || currentEvent.type !== 'free_fuel') ? actualFuelCost : 0);
        if (raceResult.won) {
            user.updateTaskProgress('wins');
            user.updateTaskProgress('moneyEarned', finalReward);
        }
        
        await user.save();
        
        res.json({
            success: true,
            result: {
                won: raceResult.won,
                playerTime: raceResult.playerTime,
                opponentTime: raceResult.opponentTime,
                nitroActivated: raceResult.nitroActivated,
                reward: raceResult.won ? finalReward : -betAmount,
                xpGained: xpGained,
                leveledUp: levelResult.leveledUp,
                levelReward: levelResult.reward,
                raceType: raceType
            },
            gameData: {
                money: user.gameData.money,
                experience: user.gameData.experience,
                level: user.gameData.level,
                fuel: currentFuel - ((!currentEvent || currentEvent.type !== 'free_fuel') ? actualFuelCost : 0)
            },
            eventBonus: eventBonus,
            eventActive: currentEvent ? currentEvent.type : null,
            // Добавляем информацию о навыке
            skillGained: skillResult.success ? {
                skill: skillResult.skill,
                newLevel: user.gameData.skills[skillResult.skill],
                chance: skillResult.chance
            } : null
        });
        
    } catch (error) {
        console.error('Ошибка проведения гонки:', error);
        res.status(500).json({ error: 'Ошибка проведения гонки' });
    }
});

// ЗАЩИЩЕННАЯ покупка улучшений
router.post('/upgrade', async (req, res) => {
    try {
        const { carIndex, upgradeType } = req.body;
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const car = user.gameData.cars[carIndex];
        if (!car) {
            return res.status(400).json({ error: 'Машина не найдена' });
        }
        
        const currentLevel = car.upgrades[upgradeType] || 0;
        
        // Проверяем возможность улучшения
        const upgradeCheck = gameLogic.canUpgrade(car, upgradeType, user.gameData.money, currentLevel);
        if (!upgradeCheck.canUpgrade) {
            return res.status(400).json({ error: upgradeCheck.reason });
        }
        
        // Проверяем событие скидок
        const currentEvent = await eventManager.getCurrentEvent();
        let finalCost = upgradeCheck.cost;
        let eventDiscount = false;
        
        if (currentEvent && currentEvent.type === 'upgrade_discount') {
            finalCost = Math.floor(upgradeCheck.cost * 0.5); // 50% скидка
            eventDiscount = true;
        }
        
        // Проверяем деньги с учетом скидки
        if (user.gameData.money < finalCost) {
            return res.status(400).json({ error: 'Недостаточно денег' });
        }
        
        // Применяем улучшение
        user.gameData.money -= finalCost;
        user.gameData.stats.moneySpent += finalCost;
        car.upgrades[upgradeType] = currentLevel + 1;
        
        // Обновляем задания
        user.updateTaskProgress('upgradesBought');
        
        await user.save();
        
        // Проверяем достижения типов гонок
        if (raceResult.won) {
            const newAchievements = user.checkRaceTypeAchievements();
            for (const achievement of newAchievements) {
                user.unlockAchievement(achievement.id, achievement.name, achievement.description);
            }
            if (newAchievements.length > 0) {
                await user.save();
            }
        }

        res.json({
            success: true,
            newLevel: car.upgrades[upgradeType],
            cost: finalCost,
            remainingMoney: user.gameData.money,
            eventDiscount: eventDiscount,
            originalCost: eventDiscount ? upgradeCheck.cost : null
        });
        
    } catch (error) {
        console.error('Ошибка улучшения:', error);
        res.status(500).json({ error: 'Ошибка улучшения' });
    }
});

// ЗАЩИЩЕННАЯ покупка машины
router.post('/buy-car', async (req, res) => {
    try {
        const { carId } = req.body;
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Список доступных машин
        let allCars;
        try {
            allCars = require('../config/cars.json');
        } catch (error) {
            // Если файл не существует, используем встроенный список
            allCars = [
                { id: 0, name: "Handa Civic", power: 50, speed: 60, handling: 70, acceleration: 55, price: 0 },
                { id: 1, name: "Volks Golf", power: 55, speed: 65, handling: 75, acceleration: 60, price: 3000 },
                { id: 2, name: "Toyata Corolla", power: 52, speed: 62, handling: 72, acceleration: 58, price: 3500 }
            ];
        }
        
        const carToBuy = allCars.find(c => c.id === carId);
        
        if (!carToBuy) {
            return res.status(400).json({ error: 'Машина не найдена' });
        }
        
        // Проверяем, не куплена ли уже
        if (user.gameData.cars.some(c => c.id === carId)) {
            return res.status(400).json({ error: 'Машина уже куплена' });
        }
        
        // Проверяем уровень
        const requiredLevel = gameLogic.getCarRequiredLevel(carToBuy.price);
        if (user.gameData.level < requiredLevel) {
            return res.status(400).json({ error: `Требуется ${requiredLevel} уровень` });
        }
        
        // Проверяем деньги
        if (!gameLogic.canAffordPurchase(user.gameData.money, carToBuy.price)) {
            return res.status(400).json({ error: 'Недостаточно денег' });
        }
        
        // Покупаем
        user.gameData.money -= carToBuy.price;
        user.gameData.stats.moneySpent += carToBuy.price;
        
        const newCar = {
            ...carToBuy,
            owned: true,
            fuel: 30,
            maxFuel: 30,
            lastFuelUpdate: new Date(),
            upgrades: {
                engine: 0,
                turbo: 0,
                tires: 0,
                suspension: 0,
                transmission: 0
            },
            specialParts: {
                nitro: false,
                bodyKit: false,
                ecuTune: false,
                fuelTank: false
            }
        };
        
        user.gameData.cars.push(newCar);
        
        await user.save();
        
        res.json({
            success: true,
            car: newCar,
            remainingMoney: user.gameData.money
        });
        
    } catch (error) {
        console.error('Ошибка покупки машины:', error);
        res.status(500).json({ error: 'Ошибка покупки машины' });
    }
});

// Получить список соперников (генерируется на сервере)
router.get('/opponents', async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        const opponents = gameLogic.generateOpponents(user.gameData.level);
        
        res.json({ opponents });
        
    } catch (error) {
        res.status(500).json({ error: 'Ошибка получения соперников' });
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

// Получить текущее событие
router.get('/current-event', async (req, res) => {
    try {
        const event = await eventManager.getCurrentEvent();
        
        if (!event) {
            return res.json({ 
                success: true, 
                event: null,
                message: 'Нет активных событий'
            });
        }
        
        // Рассчитываем оставшееся время
        const now = new Date();
        const timeLeft = event.endTime - now;
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutesLeft = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        
        res.json({
            success: true,
            event: {
                type: event.type,
                title: event.title,
                description: event.description,
                icon: event.icon,
                timeLeft: {
                    hours: hoursLeft,
                    minutes: minutesLeft,
                    total: timeLeft
                }
            }
        });
        
    } catch (error) {
        console.error('Ошибка получения события:', error);
        res.status(500).json({ error: 'Ошибка получения события' });
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

// Экстренное сохранение (для критических операций)
router.post('/emergency-save', authMiddleware, async (req, res) => {
    try {
        const { gameData } = req.body;
        
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Простое сохранение без проверок для скорости
        user.gameData = gameData;
        user.lastActivity = new Date();
        user.lastEmergencySave = new Date();
        
        await user.save({ validateBeforeSave: false });
        
        res.json({ 
            success: true,
            message: 'Экстренное сохранение выполнено'
        });
    } catch (error) {
        console.error('Ошибка экстренного сохранения:', error);
        res.status(500).json({ error: 'Критическая ошибка сохранения' });
    }
});

module.exports = router;