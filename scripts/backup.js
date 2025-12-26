/**
 * Database Backup Script
 * Run: npm run backup
 * 
 * This script exports all MongoDB collections to JSON files
 * for easy migration from local to production
 */

require('dotenv').config();
const { connectDB, exportAllCollections } = require('../config/db');

const runBackup = async () => {
  try {
    console.log('Starting database backup...');
    
    // Connect to database
    await connectDB();
    
    // Export all collections
    const backupPath = await exportAllCollections();
    
    console.log(`\nBackup completed successfully!`);
    console.log(`Backup location: ${backupPath}`);
    console.log(`\nTo restore this backup on production:`);
    console.log(`1. Copy the backup folder to your production server`);
    console.log(`2. Update MONGODB_URI in .env to point to production DB`);
    console.log(`3. Run: npm run restore -- --path=${backupPath}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Backup failed:', error);
    process.exit(1);
  }
};

runBackup();
