// utils/gameLogic.js
// Серверная игровая логика для защиты от читов

// Расчет результата гонки на сервере
function calculateRaceResult(playerCar, playerSkills, opponentDifficulty) {
    // Базовые характеристики машины
    let carPower = (playerCar.power + playerCar.speed + 
                    playerCar.handling + playerCar.acceleration) / 4;
    
    // Применяем улучшения
    if (playerCar.upgrades) {
        const upgradeBonus = Object.values(playerCar.upgrades).reduce((sum, level) => sum + level, 0) * 2;
        carPower += upgradeBonus;
    }
    
    // Бонус от навыков
    const skillMultiplier = 1 + (
        (playerSkills.driving || 1) * 0.002 +
        (playerSkills.speed || 1) * 0.002 +
        (playerSkills.reaction || 1) * 0.0015 +
        (playerSkills.technique || 1) * 0.0015
    );
    
    let playerEfficiency = carPower * skillMultiplier;
    
    // Проверяем нитро (30% шанс)
    let nitroActivated = false;
    if (playerCar.specialParts && playerCar.specialParts.nitro && Math.random() < 0.3) {
        playerEfficiency *= 1.2;
        nitroActivated = true;
    }
    
    // Эффективность соперника
    const opponentEfficiency = 60 * opponentDifficulty;
    
    // Расчет времени с элементом случайности
    const trackBaseTime = 60;
    const playerRandomFactor = 0.95 + Math.random() * 0.1;
    const opponentRandomFactor = 0.95 + Math.random() * 0.1;
    
    const playerTime = trackBaseTime * (100 / playerEfficiency) * playerRandomFactor;
    const opponentTime = trackBaseTime * (100 / opponentEfficiency) * opponentRandomFactor;
    
    const won = playerTime < opponentTime;
    
    return {
        won,
        playerTime,
        opponentTime,
        nitroActivated
    };
}

// Расчет получения опыта
function calculateXPGain(won, opponentDifficulty, betAmount) {
    const baseXP = won ? 50 : 20;
    const difficultyBonus = Math.floor(opponentDifficulty * 30);
    const betBonus = Math.floor(betAmount / 100);
    return baseXP + difficultyBonus + betBonus;
}

// Проверка возможности покупки
function canAffordPurchase(currentMoney, price) {
    return currentMoney >= price && price > 0;
}

// Проверка возможности улучшения
function canUpgrade(car, upgradeType, currentMoney, upgradeLevel) {
    // Максимальный уровень улучшения зависит от машины
    let maxLevel = 10;
    if (car.price === 0 || car.price <= 8000) {
        maxLevel = 5;
    } else if (car.price <= 35000) {
        maxLevel = 7;
    }
    
    if (upgradeLevel >= maxLevel) {
        return { canUpgrade: false, reason: 'Максимальный уровень' };
    }
    
    // Расчет стоимости
    const baseCosts = {
        engine: 500,
        turbo: 300,
        tires: 200,
        suspension: 400,
        transmission: 600
    };
    
    const costMultipliers = {
        engine: 2.5,
        turbo: 2.3,
        tires: 2.2,
        suspension: 2.4,
        transmission: 2.5
    };
    
    const cost = Math.floor(baseCosts[upgradeType] * Math.pow(costMultipliers[upgradeType], upgradeLevel));
    
    if (currentMoney < cost) {
        return { canUpgrade: false, reason: 'Недостаточно денег', cost };
    }
    
    return { canUpgrade: true, cost };
}

// Безопасное обновление денег
function updateMoney(currentMoney, change, reason) {
    const newMoney = currentMoney + change;
    
    // Проверка на отрицательный баланс
    if (newMoney < 0) {
        throw new Error('Недостаточно денег');
    }
    
    // Логирование крупных транзакций
    if (Math.abs(change) > 10000) {
        console.log(`Крупная транзакция: ${change}, причина: ${reason}`);
    }
    
    return newMoney;
}

// Проверка достижения нового уровня
function checkLevelUp(currentLevel, currentXP) {
    const getRequiredXP = (level) => Math.floor(100 * Math.pow(1.5, level - 1));
    
    let newLevel = currentLevel;
    let totalReward = 0;
    
    while (currentXP >= getRequiredXP(newLevel + 1)) {
        newLevel++;
        const reward = 500 * newLevel;
        totalReward += reward;
    }
    
    return {
        newLevel,
        leveledUp: newLevel > currentLevel,
        reward: totalReward
    };
}

// Генерация безопасного списка соперников
function generateOpponents(playerLevel) {
    const opponents = [];
    const difficulties = ['easy', 'medium', 'hard', 'extreme'];
    
    const difficultySettings = {
        easy: { diffMult: 0.8, rewardMult: 0.8 },
        medium: { diffMult: 1.0, rewardMult: 1.0 },
        hard: { diffMult: 1.3, rewardMult: 1.5 },
        extreme: { diffMult: 1.6, rewardMult: 2.0 }
    };
    
    difficulties.forEach(diff => {
        const settings = difficultySettings[diff];
        const baseDifficulty = 0.7 + (playerLevel * 0.02);
        const difficulty = Number((baseDifficulty * settings.diffMult).toFixed(2));
        const baseReward = 200 + (playerLevel * 100);
        const reward = Math.floor(baseReward * settings.rewardMult / 50) * 50;
        
        opponents.push({
            difficulty,
            reward,
            difficultyClass: diff,
            fuelCost: calculateFuelCost(difficulty)
        });
    });
    
    return opponents;
}

// Расчет расхода топлива
function calculateFuelCost(difficulty) {
    const baseConsumption = 5;
    let multiplier = 1;
    
    if (difficulty >= 1.0 && difficulty < 1.4) multiplier = 1.5;
    else if (difficulty >= 1.4 && difficulty < 1.8) multiplier = 2;
    else if (difficulty >= 1.8) multiplier = 2.5;
    
    return Math.ceil(baseConsumption * multiplier);
}

// Получение требуемого уровня для машины
function getCarRequiredLevel(carPrice) {
    if (carPrice === 0) return 1;
    if (carPrice <= 5000) return 1;
    if (carPrice <= 15000) return 5;
    if (carPrice <= 30000) return 10;
    if (carPrice <= 50000) return 15;
    if (carPrice <= 80000) return 20;
    if (carPrice <= 150000) return 25;
    return 30;
}
module.exports = {
    calculateRaceResult,
    calculateXPGain,
    canAffordPurchase,
    canUpgrade,
    updateMoney,
    checkLevelUp,
    generateOpponents,
    calculateFuelCost,
    getCarRequiredLevel // Добавьте эту строку
};
