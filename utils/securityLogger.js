// utils/securityLogger.js
const fs = require('fs');
const path = require('path');

class SecurityLogger {
    constructor() {
        this.logsDir = path.join(__dirname, '../logs');
        this.ensureLogsDirectory();
    }
    
    ensureLogsDirectory() {
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }
    }
    
    logSuspiciousActivity(userId, username, activity, data = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            userId,
            username,
            activity,
            data,
            ip: data.ip || 'unknown'
        };
        
        // Записываем в файл
        const logFile = path.join(this.logsDir, 'security.log');
        try {
            fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
        } catch (error) {
            console.error('Ошибка записи в лог безопасности:', error);
        }
        
        // Также выводим в консоль
        console.warn(`[SECURITY] ${timestamp} - User ${username}: ${activity}`);
    }
    
    logLoginAttempt(username, success, ip) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            username,
            success,
            ip,
            type: 'login_attempt'
        };
        
        const logFile = path.join(this.logsDir, 'auth.log');
        try {
            fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
        } catch (error) {
            console.error('Ошибка записи в лог авторизации:', error);
        }
    }
    
    logGameAction(userId, username, action, details = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            userId,
            username,
            action,
            details
        };
        
        const logFile = path.join(this.logsDir, 'game-actions.log');
        try {
            fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
        } catch (error) {
            console.error('Ошибка записи в лог игровых действий:', error);
        }
    }
    
    logError(error, context = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            context
        };
        
        const logFile = path.join(this.logsDir, 'errors.log');
        try {
            fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
        } catch (err) {
            console.error('Ошибка записи в лог ошибок:', err);
        }
        
        // Выводим в консоль
        console.error(`[ERROR] ${timestamp}:`, error.message);
    }
    
    // Получить последние N записей из лога
    getRecentLogs(logType = 'security', count = 100) {
        const logFile = path.join(this.logsDir, `${logType}.log`);
        
        if (!fs.existsSync(logFile)) {
            return [];
        }
        
        try {
            const content = fs.readFileSync(logFile, 'utf8');
            const lines = content.trim().split('\n').filter(line => line);
            const logs = lines.slice(-count).map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return null;
                }
            }).filter(log => log);
            
            return logs;
        } catch (error) {
            console.error('Ошибка чтения логов:', error);
            return [];
        }
    }
    
    // Очистка старых логов
    cleanOldLogs(daysToKeep = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        const logFiles = ['security.log', 'auth.log', 'game-actions.log', 'errors.log'];
        
        logFiles.forEach(filename => {
            const logFile = path.join(this.logsDir, filename);
            if (!fs.existsSync(logFile)) return;
            
            try {
                const content = fs.readFileSync(logFile, 'utf8');
                const lines = content.trim().split('\n').filter(line => line);
                
                const recentLines = lines.filter(line => {
                    try {
                        const log = JSON.parse(line);
                        return new Date(log.timestamp) > cutoffDate;
                    } catch (e) {
                        return true; // Сохраняем строки, которые не удалось распарсить
                    }
                });
                
                fs.writeFileSync(logFile, recentLines.join('\n') + '\n');
                console.log(`Очищен лог ${filename}: удалено ${lines.length - recentLines.length} старых записей`);
            } catch (error) {
                console.error(`Ошибка очистки лога ${filename}:`, error);
            }
        });
    }
}

module.exports = new SecurityLogger();