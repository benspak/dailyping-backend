require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

(async () => {
  try {
    console.log('🔍 Connecting with MONGO_URI:', process.env.MONGO_URI);
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const users = await User.find({ 'preferences.pro': { $exists: true } });

    for (const user of users) {
      const wasPro = user.preferences?.pro ?? false;
      user.pro = wasPro;

      // Optional: delete nested value to clean up
      if (user.preferences) {
        delete user.preferences.pro;
      }

      await user.save();
      console.log(`🔄 Updated ${user.email} → pro: ${wasPro}`);
    }

    console.log(`🎉 Migration complete for ${users.length} user(s)`);
    mongoose.disconnect();
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
})();
