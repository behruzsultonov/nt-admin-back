const express = require('express');
const router = express.Router();
const pool = require('../config');

// Аутентификация нутрициологов
router.post('/login', async (req, res) => {
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

// Получение профиля нутрициолога
router.get('/profile', async (req, res) => {
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

module.exports = router; 