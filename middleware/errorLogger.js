// middleware/errorLogger.js
const fs = require('fs');
const path = require('path');

const logError = (error, context = {}) => {
    const timestamp = new Date().toISOString();
    const logMessage = `
[${timestamp}] ERROR
Context: ${JSON.stringify(context)}
Error: ${error.message}
Stack: ${error.stack}
-------------------
`;
    
    // Создаем папку logs если её нет
    const logsDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
    }
    
    // Записываем в файл
    fs.appendFileSync(
        path.join(logsDir, 'errors.log'),
        logMessage
    );
};

module.exports = { logError };