const express = require('express');
const cors = require('cors');
const pool = require('./config');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
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

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ингредиенты
app.get('/api/ingredients', async (req, res) => {
  try {
    const [ingredients] = await pool.query('SELECT * FROM ingredients ORDER BY name');
    res.json(ingredients);
  } catch (error) {
    console.error('Ошибка при получении ингредиентов:', error);
    res.status(500).json({ error: 'Ошибка при получении ингредиентов' });
  }
});

app.post('/api/ingredients', async (req, res) => {
  const { name, calories_per_100, proteins_per_100, fats_per_100, carbs_per_100 } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Необходимо указать название ингредиента' });
  }

  try {
    const [result] = await pool.query(
      'INSERT INTO ingredients (name, calories_per_100, proteins_per_100, fats_per_100, carbs_per_100) VALUES (?, ?, ?, ?, ?)',
      [name, calories_per_100, proteins_per_100, fats_per_100, carbs_per_100]
    );
    res.status(201).json({ id: result.insertId, name, calories_per_100, proteins_per_100, fats_per_100, carbs_per_100 });
  } catch (error) {
    console.error('Ошибка при создании ингредиента:', error);
    res.status(500).json({ error: 'Ошибка при создании ингредиента' });
  }
});

app.put('/api/ingredients/:id', async (req, res) => {
  const { name, calories_per_100, proteins_per_100, fats_per_100, carbs_per_100 } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Необходимо указать название ингредиента' });
  }

  try {
    const [result] = await pool.query(
      'UPDATE ingredients SET name = ?, calories_per_100 = ?, proteins_per_100 = ?, fats_per_100 = ?, carbs_per_100 = ? WHERE id = ?',
      [name, calories_per_100, proteins_per_100, fats_per_100, carbs_per_100, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Ингредиент не найден' });
    }
    res.json({ id: req.params.id, name, calories_per_100, proteins_per_100, fats_per_100, carbs_per_100 });
  } catch (error) {
    console.error('Ошибка при обновлении ингредиента:', error);
    res.status(500).json({ error: 'Ошибка при обновлении ингредиента' });
  }
});

app.delete('/api/ingredients/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM ingredients WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Ингредиент не найден' });
    }
    res.json({ message: 'Ингредиент успешно удален' });
  } catch (error) {
    console.error('Ошибка при удалении ингредиента:', error);
    res.status(500).json({ error: 'Ошибка при удалении ингредиента' });
  }
});

// Блюда
app.get('/api/dishes', async (req, res) => {
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

app.post('/api/dishes', upload.single('image'), async (req, res) => {
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

app.put('/api/dishes/:id', upload.single('image'), async (req, res) => {

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
        const oldImagePath = path.join(__dirname, currentDish[0].image_url);
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

app.delete('/api/dishes/:id', async (req, res) => {
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

// Пользователи
app.get('/api/users', async (req, res) => {
  try {
    const [users] = await pool.query('SELECT * FROM users ORDER BY name');
    res.json(users);
  } catch (error) {
    console.error('Ошибка при получении пользователей:', error);
    res.status(500).json({ error: 'Ошибка при получении пользователей' });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (users.length === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json(users[0]);
  } catch (error) {
    console.error('Ошибка при получении пользователя:', error);
    res.status(500).json({ error: 'Ошибка при получении пользователя' });
  }
});

app.post('/api/users', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Необходимо указать имя и email' });
  }

  try {
    const [result] = await pool.query('INSERT INTO users (name, email) VALUES (?, ?)', [name, email]);
    res.status(201).json({ id: result.insertId, name, email });
  } catch (error) {
    console.error('Ошибка при создании пользователя:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Пользователь с таким email уже существует' });
    } else {
      res.status(500).json({ error: 'Ошибка при создании пользователя' });
    }
  }
});

app.put('/api/users/:id', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'Необходимо указать имя и email' });
  }

  try {
    const [result] = await pool.query(
      'UPDATE users SET name = ?, email = ? WHERE id = ?',
      [name, email, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json({ id: req.params.id, name, email });
  } catch (error) {
    console.error('Ошибка при обновлении пользователя:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(409).json({ error: 'Пользователь с таким email уже существует' });
    } else {
      res.status(500).json({ error: 'Ошибка при обновлении пользователя' });
    }
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    res.json({ message: 'Пользователь успешно удален' });
  } catch (error) {
    console.error('Ошибка при удалении пользователя:', error);
    res.status(500).json({ error: 'Ошибка при удалении пользователя' });
  }
});

// Планы питания
app.get('/api/meal_plans', async (req, res) => {
  const userId = req.query.user_id;

  try {
    let query = 'SELECT mp.*, u.name as user_name FROM meal_plans mp LEFT JOIN users u ON mp.user_id = u.id';
    let params = [];

    if (userId) {
      query += ' WHERE mp.user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY mp.date DESC';

    const [plans] = await pool.query(query, params);
    res.json(plans);
  } catch (error) {
    console.error('Ошибка при получении планов питания:', error);
    res.status(500).json({ error: 'Ошибка при получении планов питания' });
  }
});

app.get('/api/meal_plans/:id', async (req, res) => {
  try {
    const [plans] = await pool.query(
      'SELECT mp.*, n.name as nutritionist_name FROM meal_plans mp LEFT JOIN nutritionists n ON mp.nutritionist_id = n.id WHERE mp.id = ?',
      [req.params.id]
    );

    if (plans.length === 0) {
      return res.status(404).json({ error: 'План питания не найден' });
    }

    res.json(plans[0]);
  } catch (error) {
    console.error('Ошибка при получении плана питания:', error);
    res.status(500).json({ error: 'Ошибка при получении плана питания' });
  }
});

app.post('/api/meal_plans', async (req, res) => {
  const { user_id, date } = req.body;
  if (!user_id || !date) {
    return res.status(400).json({ error: 'Необходимо указать ID пользователя и дату' });
  }

  try {
    // Проверяем, существует ли уже план на эту дату
    const [existing] = await pool.query(
      'SELECT id FROM meal_plans WHERE user_id = ? AND date = ?',
      [user_id, date]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'План на эту дату уже существует' });
    }

    const [result] = await pool.query(
      'INSERT INTO meal_plans (user_id, date) VALUES (?, ?)',
      [user_id, date]
    );
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    console.error('Ошибка при создании плана питания:', error);
    res.status(500).json({ error: 'Ошибка при создании плана питания' });
  }
});

app.delete('/api/meal_plans/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM meal_plans WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'План питания не найден' });
    }
    res.json({ message: 'План питания успешно удален' });
  } catch (error) {
    console.error('Ошибка при удалении плана питания:', error);
    res.status(500).json({ error: 'Ошибка при удалении плана питания' });
  }
});

// Копирование плана питания
app.post('/api/meal_plans/copy', async (req, res) => {
  const { user_id, source_plan_id, target_plan_id } = req.body;
  
  // Начинаем транзакцию
  await pool.query('START TRANSACTION');

  try {
    // Проверяем существование целевого плана
    const [targetPlan] = await pool.query(
      'SELECT id FROM meal_plans WHERE id = ?',
      [target_plan_id]
    );

    if (!targetPlan.length) {
      throw new Error('Целевой план не найден');
    }

    // Удаляем существующие блоки в целевом плане
    await pool.query('DELETE FROM meal_blocks WHERE plan_id = ?', [target_plan_id]);

    // Копируем блоки питания
    const [copyBlocksResult] = await pool.query(
      `
        INSERT INTO meal_blocks (plan_id, type, time_start, time_end)
        SELECT ?, type, time_start, time_end
        FROM meal_blocks
        WHERE plan_id = ?
      `,
      [target_plan_id, source_plan_id]
    );

    // Получаем ID новых блоков
    const [getNewBlocksResult] = await pool.query(
      'SELECT id FROM meal_blocks WHERE plan_id = ? ORDER BY id',
      [target_plan_id]
    );

    // Получаем старые блоки для сопоставления
    const [getOldBlocksResult] = await pool.query(
      'SELECT id FROM meal_blocks WHERE plan_id = ? ORDER BY id',
      [source_plan_id]
    );

    // Копируем блюда для каждого блока
    for (let i = 0; i < getOldBlocksResult.length; i++) {
      const oldBlockId = getOldBlocksResult[i].id;
      const newBlockId = getNewBlocksResult[i].id;

      // Получаем все блюда из старого блока
      const [oldMealItems] = await pool.query(
        'SELECT dish_id, amount, note FROM meal_items WHERE block_id = ?',
        [oldBlockId]
      );

      // Копируем каждое блюдо в новый блок
      for (const mealItem of oldMealItems) {
        await pool.query(
          'INSERT INTO meal_items (block_id, dish_id, amount, note) VALUES (?, ?, ?, ?)',
          [newBlockId, mealItem.dish_id, mealItem.amount, mealItem.note]
        );
      }
    }

    await pool.query('COMMIT');
    res.json({ 
      id: target_plan_id,
      message: 'План успешно скопирован' 
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Ошибка при копировании плана:', error);
    res.status(500).json({ error: 'Ошибка при копировании плана' });
  }
});

// Блоки питания
app.get('/api/meal_blocks', async (req, res) => {
  const planId = req.query.plan_id;
  if (!planId) {
    return res.status(400).json({ error: 'Не указан ID плана питания' });
  }

  try {
    // Проверяем существование плана
    const [plans] = await pool.query('SELECT id FROM meal_plans WHERE id = ?', [planId]);

    if (plans.length === 0) {
      return res.status(404).json({ error: 'План питания не найден' });
    }

    const [blocks] = await pool.query(
      'SELECT * FROM meal_blocks WHERE plan_id = ? ORDER BY time_start',
      [planId]
    );

    // Форматируем время в формат HH:mm
    const formattedBlocks = blocks.map(block => ({
      ...block,
      time_start: block.time_start.split(':').slice(0, 2).join(':'),
      time_end: block.time_end.split(':').slice(0, 2).join(':')
    }));

    res.json(formattedBlocks);
  } catch (error) {
    console.error('Ошибка при получении блоков питания:', error);
    res.status(500).json({ error: 'Ошибка при получении блоков питания' });
  }
});

app.post('/api/meal_blocks', async (req, res) => {
  const { plan_id, type, time_start, time_end, dishes } = req.body;

  // Форматируем время в формат HH:mm
  const formatTime = (time) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':');
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  };

  const formattedTimeStart = formatTime(time_start);
  const formattedTimeEnd = formatTime(time_end);

  // Валидация обязательных полей
  if (!plan_id || !type || !formattedTimeStart || !formattedTimeEnd) {
    return res.status(400).json({
      error: 'Необходимо указать ID плана, тип, время начала и окончания',
      details: {
        plan_id: !plan_id ? 'ID плана обязателен' : null,
        type: !type ? 'Тип блока обязателен' : null,
        time_start: !formattedTimeStart ? 'Время начала обязательно' : null,
        time_end: !formattedTimeEnd ? 'Время окончания обязательно' : null
      }
    });
  }

  try {
    await pool.query('START TRANSACTION');

    // Проверяем существование плана
    const [plans] = await pool.query('SELECT id FROM meal_plans WHERE id = ?', [plan_id]);
    if (plans.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'План питания не найден' });
    }

    // Проверяем пересечение временных интервалов
    const [overlapping] = await pool.query(
      `SELECT id, type, time_start, time_end FROM meal_blocks 
       WHERE plan_id = ? 
       AND (
         (time_start <= ? AND time_end > ?) OR
         (time_start < ? AND time_end >= ?) OR
         (time_start >= ? AND time_end <= ?)
       )`,
      [plan_id, formattedTimeStart, formattedTimeStart, formattedTimeEnd, formattedTimeEnd, formattedTimeStart, formattedTimeEnd]
    );

    if (overlapping.length > 0) {
      await pool.query('ROLLBACK');
      const block = overlapping[0];
      return res.status(409).json({
        error: 'Временной интервал пересекается с существующим блоком',
        details: {
          existing_block: {
            type: block.type,
            time_start: block.time_start,
            time_end: block.time_end
          },
          new_block: {
            type,
            time_start: formattedTimeStart,
            time_end: formattedTimeEnd
          }
        }
      });
    }

    // Вставляем блок
    const [result] = await pool.query(
      'INSERT INTO meal_blocks (plan_id, type, time_start, time_end) VALUES (?, ?, ?, ?)',
      [plan_id, type, formattedTimeStart, formattedTimeEnd]
    );
    const blockId = result.insertId;

    // Вставляем блюда, если есть
    let addedDishes = [];
    if (Array.isArray(dishes) && dishes.length > 0) {
      for (const dish of dishes) {
        // dish: {dish_id, amount, note}
        await pool.query(
          'INSERT INTO meal_items (block_id, dish_id, amount, note) VALUES (?, ?, ?, ?)',
          [blockId, dish.dish_id, dish.amount, dish.note]
        );
        addedDishes.push({ dish_id: dish.dish_id, amount: dish.amount, note: dish.note });
      }
    }

    await pool.query('COMMIT');
    res.status(201).json({
      id: blockId,
      plan_id,
      type,
      time_start,
      time_end,
      dishes: addedDishes
    });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Ошибка при создании блока питания:', error);
    res.status(500).json({ error: 'Ошибка при создании блока питания' });
  }
});

app.put('/api/meal_blocks/:id', async (req, res) => {
  const { type, time_start, time_end } = req.body;

  // Форматируем время в формат HH:mm
  const formatTime = (time) => {
    if (!time) return null;
    const [hours, minutes] = time.split(':');
    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  };

  const formattedTimeStart = formatTime(time_start);
  const formattedTimeEnd = formatTime(time_end);

  // Валидация обязательных полей
  if (!type || !formattedTimeStart || !formattedTimeEnd) {
    return res.status(400).json({
      error: 'Необходимо указать тип, время начала и окончания',
      details: {
        type: !type ? 'Тип блока обязателен' : null,
        time_start: !formattedTimeStart ? 'Время начала обязательно' : null,
        time_end: !formattedTimeEnd ? 'Время окончания обязательно' : null
      }
    });
  }

  try {
    // Получаем текущий блок для проверки plan_id
    const [currentBlock] = await pool.query('SELECT plan_id FROM meal_blocks WHERE id = ?', [req.params.id]);
    if (currentBlock.length === 0) {
      return res.status(404).json({ error: 'Блок питания не найден' });
    }

    // Проверяем пересечение временных интервалов (исключая текущий блок)
    const [overlapping] = await pool.query(
      `SELECT id FROM meal_blocks 
       WHERE plan_id = ? 
       AND id != ?
       AND (
         (time_start <= ? AND time_end > ?) OR
         (time_start < ? AND time_end >= ?) OR
         (time_start >= ? AND time_end <= ?)
       )`,
      [currentBlock[0].plan_id, req.params.id, formattedTimeStart, formattedTimeStart, formattedTimeEnd, formattedTimeEnd, formattedTimeStart, formattedTimeEnd]
    );

    if (overlapping.length > 0) {
      return res.status(409).json({ error: 'Временной интервал пересекается с существующим блоком' });
    }

    const [result] = await pool.query(
      'UPDATE meal_blocks SET type = ?, time_start = ?, time_end = ? WHERE id = ?',
      [type, formattedTimeStart, formattedTimeEnd, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Блок питания не найден' });
    }

    res.json({
      id: parseInt(req.params.id),
      plan_id: currentBlock[0].plan_id,
      type,
      time_start,
      time_end
    });
  } catch (error) {
    console.error('Ошибка при обновлении блока питания:', error);
    res.status(500).json({ error: 'Ошибка при обновлении блока питания' });
  }
});

app.delete('/api/meal_blocks/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM meal_blocks WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Блок питания не найден' });
    }
    res.json({ message: 'Блок питания успешно удален' });
  } catch (error) {
    console.error('Ошибка при удалении блока питания:', error);
    res.status(500).json({ error: 'Ошибка при удалении блока питания' });
  }
});

// Блюда в блоке
app.get('/api/meal_items', async (req, res) => {
  const blockId = req.query.block_id;
  if (!blockId) {
    return res.status(400).json({ error: 'Не указан ID блока питания' });
  }

  try {
    const [items] = await pool.query(`
      SELECT mi.*, mi.note, mi.amount, d.name as dish_name, 
        d.unit as unit,
        d.calories_per_100, d.proteins_per_100, d.carbs_per_100, d.fats_per_100,
        d.instruction, d.video_url, d.image_url
      FROM meal_items mi
      LEFT JOIN dishes d ON mi.dish_id = d.id
      WHERE mi.block_id = ?
    `, [blockId]);
    res.json(items);
  } catch (error) {
    console.error('Ошибка при получении блюд:', error);
    res.status(500).json({ error: 'Ошибка при получении блюд' });
  }
});

app.post('/api/meal_items', async (req, res) => {
  const { block_id, dish_id, amount, note } = req.body;
  if (!block_id) {
    return res.status(400).json({ error: 'Необходимо указать ID блока' });
  }
  if (!amount) {
    return res.status(400).json({ error: 'Необходимо указать количество' });
  }
  // dish_id может быть null для воды
  try {
    const [result] = await pool.query(
      'INSERT INTO meal_items (block_id, dish_id, amount, note) VALUES (?, ?, ?, ?)',
      [block_id, dish_id || null, amount, note]
    );
    res.status(201).json({ id: result.insertId });
  } catch (error) {
    console.error('Ошибка при создании блюда:', error);
    res.status(500).json({ error: 'Ошибка при создании блюда' });
  }
});

app.delete('/api/meal_items/:id', async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM meal_items WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Блюдо не найдено' });
    }
    res.json({ message: 'Блюдо успешно удалено' });
  } catch (error) {
    console.error('Ошибка при удалении блюда:', error);
    res.status(500).json({ error: 'Ошибка при удалении блюда' });
  }
});

// Добавить редактирование блюда в блоке
app.put('/api/meal_items/:id', async (req, res) => {
  const { amount, note } = req.body;
  if (amount === undefined && note === undefined) {
    return res.status(400).json({ error: 'Нет данных для обновления' });
  }
  try {
    const [result] = await pool.query(
      'UPDATE meal_items SET amount = IFNULL(?, amount), note = IFNULL(?, note) WHERE id = ?',
      [amount, note, req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Блюдо не найдено' });
    }
    res.json({ id: req.params.id, amount, note });
  } catch (error) {
    console.error('Ошибка при обновлении блюда:', error);
    res.status(500).json({ error: 'Ошибка при обновлении блюда' });
  }
});

// Аутентификация нутрициологов
app.post('/api/nutritionists/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Необходимо указать email и пароль' });
  }

  try {
    const [nutritionists] = await pool.query(
      'SELECT id, email, name FROM nutritionists WHERE email = ? AND password = ?',
      [email, password]
    );

    if (nutritionists.length === 0) {
      return res.status(401).json({ error: 'Неверный email или пароль' });
    }

    res.json(nutritionists[0]);
  } catch (error) {
    console.error('Ошибка при входе:', error);
    res.status(500).json({ error: 'Ошибка при входе в систему' });
  }
});

app.get('/api/nutritionists/profile', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }

  try {
    // В реальном приложении здесь должна быть проверка JWT токена
    const [nutritionists] = await pool.query(
      'SELECT id, email, name FROM nutritionists WHERE id = ?',
      [1] // В реальном приложении ID должен быть получен из токена
    );

    if (nutritionists.length === 0) {
      return res.status(404).json({ error: 'Нутрициолог не найден' });
    }

    res.json(nutritionists[0]);
  } catch (error) {
    console.error('Ошибка при получении профиля:', error);
    res.status(500).json({ error: 'Ошибка при получении профиля' });
  }
});

// Получение последнего веса пользователя до указанной даты
app.get('/api/weight_history/last', async (req, res) => {
  const { user_id, date } = req.query;
  
  if (!user_id || !date) {
    return res.status(400).json({ error: 'Необходимо указать ID пользователя и дату' });
  }

  try {
    const [weights] = await pool.query(
      'SELECT weight, recorded_at FROM weight_history WHERE user_id = ? AND recorded_at < ? ORDER BY recorded_at DESC LIMIT 1',
      [user_id, date]
    );

    if (weights.length === 0) {
      return res.status(404).json({ error: 'Записи о весе не найдены' });
    }

    res.json(weights[0]);
  } catch (error) {
    console.error('Ошибка при получении последнего веса:', error);
    res.status(500).json({ error: 'Ошибка при получении последнего веса' });
  }
});

// Получение всей истории веса пользователя
app.get('/api/weight_history', async (req, res) => {
  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(400).json({ error: 'Необходимо указать ID пользователя' });
  }

  try {
    const [weights] = await pool.query(
      'SELECT weight, recorded_at FROM weight_history WHERE user_id = ? ORDER BY recorded_at DESC',
      [user_id]
    );

    res.json(weights);
  } catch (error) {
    console.error('Ошибка при получении истории веса:', error);
    res.status(500).json({ error: 'Ошибка при получении истории веса' });
  }
});

// Получение суммарного КБЖУ по плану питания
app.get('/api/meal_plans/:id/nutrition', async (req, res) => {
  try {
    // Сначала получаем список блюд по типам приема пищи
    const [mealTypes] = await pool.query(`
      SELECT 
        CASE mb.type
          WHEN 'breakfast' THEN 'Завтрак'
          WHEN 'lunch' THEN 'Обед'
          WHEN 'dinner' THEN 'Ужин'
          WHEN 'snack' THEN 'Перекус'
          ELSE mb.type
        END as type,
        GROUP_CONCAT(
          CONCAT(
            d.name, ' (', mi.amount, ' г)',
            ' [', 
            ROUND((mi.amount / 100) * d.calories_per_100), ', ',
            ROUND((mi.amount / 100) * d.proteins_per_100), ', ',
            ROUND((mi.amount / 100) * d.fats_per_100), ', ',
            ROUND((mi.amount / 100) * d.carbs_per_100),
            ']'
          )
          SEPARATOR ' | '
        ) as dishes
      FROM meal_plans mp
      LEFT JOIN meal_blocks mb ON mp.id = mb.plan_id
      LEFT JOIN meal_items mi ON mb.id = mi.block_id
      LEFT JOIN dishes d ON mi.dish_id = d.id
      WHERE mp.id = ?
        AND mi.id IS NOT NULL
      GROUP BY mb.type
      HAVING dishes IS NOT NULL
    `, [req.params.id]);

    // Затем получаем суммарное КБЖУ
    const [nutrition] = await pool.query(`
      SELECT 
        COALESCE(ROUND(SUM((mi.amount / 100) * d.calories_per_100)), 0) as total_calories,
        COALESCE(ROUND(SUM((mi.amount / 100) * d.proteins_per_100)), 0) as total_proteins,
        COALESCE(ROUND(SUM((mi.amount / 100) * d.fats_per_100)), 0) as total_fats,
        COALESCE(ROUND(SUM((mi.amount / 100) * d.carbs_per_100)), 0) as total_carbs
      FROM meal_plans mp
      LEFT JOIN meal_blocks mb ON mp.id = mb.plan_id
      LEFT JOIN meal_items mi ON mb.id = mi.block_id
      LEFT JOIN dishes d ON mi.dish_id = d.id
      WHERE mp.id = ?
        AND mi.id IS NOT NULL
    `, [req.params.id]);

    if (!nutrition) {
      return res.status(404).json({ error: 'План питания не найден' });
    }

    // Форматируем типы приема пищи
    const mealTypesFormatted = mealTypes.length > 0
      ? mealTypes.map(mt => `${mt.type}: ${mt.dishes}`).join(' | ')
      : 'Нет блюд';

    // Округляем значения до целых чисел (на всякий случай)
    const formattedNutrition = {
      ...nutrition[0],
      total_calories: Math.round(nutrition[0].total_calories),
      total_proteins: Math.round(nutrition[0].total_proteins),
      total_fats: Math.round(nutrition[0].total_fats),
      total_carbs: Math.round(nutrition[0].total_carbs),
      meal_types: mealTypesFormatted
    };

    res.json(formattedNutrition);
  } catch (error) {
    console.error('Ошибка при получении КБЖУ:', error);
    res.status(500).json({ error: 'Ошибка при получении КБЖУ' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
}); 