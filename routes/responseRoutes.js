const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/authenticateToken');
const Response = require('../models/Response');

router.patch('/subtasks/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { subTasks } = req.body;

    const updated = await Response.findOneAndUpdate(
      { _id: id, userId: req.user.id },
      { $set: { subTasks } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ error: 'Response not found' });
    res.json({ message: 'Subtasks updated', response: updated });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Failed to update subtasks' });
  }
});

module.exports = router;
