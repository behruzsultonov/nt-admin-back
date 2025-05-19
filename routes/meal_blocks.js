const express = require('express');
const router = express.Router();
const pool = require('../config');

// Получение блоков питания
router.get('/', async (req, res) => {
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

// Создание блока питания
router.post('/', async (req, res) => {
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

// Обновление блока питания
router.put('/:id', async (req, res) => {
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

// Удаление блока питания
router.delete('/:id', async (req, res) => {
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

module.exports = router; 