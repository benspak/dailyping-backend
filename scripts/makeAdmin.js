require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const user = await User.findOneAndUpdate(
    { email: 'benvspak@gmail.com' },
    { isAdmin: true },
    { new: true }
  );
  console.log('✅ Updated user:', user);
  mongoose.disconnect();
});
