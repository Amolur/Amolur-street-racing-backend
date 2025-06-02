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