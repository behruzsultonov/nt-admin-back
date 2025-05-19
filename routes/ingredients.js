const express = require('express');
const router = express.Router();
const pool = require('../config');

// Получение всех ингредиентов
router.get('/', async (req, res) => {
  try {
    const [ingredients] = await pool.query('SELECT * FROM ingredients ORDER BY name');
    res.json(ingredients);
  } catch (error) {
    console.error('Ошибка при получении ингредиентов:', error);
    res.status(500).json({ error: 'Ошибка при получении ингредиентов' });
  }
});

// Создание ингредиента
router.post('/', async (req, res) => {
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

// Обновление ингредиента
router.put('/:id', async (req, res) => {
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

// Удаление ингредиента
router.delete('/:id', async (req, res) => {
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

module.exports = router; 