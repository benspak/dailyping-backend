// scripts/migrateProField.js
const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const users = await User.find({});
    let updatedCount = 0;

    for (const user of users) {
      if (user.pro === true) {
        user.pro = 'active';
        await user.save();
        updatedCount++;
        console.log(`🔄 Updated ${user.username} → pro: 'active'`);
      } else if (user.pro === false) {
        user.pro = 'inactive';
        await user.save();
        updatedCount++;
        console.log(`🔄 Updated ${user.username} → pro: 'inactive'`);
      }
    }

    console.log(`✅ Migration complete. ${updatedCount} users updated.`);
    process.exit();
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
})();
