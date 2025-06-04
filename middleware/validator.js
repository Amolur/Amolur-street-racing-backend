// middleware/validator.js
// Валидация игровых данных для защиты от читов

// Проверка корректности игровых данных
function validateGameData(gameData) {
    // Базовые проверки
    if (!gameData || typeof gameData !== 'object') {
        return { valid: false, error: 'Неверный формат данных' };
    }
    
    // Проверка денег
    if (typeof gameData.money !== 'number' || gameData.money < 0 || isNaN(gameData.money)) {
        return { valid: false, error: 'Неверное количество денег' };
    }
    
    // Проверка уровня
    if (typeof gameData.level !== 'number' || gameData.level < 1 || gameData.level > 100 || isNaN(gameData.level)) {
        return { valid: false, error: 'Неверный уровень' };
    }
    
    // Проверка опыта - может быть undefined для новых игроков
    if (gameData.experience !== undefined) {
        if (typeof gameData.experience !== 'number' || gameData.experience < 0 || isNaN(gameData.experience)) {
            return { valid: false, error: 'Неверный опыт' };
        }
    }
    
    // Проверка текущей машины
    if (gameData.currentCar !== undefined) {
        if (typeof gameData.currentCar !== 'number' || gameData.currentCar < 0) {
            return { valid: false, error: 'Неверный индекс текущей машины' };
        }
    }
    
    // Проверка машин
    if (!Array.isArray(gameData.cars) || gameData.cars.length === 0) {
        return { valid: false, error: 'Неверные данные машин' };
    }
    
    // Проверка каждой машины
    for (let i = 0; i < gameData.cars.length; i++) {
        const car = gameData.cars[i];
        
        if (!car || typeof car !== 'object') {
            return { valid: false, error: `Неверные данные машины ${i}` };
        }
        
        // ID может быть number или undefined для старых данных
        if (car.id !== undefined && typeof car.id !== 'number') {
            return { valid: false, error: 'Неверный ID машины' };
        }
        
        // Проверка характеристик машины
        const stats = ['power', 'speed', 'handling', 'acceleration'];
        for (const stat of stats) {
            if (car[stat] !== undefined) {
                if (typeof car[stat] !== 'number' || car[stat] < 0 || car[stat] > 200 || isNaN(car[stat])) {
                    return { valid: false, error: `Неверная характеристика ${stat} у машины ${car.name || i}` };
                }
            }
        }
        
        // Проверка улучшений (может отсутствовать)
        if (car.upgrades && typeof car.upgrades === 'object') {
            for (const upgrade in car.upgrades) {
                const level = car.upgrades[upgrade];
                if (typeof level !== 'number' || level < 0 || level > 10 || isNaN(level)) {
                    return { valid: false, error: `Неверный уровень улучшения ${upgrade}` };
                }
            }
        }
        // Проверка на слишком быстрое изменение денег
if (newData.money - oldData.money > 100000 && 
    (Date.now() - oldData.lastSaveTimestamp) < 60000) {
    return ['Подозрительно быстрое увеличение денег'];
}

// Проверка на невозможные характеристики машин
for (const car of newData.cars) {
    if (car.power > 200 || car.speed > 200 || 
        car.handling > 200 || car.acceleration > 200) {
        return ['Характеристики машины превышают максимум'];
    }
}
        // Проверка топлива (может отсутствовать)
        if (car.fuel !== undefined) {
            const maxFuel = car.maxFuel || 30;
            if (typeof car.fuel !== 'number' || car.fuel < 0 || car.fuel > maxFuel || isNaN(car.fuel)) {
                return { valid: false, error: 'Неверное количество топлива' };
            }
        }
        
        // Проверка специальных частей (может отсутствовать)
        if (car.specialParts && typeof car.specialParts === 'object') {
            for (const part in car.specialParts) {
                if (typeof car.specialParts[part] !== 'boolean') {
                    return { valid: false, error: `Неверное значение специальной части ${part}` };
                }
            }
        }
    }
    
    // Проверка навыков (может отсутствовать)
if (gameData.skills && typeof gameData.skills === 'object') {
    const skills = ['driving', 'speed', 'reaction', 'technique'];
    for (const skill of skills) {
        if (gameData.skills[skill] !== undefined) {
            const level = gameData.skills[skill];
            // Убираем ограничение на максимальный уровень
            if (typeof level !== 'number' || level < 1 || isNaN(level)) {
                return { valid: false, error: `Неверный уровень навыка ${skill}` };
            }
        }
    }
}
    
    // Проверка статистики (может отсутствовать)
    if (gameData.stats && typeof gameData.stats === 'object') {
        const stats = gameData.stats;
        
        // Проверка чисел
        const numericStats = ['totalRaces', 'wins', 'losses', 'moneyEarned', 'moneySpent'];
        for (const stat of numericStats) {
            if (stats[stat] !== undefined) {
                if (typeof stats[stat] !== 'number' || stats[stat] < 0 || isNaN(stats[stat])) {
                    return { valid: false, error: `Неверное значение статистики ${stat}` };
                }
            }
        }
        
        // Логические проверки
        if (stats.wins !== undefined && stats.totalRaces !== undefined) {
            if (stats.wins > stats.totalRaces) {
                return { valid: false, error: 'Побед больше чем гонок' };
            }
        }
        
        if (stats.wins !== undefined && stats.losses !== undefined && stats.totalRaces !== undefined) {
            if (stats.wins + stats.losses > stats.totalRaces) {
                return { valid: false, error: 'Сумма побед и поражений больше общего количества гонок' };
            }
        }
    }
    
    // Проверка ежедневных заданий (может отсутствовать)
    if (gameData.dailyTasks && typeof gameData.dailyTasks === 'object') {
        if (gameData.dailyTasks.tasks && !Array.isArray(gameData.dailyTasks.tasks)) {
            return { valid: false, error: 'Неверный формат ежедневных заданий' };
        }
    }
    
    // Проверка достижений (может отсутствовать)
    if (gameData.achievements !== undefined) {
        if (!Array.isArray(gameData.achievements)) {
            return { valid: false, error: 'Неверный формат достижений' };
        }
    }
    
    return { valid: true };
}

// Middleware для валидации сохранения
const validateSaveData = (req, res, next) => {
    const { gameData } = req.body;
    
    if (!gameData) {
        return res.status(400).json({ 
            error: 'Отсутствуют игровые данные' 
        });
    }
    
    const validation = validateGameData(gameData);
    if (!validation.valid) {
        console.error('Ошибка валидации:', validation.error);
        console.error('Данные:', JSON.stringify(gameData, null, 2));
        
        return res.status(400).json({ 
            error: 'Неверные игровые данные', 
            details: validation.error 
        });
    }
    
    next();
};

// Проверка изменений (античит) - ОЧЕНЬ мягкая версия для автосохранения
// Проверка изменений с учетом игровой логики
function detectCheating(oldData, newData) {
    const suspiciousChanges = [];
    
    // Пропускаем проверку для новых игроков
    if (!oldData || !oldData.stats || !newData || !newData.stats) {
        return [];
    }
    
    // 1. Деньги не могут увеличиться больше чем на максимальную награду за гонку
    const maxRaceReward = 50000; // Максимальная награда в игре
    const moneyIncrease = newData.money - oldData.money;
    if (moneyIncrease > maxRaceReward * 30) { // 30 гонок подряд
        suspiciousChanges.push(`Слишком быстрое увеличение денег: +${moneyIncrease}`);
    }
    
    // 2. Уровень не может увеличиться больше чем на 1 за сохранение
    if (newData.level - oldData.level > 3) {
        suspiciousChanges.push(`Подозрительное увеличение уровня: ${oldData.level} -> ${newData.level}`);
    }
    
    // 3. Статистика должна только увеличиваться
    if (newData.stats.totalRaces < oldData.stats.totalRaces ||
        newData.stats.wins < oldData.stats.wins) {
        suspiciousChanges.push('Откат статистики');
    }
    
    // 4. Проверка логики побед
    const newWinRate = newData.stats.wins / newData.stats.totalRaces;
    if (newWinRate > 0.95 && newData.stats.totalRaces > 20) {
        suspiciousChanges.push('Подозрительно высокий процент побед');
    }
    
    return suspiciousChanges;
}

module.exports = {
    validateGameData,
    validateSaveData,
    detectCheating
};