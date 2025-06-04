// utils/eventManager.js
const Event = require('../models/Event');

class EventManager {
    constructor() {
        this.checkInterval = null;
        this.lastEventTime = null;
    }
    
    // Запуск системы событий
    start() {
        console.log('🎉 Система событий запущена');
        
        // Очищаем истекшие события при запуске
        this.cleanupExpiredEvents();
        
        // Проверяем события каждую минуту
        this.checkInterval = setInterval(() => {
            this.checkAndCreateEvent();
        }, 60 * 1000); // Каждую минуту
        
        // Первая проверка сразу
        this.checkAndCreateEvent();
    }
    
    // Остановка системы событий
    stop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        console.log('🛑 Система событий остановлена');
    }
    
    // Проверка и создание нового события
    async checkAndCreateEvent() {
        try {
            // Очищаем истекшие события
            await Event.cleanupExpiredEvents();
            
            // Проверяем текущее событие
            const currentEvent = await Event.getCurrentEvent();
            
            if (currentEvent) {
                // Событие активно, ничего не делаем
                return;
            }
            
            // Проверяем, прошло ли 2 часа с последнего события
            if (this.lastEventTime) {
                const timeSinceLastEvent = Date.now() - this.lastEventTime;
                const twoHours = 2 * 60 * 60 * 1000;
                
                if (timeSinceLastEvent < twoHours) {
                    // Еще рано для нового события
                    return;
                }
            }
            
            // Шанс создания события (30% каждую проверку после 2 часов)
            if (Math.random() < 0.3) {
                const newEvent = await Event.createRandomEvent();
                
                if (newEvent) {
                    console.log(`✨ Создано новое событие: ${newEvent.title}`);
                    this.lastEventTime = Date.now();
                    
                    // Здесь можно добавить отправку уведомлений всем игрокам
                    // this.notifyAllPlayers(newEvent);
                }
            }
            
        } catch (error) {
            console.error('Ошибка в системе событий:', error);
        }
    }
    
    // Очистка истекших событий
    async cleanupExpiredEvents() {
        try {
            await Event.cleanupExpiredEvents();
            console.log('🧹 Истекшие события очищены');
        } catch (error) {
            console.error('Ошибка очистки событий:', error);
        }
    }
    
    // Получить текущее событие
    async getCurrentEvent() {
        try {
            return await Event.getCurrentEvent();
        } catch (error) {
            console.error('Ошибка получения текущего события:', error);
            return null;
        }
    }
    
    // Применить эффект события к результату гонки
    applyEventEffect(event, raceResult) {
        if (!event) return raceResult;
        
        switch (event.type) {
            case 'double_rewards':
                if (raceResult.won) {
                    raceResult.reward *= event.multiplier;
                }
                break;
                
            case 'bonus_xp':
                raceResult.xpGained *= event.multiplier;
                break;
                
            case 'free_fuel':
                raceResult.fuelCost = 0;
                break;
                
            default:
                break;
        }
        
        return raceResult;
    }
    
    // Применить скидку на улучшения
    applyUpgradeDiscount(event, originalCost) {
        if (!event || event.type !== 'upgrade_discount') {
            return originalCost;
        }
        
        return Math.floor(originalCost * event.discount);
    }
}

// Создаем синглтон
const eventManager = new EventManager();

module.exports = eventManager;