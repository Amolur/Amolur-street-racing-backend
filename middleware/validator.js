// middleware/validator.js
// Валидация игровых данных для защиты от читов

// Проверка корректности игровых данных
function validateGameData(gameData) {
    // Базовые проверки
    if (!gameData || typeof gameData !== 'object') {
        return { valid: false, error: 'Неверный формат данных' };
    }
    
    // Проверка денег
    if (typeof gameData.money !== 'number' || gameData.money < 0) {
        return { valid: false, error: 'Неверное количество денег' };
    }
    
    // Проверка уровня
    if (typeof gameData.level !== 'number' || gameData.level < 1 || gameData.level > 100) {
        return { valid: false, error: 'Неверный уровень' };
    }
    
    // Проверка опыта
    if (typeof gameData.experience !== 'number' || gameData.experience < 0) {
        return { valid: false, error: 'Неверный опыт' };
    }
    
    // Проверка машин
    if (!Array.isArray(gameData.cars) || gameData.cars.length === 0) {
        return { valid: false, error: 'Неверные данные машин' };
    }
    
    // Проверка каждой машины
    for (const car of gameData.cars) {
        if (!car.id || typeof car.id !== 'number') {
            return { valid: false, error: 'Неверный ID машины' };
        }
        
        // Проверка характеристик машины
        const stats = ['power', 'speed', 'handling', 'acceleration'];
        for (const stat of stats) {
            if (typeof car[stat] !== 'number' || car[stat] < 0 || car[stat] > 200) {
                return { valid: false, error: `Неверная характеристика ${stat}` };
            }
        }
        
        // Проверка улучшений
        if (car.upgrades) {
            for (const upgrade in car.upgrades) {
                if (car.upgrades[upgrade] < 0 || car.upgrades[upgrade] > 10) {
                    return { valid: false, error: 'Неверный уровень улучшения' };
                }
            }
        }
        
        // Проверка топлива
        if (typeof car.fuel !== 'number' || car.fuel < 0 || car.fuel > (car.maxFuel || 30)) {
            return { valid: false, error: 'Неверное количество топлива' };
        }
    }
    
    // Проверка статистики
    if (gameData.stats) {
        if (gameData.stats.wins > gameData.stats.totalRaces) {
            return { valid: false, error: 'Побед больше чем гонок' };
        }
        
        if (gameData.stats.wins + gameData.stats.losses > gameData.stats.totalRaces) {
            return { valid: false, error: 'Неверная статистика гонок' };
        }
    }
    
    return { valid: true };
}

// Middleware для валидации сохранения
const validateSaveData = (req, res, next) => {
    const { gameData } = req.body;
    
    const validation = validateGameData(gameData);
    if (!validation.valid) {
        return res.status(400).json({ 
            error: 'Неверные игровые данные', 
            details: validation.error 
        });
    }
    
    next();
};

// Проверка изменений (античит)
function detectCheating(oldData, newData) {
    const suspiciousChanges = [];
    
    // Проверка резкого увеличения денег
    if (newData.money - oldData.money > 10000) {
        suspiciousChanges.push('Подозрительное увеличение денег');
    }
    
    // Проверка резкого увеличения уровня
    if (newData.level - oldData.level > 2) {
        suspiciousChanges.push('Подозрительное увеличение уровня');
    }
    
    // Проверка изменения статистики в обратную сторону
    if (newData.stats.totalRaces < oldData.stats.totalRaces) {
        suspiciousChanges.push('Уменьшение количества гонок');
    }
    
    // Проверка появления новых машин без траты денег
    if (newData.cars.length > oldData.cars.length) {
        const newCars = newData.cars.length - oldData.cars.length;
        const expectedCost = newCars * 3000; // минимальная цена машины
        const moneySpent = oldData.money - newData.money;
        
        if (moneySpent < expectedCost / 2) {
            suspiciousChanges.push('Появление машин без оплаты');
        }
    }
    
    return suspiciousChanges;
}

module.exports = {
    validateGameData,
    validateSaveData,
    detectCheating
};