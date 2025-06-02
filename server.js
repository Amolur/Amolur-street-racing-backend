const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const { generalLimiter } = require('./middleware/rateLimiter');

dotenv.config();

const app = express();
app.set('trust proxy', 1);

// сервер
const corsOptions = {
    origin: function (origin, callback) {
        const allowedOrigins = [
            'https://amolur.github.io',
            'http://localhost:3000',
            'http://localhost:5500'
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
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Credentials', true);
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
        return res.status(200).json({});
    }
    next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);

// Защита от больших запросов
app.use(express.json({ limit: '10mb' }));

// Статические файлы (если фронтенд на том же сервере)
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'public')));
}

// Логирование запросов в development
if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
    });
}

// Подключение к MongoDB с retry логикой
const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
        });
        console.log('MongoDB подключена успешно');
    } catch (err) {
        console.error('Ошибка подключения к MongoDB:', err);
        // Повторная попытка через 5 секунд
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

// Проверка здоровья сервера
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// API роуты
app.use('/api/auth', require('./routes/auth'));
app.use('/api/game', require('./routes/game'));

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