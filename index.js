const express = require('express');
const cors = require('cors');
const pool = require('./config');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const usersRouter = require('./routes/users');
const ingredientsRouter = require('./routes/ingredients');
const dishesRouter = require('./routes/dishes');
const mealPlansRouter = require('./routes/meal_plans');
const mealBlocksRouter = require('./routes/meal_blocks');
const mealItemsRouter = require('./routes/meal_items');
const weightHistoryRouter = require('./routes/weight_history');
const nutritionRouter = require('./routes/nutrition');
const nutritionistsRouter = require('./routes/nutritionists');

const app = express();

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Подключаем маршруты пользователей
app.use('/api/users', usersRouter);

// Подключаем маршруты ингредиентов
app.use('/api/ingredients', ingredientsRouter);

// Подключаем маршруты блюд
app.use('/api/dishes', dishesRouter);

// Подключаем маршруты планов питания
app.use('/api/meal_plans', mealPlansRouter);

// Подключаем маршруты блоков питания
app.use('/api/meal_blocks', mealBlocksRouter);

// Подключаем маршруты блюд в блоке
app.use('/api/meal_items', mealItemsRouter);

// Подключаем маршруты истории веса
app.use('/api/weight_history', weightHistoryRouter);

// Подключаем маршруты КБЖУ
app.use('/api/nutrition', nutritionRouter);

// Подключаем маршруты нутрициологов
app.use('/api/nutritionists', nutritionistsRouter);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
}); 