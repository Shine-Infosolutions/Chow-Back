const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

const createAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chowdhry');
    
    const adminExists = await User.findOne({ role: 'admin' });
    if (adminExists) {
      console.log('Admin already exists');
      return;
    }

    const admin = new User({
      name: 'Admin',
      email: 'admin@chowdhry.com',
      password: 'admin123',
      phone: '1234567890',
      role: 'admin'
    });

    await admin.save();
    console.log('Admin created successfully');
    console.log('Email: admin@chowdhry.com');
    console.log('Password: admin123');
    
  } catch (error) {
    console.error('Error creating admin:', error);
  } finally {
    mongoose.connection.close();
  }
};

createAdmin();