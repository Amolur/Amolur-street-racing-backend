const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['double_rewards', 'upgrade_discount', 'free_fuel', 'bonus_xp'],
        required: true
    },
    title: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    icon: {
        type: String,
        default: '🎉'
    },
    multiplier: {
        type: Number,
        default: 2 // Для событий с множителями
    },
    discount: {
        type: Number,
        default: 0.5 // 50% скидка по умолчанию
    },
    startTime: {
        type: Date,
        required: true
    },
    endTime: {
        type: Date,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
});

// Индексы для быстрого поиска активных событий
eventSchema.index({ isActive: 1, startTime: 1, endTime: 1 });

// Статический метод для получения текущего события
eventSchema.statics.getCurrentEvent = async function() {
    const now = new Date();
    
    const event = await this.findOne({
        isActive: true,
        startTime: { $lte: now },
        endTime: { $gte: now }
    });
    
    return event;
};

// Статический метод для создания нового случайного события
eventSchema.statics.createRandomEvent = async function() {
    // Проверяем, нет ли активного события
    const currentEvent = await this.getCurrentEvent();
    if (currentEvent) {
        return null; // Уже есть активное событие
    }
    
    // Типы событий с их параметрами
    const eventTypes = [
        {
            type: 'double_rewards',
            title: '💰 Двойные награды!',
            description: 'Получайте x2 деньги за все победы в гонках!',
            icon: '💰',
            multiplier: 2
        },
        {
            type: 'upgrade_discount',
            title: '🔧 Скидки на улучшения!',
            description: '50% скидка на все улучшения машин!',
            icon: '🔧',
            discount: 0.5
        },
        {
            type: 'free_fuel',
            title: '⛽ Бесплатное топливо!',
            description: 'Гонки не расходуют топливо!',
            icon: '⛽'
        },
        {
            type: 'bonus_xp',
            title: '⭐ Двойной опыт!',
            description: 'Получайте x2 опыта за все гонки!',
            icon: '⭐',
            multiplier: 2
        }
    ];
    
    // Выбираем случайное событие
    const randomEvent = eventTypes[Math.floor(Math.random() * eventTypes.length)];
    
    // Устанавливаем время события (2 часа)
    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000); // +2 часа
    
    // Создаем событие
    const event = new this({
        ...randomEvent,
        startTime,
        endTime
    });
    
    await event.save();
    return event;
};

// Метод для проверки истекших событий
eventSchema.statics.cleanupExpiredEvents = async function() {
    const now = new Date();
    
    await this.updateMany(
        {
            isActive: true,
            endTime: { $lt: now }
        },
        {
            isActive: false
        }
    );
};

module.exports = mongoose.model('Event', eventSchema);