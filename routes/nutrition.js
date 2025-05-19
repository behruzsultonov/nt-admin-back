const express = require('express');
const router = express.Router();
const pool = require('../config');

// Получение суммарного КБЖУ по плану питания
router.get('/meal_plans/:id', async (req, res) => {
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