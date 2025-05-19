const express = require('express');
const router = express.Router();
const pool = require('../config');

// Получение всех планов питания
router.get('/', async (req, res) => {
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

// Получение плана питания по ID
router.get('/:id', async (req, res) => {
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

// Создание нового плана питания
router.post('/', async (req, res) => {
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

// Удаление плана питания
router.delete('/:id', async (req, res) => {
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
router.post('/copy', async (req, res) => {
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

// Получение суммарного КБЖУ по плану питания
router.get('/:id/nutrition', async (req, res) => {
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

module.exports = router; 