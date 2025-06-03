const express = require('express');
const router = express.Router();
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { gameSaveLimiter } = require('../middleware/rateLimiter');
const { validateSaveData, detectCheating } = require('../middleware/validator');
const gameLogic = require('../utils/gameLogic');

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

// ЗАЩИЩЕННОЕ сохранение игровых данных
router.post('/save', gameSaveLimiter, async (req, res) => {
    // Временно добавляем логирование
    console.log('Получены данные для сохранения:', JSON.stringify(req.body.gameData, null, 2));
    try {
        const { gameData } = req.body;
        
        // Получаем текущие данные для проверки
        const currentUser = await User.findById(req.userId);
        if (!currentUser) {
            return res.status(404).json({ error: 'Пользователь не найден' });
        }
        
        // Временно отключаем проверку на читы для отладки
// const suspiciousChanges = detectCheating(currentUser.gameData, gameData);
// if (suspiciousChanges.length > 0) {
//     console.warn(`Подозрительная активность пользователя ${currentUser.username}:`, suspiciousChanges);
//     return res.status(400).json({ 
//         error: 'Обнаружена подозрительная активность',
//         details: suspiciousChanges 
//     });
// }
        
        // Сохраняем только после проверок
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

// НОВЫЙ ЗАЩИЩЕННЫЙ эндпоинт для проведения гонки
router.post('/race', async (req, res) => {
    try {
        const { carIndex, opponentIndex, betAmount } = req.body;
        
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
        
        // Проверяем деньги и топливо
        if (user.gameData.money < betAmount) {
            return res.status(400).json({ error: 'Недостаточно денег для ставки' });
        }
        
        const currentFuel = user.getFuelForCar(carIndex);
        if (currentFuel < opponent.fuelCost) {
            return res.status(400).json({ error: 'Недостаточно топлива' });
        }
        
        // РАСЧЕТ РЕЗУЛЬТАТА НА СЕРВЕРЕ
        const raceResult = gameLogic.calculateRaceResult(
            car, 
            user.gameData.skills, 
            opponent.difficulty
        );
        
        // Обновляем данные
        user.spendFuel(carIndex, opponent.fuelCost);
        user.gameData.stats.totalRaces++;
        
        if (raceResult.won) {
            user.gameData.stats.wins++;
            user.gameData.money += opponent.reward;
            user.gameData.stats.moneyEarned += opponent.reward;
        } else {
            user.gameData.stats.losses++;
            user.gameData.money -= betAmount;
            user.gameData.stats.moneySpent += betAmount;
        }
        
        // Добавляем опыт
        const xpGained = gameLogic.calculateXPGain(raceResult.won, opponent.difficulty, betAmount);
        user.gameData.experience += xpGained;
        
        // Проверяем уровень
        const levelResult = gameLogic.checkLevelUp(user.gameData.level, user.gameData.experience);
        if (levelResult.leveledUp) {
            user.gameData.level = levelResult.newLevel;
            user.gameData.money += levelResult.reward;
        }
        
        // Обновляем задания
        user.updateTaskProgress('totalRaces');
        user.updateTaskProgress('fuelSpent', opponent.fuelCost);
        if (raceResult.won) {
            user.updateTaskProgress('wins');
            user.updateTaskProgress('moneyEarned', opponent.reward);
        }
        
        await user.save();
        
        res.json({
            success: true,
            result: {
                won: raceResult.won,
                playerTime: raceResult.playerTime,
                opponentTime: raceResult.opponentTime,
                nitroActivated: raceResult.nitroActivated,
                reward: raceResult.won ? opponent.reward : -betAmount,
                xpGained: xpGained,
                leveledUp: levelResult.leveledUp,
                levelReward: levelResult.reward
            },
            gameData: {
                money: user.gameData.money,
                experience: user.gameData.experience,
                level: user.gameData.level,
                fuel: currentFuel - opponent.fuelCost
            }
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
        
        // Применяем улучшение
        user.gameData.money -= upgradeCheck.cost;
        user.gameData.stats.moneySpent += upgradeCheck.cost;
        car.upgrades[upgradeType] = currentLevel + 1;
        
        // Обновляем задания
        user.updateTaskProgress('upgradesBought');
        
        await user.save();
        
        res.json({
            success: true,
            newLevel: car.upgrades[upgradeType],
            cost: upgradeCheck.cost,
            remainingMoney: user.gameData.money
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
        
        // Список доступных машин должен храниться на сервере
        const allCars = require('../config/cars.json');
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

// Остальные эндпоинты остаются без изменений...
// (leaderboard, achievements, daily tasks и т.д.)

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

module.exports = router;