#!/usr/bin/env node
/**
 * Password Reset Utility for Forex KG
 * 
 * Usage:
 *   node scripts/resetPassword.js --type admin --email admin@Forex KG.com --password NewPassword123
 *   node scripts/resetPassword.js --type user --email demo@demo.com --password demo123
 *   node scripts/resetPassword.js --hash MyPlainPassword  (just generate hash)
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const args = process.argv.slice(2);

function getArg(name) {
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : null;
}

async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(12);
  return await bcrypt.hash(plainPassword, salt);
}

async function resetPassword(type, email, password) {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/Forex KG_trading');
    
    const collection = type === 'admin' ? 'admins' : 'users';
    const hashedPassword = await hashPassword(password);
    
    const result = await mongoose.connection.db.collection(collection).updateOne(
      { email: email.toLowerCase() },
      { $set: { password: hashedPassword, updatedAt: new Date() } }
    );
    
    if (result.matchedCount === 0) {
      console.log(`❌ No ${type} found with email: ${email}`);
    } else if (result.modifiedCount > 0) {
      console.log(`✅ Password reset successful for ${type}: ${email}`);
      console.log(`   New password: ${password}`);
    } else {
      console.log(`⚠️  No changes made (password may be the same)`);
    }
    
    await mongoose.disconnect();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

async function main() {
  // Just hash a password
  const hashOnly = getArg('hash');
  if (hashOnly) {
    const hashed = await hashPassword(hashOnly);
    console.log(`\nPlain password: ${hashOnly}`);
    console.log(`Hashed password: ${hashed}`);
    console.log(`\nYou can use this hash directly in MongoDB.`);
    return;
  }

  const type = getArg('type');
  const email = getArg('email');
  const password = getArg('password');

  if (!type || !email || !password) {
    console.log(`
Forex KG Password Reset Utility
==============================

Usage:
  Reset admin password:
    node scripts/resetPassword.js --type admin --email admin@Forex KG.com --password Admin@123

  Reset user password:
    node scripts/resetPassword.js --type user --email demo@demo.com --password demo123

  Generate password hash (for manual DB update):
    node scripts/resetPassword.js --hash YourPassword123

Options:
  --type      Type of account: 'admin' or 'user'
  --email     Email of the account
  --password  New plain-text password (will be hashed)
  --hash      Just generate a bcrypt hash for a password
    `);
    return;
  }

  if (type !== 'admin' && type !== 'user') {
    console.log('❌ Type must be "admin" or "user"');
    return;
  }

  await resetPassword(type, email, password);
}

main();
