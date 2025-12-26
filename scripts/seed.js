/**
 * Database Seed Script
 * Run: node scripts/seed.js
 * 
 * Creates an admin user for initial setup
 */

require('dotenv').config();
const { connectDB } = require('../config/db');
const User = require('../models/User');

const seedAdmin = async () => {
  try {
    await connectDB();
    
    // Check if admin already exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    
    if (existingAdmin) {
      console.log('Admin user already exists:');
      console.log(`Email: ${existingAdmin.email}`);
      process.exit(0);
    }
    
    // Create admin user
    const admin = await User.create({
      email: 'admin@Forex KG.com',
      password: 'admin123456',
      firstName: 'Admin',
      lastName: 'Forex KG',
      role: 'admin',
      isActive: true,
      isVerified: true,
      balance: 0
    });
    
    console.log('Admin user created successfully!');
    console.log('Email: admin@Forex KG.com');
    console.log('Password: admin123456');
    console.log('\nPlease change the password after first login!');
    
    process.exit(0);
  } catch (error) {
    console.error('Seed failed:', error);
    process.exit(1);
  }
};

seedAdmin();
