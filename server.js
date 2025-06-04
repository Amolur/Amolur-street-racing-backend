const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const saveProtection = require('./middleware/saveProtection');
const { generalLimiter } = require('./middleware/rateLimiter');


app.use('/api/game', saveProtection);
dotenv.config();


const app = express();
app.set('trust proxy', 1);

// CORS настройки
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'https://amolur.github.io',
            'http://localhost:3000',
            'http://localhost:5500',
            'http://127.0.0.1:5500'
        ];
        
        // Разрешаем запросы без origin (например, от Postman)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));

// Заголовки безопасности
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Credentials', true);
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.header('Content-Type', 'application/json');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
        return res.status(200).json({});
    }
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);
// Middleware для логирования всех запросов в production
if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            if (duration > 1000) { // Логируем медленные запросы
                console.log(`Медленный запрос: ${req.method} ${req.path} - ${duration}ms`);
            }
        });
        next();
    });
}

// Статические файлы с кешированием
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'public'), {
        maxAge: '1d', // Кешировать статику на 1 день
        etag: true,
        lastModified: true,
        setHeaders: (res, path) => {
            if (path.endsWith('.html')) {
                res.setHeader('Cache-Control', 'no-cache');
            }
        }
    }));
}

// Логирование запросов в development
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });
}

// Настройки Mongoose для оптимизации
mongoose.set('strictQuery', false);

// Подключение к MongoDB с retry логикой
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            maxPoolSize: 10,
            minPoolSize: 5,
            socketTimeoutMS: 45000,
            // Новые опции для надежности
            retryWrites: true,
            w: 'majority',
            journal: true,
            readPreference: 'primaryPreferred'
        });
        console.log('MongoDB подключена успешно');
        
        // Создаем индексы после подключения
        const User = require('./models/User');
        await User.createIndexes();
        console.log('Индексы созданы');
        
    } catch (err) {
        console.error('Ошибка подключения к MongoDB:', err);
        console.log('Повторная попытка подключения через 5 секунд...');
        setTimeout(connectDB, 5000);
    }
};

// Обработка отключения MongoDB
mongoose.connection.on('disconnected', () => {
    console.log('MongoDB отключена');
});

mongoose.connection.on('error', (err) => {
    console.error('MongoDB ошибка:', err);
});

// Запуск подключения к БД
connectDB();

// Проверка здоровья сервера с кешированием
let healthCheckCache = null;
let healthCheckCacheTime = 0;
const HEALTH_CACHE_TTL = 10000; // 10 секунд

app.get('/health', (req, res) => {
    const now = Date.now();
    
    if (healthCheckCache && (now - healthCheckCacheTime) < HEALTH_CACHE_TTL) {
        return res.json(healthCheckCache);
    }
    
    const health = {
        status: 'OK',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    };
    
    healthCheckCache = health;
    healthCheckCacheTime = now;
    
    res.json(health);
});

// API роуты
app.use('/api/auth', require('./routes/auth'));
app.use('/api/game', require('./routes/game'));
app.use('/api/chat', require('./routes/chat'));

// Обработка 404
app.use((req, res) => {
    res.status(404).json({ error: 'Маршрут не найден' });
});

// Глобальная обработка ошибок
app.use((err, req, res, next) => {
    console.error('Ошибка:', err);
    
    // Ошибка валидации Mongoose
    if (err.name === 'ValidationError') {
        return res.status(400).json({ 
            error: 'Ошибка валидации данных',
            details: Object.values(err.errors).map(e => e.message)
        });
    }
    
    // Ошибка уникальности (дубликат)
    if (err.code === 11000) {
        return res.status(400).json({ 
            error: 'Такие данные уже существуют' 
        });
    }
    
    // JWT ошибки
    if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
            error: 'Недействительный токен' 
        });
    }
    
    if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
            error: 'Токен истёк' 
        });
    }
    
    // Общая ошибка сервера
    res.status(500).json({ 
        error: process.env.NODE_ENV === 'production' 
            ? 'Внутренняя ошибка сервера' 
            : err.message 
    });
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM получен. Закрываем сервер...');
    server.close(() => {
        console.log('HTTP сервер закрыт');
        mongoose.connection.close(false, () => {
            console.log('MongoDB соединение закрыто');
            process.exit(0);
        });
    });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT} в режиме ${process.env.NODE_ENV || 'development'}`);
});