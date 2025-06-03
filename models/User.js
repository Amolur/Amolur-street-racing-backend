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
        rating: {
            type: Number,
            default: 1000
        },
        totalPlayTime: {
            type: Number,
            default: 0
        },
        lastAchievementCheck: {
            type: Date,
            default: Date.now
        },
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
            generatedAt: { type: Date, default: Date.now },
            expiresAt: { type: Date },
            completedToday: { type: Number, default: 0 }
        },
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
    },
    lastActivity: {
        type: Date,
        default: Date.now
    }
});

// Индексы для оптимизации запросов
userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ 'gameData.level': -1, 'gameData.experience': -1 });
userSchema.index({ lastLogin: -1 });
userSchema.index({ lastActivity: -1 });
userSchema.index({ createdAt: -1 });

// Составной индекс для таблицы лидеров
userSchema.index({ 
    'gameData.level': -1, 
    'gameData.experience': -1, 
    'gameData.money': -1 
});

// Индекс для поиска по статистике
userSchema.index({ 'gameData.stats.wins': -1 });

// Индекс для рейтинга
userSchema.index({ 'gameData.rating': -1 });

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
    
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    
    return {
        tasks: selectedTasks.map(config => ({
            ...config,
            progress: 0,
            completed: false,
            claimed: false
        })),
        generatedAt: now,
        expiresAt: expiresAt,
        completedToday: 0
    };
}

// Метод для проверки и сброса ежедневных заданий
userSchema.methods.checkAndResetDailyTasks = function() {
    const now = new Date();
    
    // Если заданий нет вообще - создаем новые
    if (!this.gameData.dailyTasks || !this.gameData.dailyTasks.tasks || 
        this.gameData.dailyTasks.tasks.length === 0) {
        console.log('Задания отсутствуют, генерируем новые');
        this.gameData.dailyTasks = generateDailyTasks();
        
        this.gameData.dailyStats = {
            totalRaces: this.gameData.stats.totalRaces || 0,
            wins: this.gameData.stats.wins || 0,
            fuelSpent: 0,
            upgradesBought: 0,
            moneyEarned: this.gameData.stats.moneyEarned || 0
        };
        
        return true;
    }
    
    // Проверяем время истечения заданий
    if (!this.gameData.dailyTasks.expiresAt) {
        // Если нет времени истечения, устанавливаем его
        const expiresAt = new Date(now);
        expiresAt.setHours(24, 0, 0, 0); // Следующая полночь
        this.gameData.dailyTasks.expiresAt = expiresAt;
        return false;
    }
    
    // Проверяем, истекли ли задания (прошло 24 часа)
    const expiresAt = new Date(this.gameData.dailyTasks.expiresAt);
    if (now >= expiresAt) {
        console.log('24 часа прошло, генерируем новые задания');
        this.gameData.dailyTasks = generateDailyTasks();
        
        this.gameData.dailyStats = {
            totalRaces: this.gameData.stats.totalRaces || 0,
            wins: this.gameData.stats.wins || 0,
            fuelSpent: 0,
            upgradesBought: 0,
            moneyEarned: this.gameData.stats.moneyEarned || 0
        };
        
        return true;
    }
    
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
    
    // Инициализация достижений для нового пользователя
    if (this.isNew && !this.gameData.achievements) {
        this.gameData.achievements = [];
    }
    
    // Инициализация рейтинга для нового пользователя
    if (this.isNew && !this.gameData.rating) {
        this.gameData.rating = 1000;
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

// Метод для обновления прогресса заданий
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

// Метод для получения награды за задание
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

// Метод для получения ранга игрока
userSchema.methods.getRank = function() {
    const rating = this.gameData.rating || 1000;
    
    if (rating >= 2500) return { name: 'Мастер', icon: '👑', color: '#FF4444' };
    if (rating >= 2000) return { name: 'Золото', icon: '🥇', color: '#FFD700' };
    if (rating >= 1500) return { name: 'Серебро', icon: '🥈', color: '#C0C0C0' };
    if (rating >= 1000) return { name: 'Бронза', icon: '🥉', color: '#CD7F32' };
    
    return { name: 'Новичок', icon: '🔰', color: '#888888' };
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
// Метод для получения текущего топлива с учетом регенерации
userSchema.methods.getFuelForCar = function(carIndex) {
    const car = this.gameData.cars[carIndex];
    if (!car) return 0;
    
    const now = new Date();
    const lastUpdate = new Date(car.lastFuelUpdate);
    const minutesPassed = (now - lastUpdate) / 60000;
    const fuelRegenerated = Math.floor(minutesPassed / 10);
    
    return Math.min(car.fuel + fuelRegenerated, car.maxFuel || 30);
};

// Добавьте также функцию для получения требуемого уровня машины
userSchema.statics.getCarRequiredLevel = function(carPrice) {
    if (carPrice === 0) return 1;
    if (carPrice <= 5000) return 1;
    if (carPrice <= 15000) return 5;
    if (carPrice <= 30000) return 10;
    if (carPrice <= 50000) return 15;
    if (carPrice <= 80000) return 20;
    if (carPrice <= 150000) return 25;
    return 30;
};
module.exports = mongoose.model('User', userSchema);