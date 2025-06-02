const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        minlength: 3,
        maxlength: 20
    },
    password: {
        type: String,
        required: true
    },
    gameData: {
        money: {
            type: Number,
            default: 1000
        },
        level: {
            type: Number,
            default: 1
        },
        experience: {
            type: Number,
            default: 0
        },
        currentCar: {
            type: Number,
            default: 0
        },
        skills: {
            driving: { type: Number, default: 1 },
            speed: { type: Number, default: 1 },
            reaction: { type: Number, default: 1 },
            technique: { type: Number, default: 1 }
        },
        stats: {
            totalRaces: { type: Number, default: 0 },
            wins: { type: Number, default: 0 },
            losses: { type: Number, default: 0 },
            moneyEarned: { type: Number, default: 0 },
            moneySpent: { type: Number, default: 0 }
        },
        cars: [{
            id: Number,
            name: String,
            power: Number,
            speed: Number,
            handling: Number,
            acceleration: Number,
            price: Number,
            owned: Boolean,
            fuel: { type: Number, default: 30 },
            maxFuel: { type: Number, default: 30 },
            lastFuelUpdate: { type: Date, default: Date.now },
            upgrades: {
                engine: { type: Number, default: 0 },
                turbo: { type: Number, default: 0 },
                tires: { type: Number, default: 0 },
                suspension: { type: Number, default: 0 },
                transmission: { type: Number, default: 0 }
            },
            specialParts: {
                nitro: { type: Boolean, default: false },
                bodyKit: { type: Boolean, default: false },
                ecuTune: { type: Boolean, default: false },
                fuelTank: { type: Boolean, default: false }
            }
        }],
        achievements: [{
            id: String,
            name: String,
            description: String,
            unlockedAt: Date
        }],
        unlockedCarTiers: {
            type: [Number],
            default: [1]
        },
        // НОВОЕ: Ежедневные задания
        dailyTasks: {
    tasks: [{
        id: String,
        name: String,
        description: String,
        required: Number,
        reward: Number,
        trackStat: String,
        progress: { type: Number, default: 0 },
        completed: { type: Boolean, default: false },
        claimed: { type: Boolean, default: false }
    }],
    lastReset: { type: Number, default: () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today.getTime();
    }},
    completedToday: { type: Number, default: 0 }
},
        // НОВОЕ: Статистика для отслеживания прогресса заданий
        dailyStats: {
            totalRaces: { type: Number, default: 0 },
            wins: { type: Number, default: 0 },
            fuelSpent: { type: Number, default: 0 },
            upgradesBought: { type: Number, default: 0 },
            moneyEarned: { type: Number, default: 0 }
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastLogin: {
        type: Date,
        default: Date.now
    }
});

// Конфигурация ежедневных заданий
const DAILY_TASKS_CONFIG = [
    {
        id: 'daily_races',
        name: '🏁 Гонщик дня',
        description: 'Проведи 3 гонки',
        required: 3,
        reward: 500,
        trackStat: 'totalRaces'
    },
    {
        id: 'daily_wins',
        name: '🏆 Победитель',
        description: 'Выиграй 2 гонки',
        required: 2,
        reward: 1000,
        trackStat: 'wins'
    },
    {
        id: 'daily_fuel',
        name: '⛽ Экономист',
        description: 'Потрать 15 топлива',
        required: 15,
        reward: 300,
        trackStat: 'fuelSpent'
    },
    {
        id: 'daily_upgrade',
        name: '🔧 Механик',
        description: 'Купи 1 улучшение',
        required: 1,
        reward: 800,
        trackStat: 'upgradesBought'
    },
    {
        id: 'daily_money',
        name: '💰 Богач',
        description: 'Заработай $2000',
        required: 2000,
        reward: 500,
        trackStat: 'moneyEarned'
    }
];

// Функция генерации ежедневных заданий
function generateDailyTasks() {
    const shuffled = [...DAILY_TASKS_CONFIG].sort(() => Math.random() - 0.5);
    const selectedTasks = shuffled.slice(0, 3);
    
    // Получаем начало текущего дня (00:00:00) в миллисекундах
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return {
        tasks: selectedTasks.map(config => ({
            ...config,
            progress: 0,
            completed: false,
            claimed: false
        })),
        lastReset: today.getTime(), // Сохраняем timestamp
        completedToday: 0
    };
}

// Метод для проверки и сброса ежедневных заданий
userSchema.methods.checkAndResetDailyTasks = function() {
    // Получаем начало текущего дня
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();
    
    console.log('Проверка заданий:');
    console.log('Сегодня (timestamp):', todayTimestamp);
    console.log('Последний сброс (timestamp):', this.gameData.dailyTasks?.lastReset);
    
    if (!this.gameData.dailyTasks || !this.gameData.dailyTasks.tasks || this.gameData.dailyTasks.tasks.length === 0) {
        console.log('Задания отсутствуют, генерируем новые');
        this.gameData.dailyTasks = generateDailyTasks();
        
        this.gameData.dailyStats = {
            totalRaces: this.gameData.stats.totalRaces,
            wins: this.gameData.stats.wins,
            fuelSpent: 0,
            upgradesBought: 0,
            moneyEarned: this.gameData.stats.moneyEarned
        };
        
        return true;
    }
    
    // Проверяем, если lastReset - это строка (старый формат), конвертируем
    let lastResetTimestamp = this.gameData.dailyTasks.lastReset;
    if (typeof lastResetTimestamp === 'string') {
        const lastResetDate = new Date(lastResetTimestamp);
        lastResetDate.setHours(0, 0, 0, 0);
        lastResetTimestamp = lastResetDate.getTime();
    }
    
    // Сравниваем timestamps
    if (lastResetTimestamp < todayTimestamp) {
        console.log('Новый день, сбрасываем задания');
        this.gameData.dailyTasks = generateDailyTasks();
        
        this.gameData.dailyStats = {
            totalRaces: this.gameData.stats.totalRaces,
            wins: this.gameData.stats.wins,
            fuelSpent: 0,
            upgradesBought: 0,
            moneyEarned: this.gameData.stats.moneyEarned
        };
        
        return true;
    }
    
    console.log('Задания актуальны');
    return false;
};

// Метод для проверки и сброса ежедневных заданий
userSchema.methods.checkAndResetDailyTasks = function() {
    // Получаем текущую дату в формате YYYY-MM-DD
    const today = new Date();
    const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    console.log('Проверка заданий:');
    console.log('Сегодня:', todayString);
    console.log('Последний сброс:', this.gameData.dailyTasks?.lastReset);
    console.log('Задания существуют:', !!this.gameData.dailyTasks);
    
    if (!this.gameData.dailyTasks || !this.gameData.dailyTasks.tasks || this.gameData.dailyTasks.tasks.length === 0) {
        console.log('Задания отсутствуют, генерируем новые');
        this.gameData.dailyTasks = generateDailyTasks();
        
        this.gameData.dailyStats = {
            totalRaces: this.gameData.stats.totalRaces,
            wins: this.gameData.stats.wins,
            fuelSpent: 0,
            upgradesBought: 0,
            moneyEarned: this.gameData.stats.moneyEarned
        };
        
        return true;
    }
    
    if (this.gameData.dailyTasks.lastReset !== todayString) {
        console.log('Новый день, сбрасываем задания');
        this.gameData.dailyTasks = generateDailyTasks();
        
        this.gameData.dailyStats = {
            totalRaces: this.gameData.stats.totalRaces,
            wins: this.gameData.stats.wins,
            fuelSpent: 0,
            upgradesBought: 0,
            moneyEarned: this.gameData.stats.moneyEarned
        };
        
        return true;
    }
    
    console.log('Задания актуальны');
    return false;
};

// Добавляем начальную машину при создании пользователя
userSchema.pre('save', function(next) {
    if (this.isNew && this.gameData.cars.length === 0) {
        this.gameData.cars.push({
            id: 0,
            name: "Handa Civic",
            power: 50,
            speed: 60,
            handling: 70,
            acceleration: 55,
            price: 0,
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
        });
    }
    
    // Инициализация ежедневных заданий для нового пользователя
    if (this.isNew && (!this.gameData.dailyTasks || !this.gameData.dailyTasks.tasks)) {
        this.gameData.dailyTasks = generateDailyTasks();
        this.gameData.dailyStats = {
            totalRaces: 0,
            wins: 0,
            fuelSpent: 0,
            upgradesBought: 0,
            moneyEarned: 0
        };
    }
    
    next();
});

// Методы для работы с уровнями
userSchema.methods.getRequiredXP = function(level) {
    return Math.floor(100 * Math.pow(1.5, level - 1));
};

userSchema.methods.checkLevelUp = function() {
    let levelsGained = 0;
    let totalReward = 0;
    
    while (this.gameData.experience >= this.getRequiredXP(this.gameData.level + 1)) {
        this.gameData.level++;
        levelsGained++;
        const reward = 500 * this.gameData.level;
        this.gameData.money += reward;
        totalReward += reward;
        
        // Разблокируем новые уровни машин
        if (this.gameData.level === 5 && !this.gameData.unlockedCarTiers.includes(5)) {
            this.gameData.unlockedCarTiers.push(5);
        }
        if (this.gameData.level === 10 && !this.gameData.unlockedCarTiers.includes(10)) {
            this.gameData.unlockedCarTiers.push(10);
        }
        if (this.gameData.level === 15 && !this.gameData.unlockedCarTiers.includes(15)) {
            this.gameData.unlockedCarTiers.push(15);
        }
        if (this.gameData.level === 20 && !this.gameData.unlockedCarTiers.includes(20)) {
            this.gameData.unlockedCarTiers.push(20);
        }
        if (this.gameData.level === 25 && !this.gameData.unlockedCarTiers.includes(25)) {
            this.gameData.unlockedCarTiers.push(25);
        }
        if (this.gameData.level === 30 && !this.gameData.unlockedCarTiers.includes(30)) {
            this.gameData.unlockedCarTiers.push(30);
        }
    }
    
    return { levelsGained, totalReward };
};

// НОВОЕ: Метод для проверки и сброса ежедневных заданий
userSchema.methods.checkAndResetDailyTasks = function() {
    const today = new Date().toDateString();
    
    console.log('Проверка заданий:');
    console.log('Сегодня:', today);
    console.log('Последний сброс:', this.gameData.dailyTasks?.lastReset);
    console.log('Задания существуют:', !!this.gameData.dailyTasks);
    
    if (!this.gameData.dailyTasks || !this.gameData.dailyTasks.tasks || this.gameData.dailyTasks.tasks.length === 0) {
        console.log('Задания отсутствуют, генерируем новые');
        // Генерируем новые задания
        this.gameData.dailyTasks = generateDailyTasks();
        
        // Сбрасываем счетчики для отслеживания
        this.gameData.dailyStats = {
            totalRaces: this.gameData.stats.totalRaces,
            wins: this.gameData.stats.wins,
            fuelSpent: 0,
            upgradesBought: 0,
            moneyEarned: this.gameData.stats.moneyEarned
        };
        
        return true; // Задания были сброшены
    }
    
    if (this.gameData.dailyTasks.lastReset !== today) {
        console.log('Новый день, сбрасываем задания');
        // Генерируем новые задания
        this.gameData.dailyTasks = generateDailyTasks();
        
        // Сбрасываем счетчики для отслеживания
        this.gameData.dailyStats = {
            totalRaces: this.gameData.stats.totalRaces,
            wins: this.gameData.stats.wins,
            fuelSpent: 0,
            upgradesBought: 0,
            moneyEarned: this.gameData.stats.moneyEarned
        };
        
        return true; // Задания были сброшены
    }
    
    console.log('Задания актуальны');
    return false; // Задания актуальны
};

// НОВОЕ: Метод для обновления прогресса заданий
userSchema.methods.updateTaskProgress = function(statType, amount = 1) {
    if (!this.gameData.dailyTasks || !this.gameData.dailyTasks.tasks) return;
    
    let updated = false;
    
    this.gameData.dailyTasks.tasks.forEach(task => {
        if (task.completed || task.trackStat !== statType) return;
        
        // Обновляем прогресс в зависимости от типа
        switch (statType) {
            case 'totalRaces':
                task.progress = this.gameData.stats.totalRaces - (this.gameData.dailyStats.totalRaces || 0);
                break;
            case 'wins':
                task.progress = this.gameData.stats.wins - (this.gameData.dailyStats.wins || 0);
                break;
            case 'fuelSpent':
                this.gameData.dailyStats.fuelSpent = (this.gameData.dailyStats.fuelSpent || 0) + amount;
                task.progress = this.gameData.dailyStats.fuelSpent;
                break;
            case 'upgradesBought':
                this.gameData.dailyStats.upgradesBought = (this.gameData.dailyStats.upgradesBought || 0) + amount;
                task.progress = this.gameData.dailyStats.upgradesBought;
                break;
            case 'moneyEarned':
                task.progress = this.gameData.stats.moneyEarned - (this.gameData.dailyStats.moneyEarned || 0);
                break;
        }
        
        // Проверяем выполнение
        if (task.progress >= task.required) {
            task.progress = task.required;
            task.completed = true;
            updated = true;
        }
    });
    
    return updated;
};

// НОВОЕ: Метод для получения награды за задание
userSchema.methods.claimTaskReward = function(taskId) {
    const task = this.gameData.dailyTasks.tasks.find(t => t.id === taskId);
    
    if (!task) {
        return { success: false, error: 'Задание не найдено' };
    }
    
    if (!task.completed) {
        return { success: false, error: 'Задание еще не выполнено' };
    }
    
    if (task.claimed) {
        return { success: false, error: 'Награда уже получена' };
    }
    
    // Даем награду
    this.gameData.money += task.reward;
    task.claimed = true;
    this.gameData.dailyTasks.completedToday++;
    
    // Бонус за выполнение всех заданий
    let bonusReward = 0;
    if (this.gameData.dailyTasks.completedToday === 3) {
        bonusReward = 1000;
        this.gameData.money += bonusReward;
    }
    
    return { 
        success: true, 
        reward: task.reward,
        bonusReward: bonusReward,
        taskName: task.name
    };
};

// Метод для добавления достижения
userSchema.methods.unlockAchievement = function(achievementId, name, description) {
    const exists = this.gameData.achievements.some(a => a.id === achievementId);
    if (!exists) {
        this.gameData.achievements.push({
            id: achievementId,
            name: name,
            description: description,
            unlockedAt: new Date()
        });
        return true;
    }
    return false;
};

// Метод для восстановления топлива
userSchema.methods.regenerateFuel = function() {
    const now = new Date();
    const fuelRegenRate = 10; // минут на единицу топлива
    
    this.gameData.cars.forEach(car => {
        if (car.fuel < car.maxFuel) {
            const lastUpdate = new Date(car.lastFuelUpdate);
            const minutesPassed = Math.floor((now - lastUpdate) / 60000);
            const fuelToRegenerate = Math.floor(minutesPassed / fuelRegenRate);
            
            if (fuelToRegenerate > 0) {
                car.fuel = Math.min(car.fuel + fuelToRegenerate, car.maxFuel);
                car.lastFuelUpdate = now;
            }
        }
    });
};

// Метод для траты топлива
userSchema.methods.spendFuel = function(carIndex, amount) {
    const car = this.gameData.cars[carIndex];
    if (car && car.fuel >= amount) {
        car.fuel -= amount;
        car.lastFuelUpdate = new Date();
        return true;
    }
    return false;
};

// Метод для получения времени до восстановления топлива
userSchema.methods.getFuelRegenTime = function(carIndex) {
    const car = this.gameData.cars[carIndex];
    if (!car || car.fuel >= car.maxFuel) return 0;
    
    const now = new Date();
    const lastUpdate = new Date(car.lastFuelUpdate);
    const minutesPassed = (now - lastUpdate) / 60000;
    const minutesUntilNextFuel = 10 - (minutesPassed % 10);
    
    return Math.ceil(minutesUntilNextFuel);
};

module.exports = mongoose.model('User', userSchema);