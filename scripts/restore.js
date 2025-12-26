/**
 * Database Restore Script
 * Run: npm run restore -- --path=./data/exports/export_TIMESTAMP
 * 
 * This script imports JSON files back into MongoDB
 * Use this when migrating from local to production
 */

require('dotenv').config();
const path = require('path');
const { connectDB, importFromExport } = require('../config/db');

const runRestore = async () => {
  try {
    // Get path from command line arguments
    const args = process.argv.slice(2);
    let exportPath = null;
    
    for (const arg of args) {
      if (arg.startsWith('--path=')) {
        exportPath = arg.split('=')[1];
      }
    }
    
    if (!exportPath) {
      console.error('Please provide the export path:');
      console.error('npm run restore -- --path=./data/exports/export_TIMESTAMP');
      process.exit(1);
    }
    
    // Resolve to absolute path
    exportPath = path.resolve(exportPath);
    
    console.log(`Starting database restore from: ${exportPath}`);
    console.log('WARNING: This will overwrite existing data!');
    console.log('Press Ctrl+C within 5 seconds to cancel...\n');
    
    // Give user time to cancel
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Connect to database
    await connectDB();
    
    // Import from export
    await importFromExport(exportPath);
    
    console.log('\nRestore completed successfully!');
    
    process.exit(0);
  } catch (error) {
    console.error('Restore failed:', error);
    process.exit(1);
  }
};

runRestore();
