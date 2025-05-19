const express = require('express');
const router = express.Router();
const pool = require('../config');

// Получение последнего веса пользователя до указанной даты
router.get('/last', async (req, res) => {
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
router.get('/', async (req, res) => {
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

module.exports = router; 