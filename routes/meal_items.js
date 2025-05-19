const express = require('express');
const router = express.Router();
const pool = require('../config');

// Получение блюд в блоке
router.get('/', async (req, res) => {
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

// Добавление блюда в блок
router.post('/', async (req, res) => {
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

// Удаление блюда из блока
router.delete('/:id', async (req, res) => {
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

// Редактирование блюда в блоке
router.put('/:id', async (req, res) => {
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

module.exports = router; 