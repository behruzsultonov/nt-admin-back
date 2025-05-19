const express = require('express');
const router = express.Router();
const pool = require('../config');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const filename = uniqueSuffix + path.extname(file.originalname);
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: function (req, file, cb) {
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
      return cb(new Error('Можно загружать только изображения!'), false);
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// Получение всех блюд
router.get('/', async (req, res) => {
  try {
    const [dishes] = await pool.query(`
      SELECT d.*, 
        GROUP_CONCAT(DISTINCT mt.meal_time) AS meal_times,
        GROUP_CONCAT(DISTINCT JSON_OBJECT(
          'id', i.id,
          'name', i.name,
          'amount', di.amount,
          'unit', di.unit
        ) SEPARATOR '||') AS ingredients
      FROM dishes d
      LEFT JOIN dish_meal_times mt ON d.id = mt.dish_id
      LEFT JOIN dish_ingredients di ON d.id = di.dish_id
      LEFT JOIN ingredients i ON di.ingredient_id = i.id
      GROUP BY d.id
    `);

    const formattedDishes = dishes.map(dish => ({
      ...dish,
      meal_times: dish.meal_times ? dish.meal_times.split(',') : [],
      ingredients: dish.ingredients
        ? dish.ingredients.split('||').map(ing => {
          try {
            return JSON.parse(ing);
          } catch {
            return null;
          }
        }).filter(Boolean)
        : []
    }));

    res.json(formattedDishes);
  } catch (error) {
    console.error('Ошибка при получении блюд:', error);
    res.status(500).json({ error: 'Ошибка при получении блюд' });
  }
});

// Создание блюда
router.post('/', upload.single('image'), async (req, res) => {
  const {
    name,
    calories_per_100,
    proteins_per_100,
    carbs_per_100,
    fats_per_100,
    instruction,
    video_url,
    meal_times,
    ingredients,
    unit
  } = req.body;

  if (!name || !meal_times) {
    return res.status(400).json({ error: 'Необходимо указать название и типы приема пищи' });
  }

  try {
    await pool.query('START TRANSACTION');

    // Обработка image_url
    const image_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    // Обработка video_url - если пустое значение, сохраняем как NULL
    const processedVideoUrl = video_url === '' || video_url === 'undefined' ? null : video_url;

    // Парсим JSON строки, если они пришли как строки
    const parsedMealTimes = typeof meal_times === 'string' ? JSON.parse(meal_times) : meal_times;
    const parsedIngredients = typeof ingredients === 'string' ? JSON.parse(ingredients) : ingredients;

    const [dishResult] = await pool.query(
      'INSERT INTO dishes (name, calories_per_100, proteins_per_100, carbs_per_100, fats_per_100, instruction, video_url, image_url, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, calories_per_100, proteins_per_100, carbs_per_100, fats_per_100, instruction, processedVideoUrl, image_url, unit]
    );
    const dishId = dishResult.insertId;

    // Добавляем типы приема пищи
    for (const mealTime of parsedMealTimes) {
      await pool.query(
        'INSERT INTO dish_meal_times (dish_id, meal_time) VALUES (?, ?)',
        [dishId, mealTime]
      );
    }

    // Добавляем ингредиенты, если они есть
    if (Array.isArray(parsedIngredients) && parsedIngredients.length > 0) {
      for (const ingredient of parsedIngredients) {
        if (!ingredient.ingredient_id || !ingredient.amount) continue;
        await pool.query(
          'INSERT INTO dish_ingredients (dish_id, ingredient_id, amount, unit) VALUES (?, ?, ?, ?)',
          [dishId, ingredient.ingredient_id, ingredient.amount, ingredient.unit || 'г']
        );
      }
    }

    await pool.query('COMMIT');

    // Получаем созданное блюдо со всеми данными
    const [dishes] = await pool.query(`
      SELECT d.*, 
        GROUP_CONCAT(DISTINCT dmt.meal_time) as meal_times,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', di.id,
            'ingredient_id', i.id,
            'name', i.name,
            'amount', di.amount,
            'unit', di.unit
          )
        ) as ingredients
      FROM dishes d
      LEFT JOIN dish_meal_times dmt ON d.id = dmt.dish_id
      LEFT JOIN dish_ingredients di ON d.id = di.dish_id
      LEFT JOIN ingredients i ON di.ingredient_id = i.id
      WHERE d.id = ?
      GROUP BY d.id
    `, [dishId]);

    const dish = {
      ...dishes[0],
      meal_times: dishes[0].meal_times ? dishes[0].meal_times.split(',') : [],
      ingredients: (() => {
        try {
          const parsed = JSON.parse(dishes[0].ingredients);
          return Array.isArray(parsed) ? parsed.filter(i => i && i.id !== null) : [];
        } catch {
          return [];
        }
      })()
    };

    res.status(201).json(dish);
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Ошибка при создании блюда:', error);
    res.status(500).json({ error: 'Ошибка при создании блюда' });
  }
});

// Обновление блюда
router.put('/:id', upload.single('image'), async (req, res) => {
  const {
    name,
    calories_per_100,
    proteins_per_100,
    carbs_per_100,
    fats_per_100,
    instruction,
    video_url,
    meal_times,
    ingredients,
    unit
  } = req.body;

  // Проверяем и парсим meal_times
  let parsedMealTimes;
  try {
    parsedMealTimes = typeof meal_times === 'string' ? JSON.parse(meal_times) : meal_times;
    if (!Array.isArray(parsedMealTimes)) {
      return res.status(400).json({ error: 'Типы приема пищи должны быть массивом' });
    }
  } catch (error) {
    console.error('Ошибка при парсинге meal_times:', error);
    return res.status(400).json({ error: 'Неверный формат типов приема пищи' });
  }

  if (!name || !parsedMealTimes || parsedMealTimes.length === 0) {
    return res.status(400).json({ 
      error: 'Необходимо указать название и типы приема пищи (в виде массива)',
      received: {
        name,
        meal_times: parsedMealTimes
      }
    });
  }

  const dishId = req.params.id;

  try {
    await pool.query('START TRANSACTION');

    // Получаем текущее блюдо для сохранения существующего image_url
    const [currentDish] = await pool.query('SELECT image_url FROM dishes WHERE id = ?', [dishId]);
    if (!currentDish.length) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Блюдо не найдено' });
    }

    // Обработка image_url
    let image_url = currentDish[0].image_url; // Сохраняем существующий image_url по умолчанию
    if (req.file) {
      // Удаляем старое изображение, если оно существует
      if (currentDish[0].image_url) {
        const oldImagePath = path.join(__dirname, '../', currentDish[0].image_url);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }
      image_url = `/uploads/${req.file.filename}`;
    }

    // Обработка video_url - если пустое значение, сохраняем как NULL
    const processedVideoUrl = video_url === '' || video_url === 'undefined' ? null : video_url;

    // Парсим ingredients, если они есть
    let parsedIngredients = [];
    try {
      parsedIngredients = typeof ingredients === 'string' ? JSON.parse(ingredients) : ingredients;
    } catch (error) {
      console.error('Ошибка при парсинге ingredients:', error);
      parsedIngredients = [];
    }

    const [result] = await pool.query(
      'UPDATE dishes SET name = ?, calories_per_100 = ?, proteins_per_100 = ?, carbs_per_100 = ?, fats_per_100 = ?, instruction = ?, video_url = ?, image_url = ?, unit = ? WHERE id = ?',
      [name, calories_per_100, proteins_per_100, carbs_per_100, fats_per_100, instruction, processedVideoUrl, image_url, unit, dishId]
    );

    if (result.affectedRows === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Блюдо не найдено' });
    }

    // Очистка старых связей
    await pool.query('DELETE FROM dish_meal_times WHERE dish_id = ?', [dishId]);
    await pool.query('DELETE FROM dish_ingredients WHERE dish_id = ?', [dishId]);

    // Вставка meal_times
    for (const mealTime of parsedMealTimes) {
      await pool.query(
        'INSERT INTO dish_meal_times (dish_id, meal_time) VALUES (?, ?)',
        [dishId, mealTime]
      );
    }

    // Вставка ингредиентов, если они есть
    if (Array.isArray(parsedIngredients) && parsedIngredients.length > 0) {
      for (const ingredient of parsedIngredients) {
        if (!ingredient.ingredient_id || !ingredient.amount) continue;
        await pool.query(
          'INSERT INTO dish_ingredients (dish_id, ingredient_id, amount, unit) VALUES (?, ?, ?, ?)',
          [dishId, ingredient.ingredient_id, ingredient.amount, ingredient.unit]
        );
      }
    }

    await pool.query('COMMIT');

    // Получение обновленных данных
    const [dishes] = await pool.query(`
      SELECT d.*, 
        GROUP_CONCAT(DISTINCT dmt.meal_time) AS meal_times,
        JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', di.id,
            'ingredient_id', i.id,
            'name', i.name,
            'amount', di.amount,
            'unit', di.unit
          )
        ) AS ingredients
      FROM dishes d
      LEFT JOIN dish_meal_times dmt ON d.id = dmt.dish_id
      LEFT JOIN dish_ingredients di ON d.id = di.dish_id
      LEFT JOIN ingredients i ON di.ingredient_id = i.id
      WHERE d.id = ?
      GROUP BY d.id
    `, [dishId]);

    if (!dishes[0]) {
      return res.status(404).json({ error: 'Блюдо не найдено после обновления' });
    }

    const dish = {
      ...dishes[0],
      meal_times: dishes[0].meal_times ? dishes[0].meal_times.split(',') : [],
      ingredients: (() => {
        try {
          const parsed = JSON.parse(dishes[0].ingredients);
          return Array.isArray(parsed) ? parsed.filter(i => i && i.id !== null) : [];
        } catch {
          return [];
        }
      })()
    };

    res.json(dish);
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Ошибка при обновлении блюда:', error);
    res.status(500).json({ error: 'Ошибка при обновлении блюда' });
  }
});

// Удаление блюда
router.delete('/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM dishes WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Блюдо не найдено' });
    }
    res.json({ message: 'Блюдо успешно удалено' });
  } catch (error) {
    console.error('Ошибка при удалении блюда:', error);
    res.status(500).json({ error: 'Ошибка при удалении блюда' });
  }
});

module.exports = router; 