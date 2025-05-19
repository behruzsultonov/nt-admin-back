const express = require('express');
const router = express.Router();
const pool = require('../config');

// Получение всех пользователей
router.get('/', async (req, res) => {
  try {
    const [users] = await pool.query('SELECT * FROM users ORDER BY name');
    res.json(users);
  } catch (error) {
    console.error('Ошибка при получении пользователей:', error);
    res.status(500).json({ error: 'Ошибка при получении пользователей' });
  }
});

// Получение пользователя по ID
router.get('/:id', async (req, res) => {
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

// Создание пользователя
router.post('/', async (req, res) => {
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

// Обновление пользователя
router.put('/:id', async (req, res) => {
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

// Удаление пользователя
router.delete('/:id', async (req, res) => {
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

module.exports = router; 