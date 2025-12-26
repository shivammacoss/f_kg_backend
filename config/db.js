const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Ensure data directories exist
const DATA_DIR = path.join(__dirname, '../data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');

[DATA_DIR, BACKUP_DIR, EXPORT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// MongoDB Connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    
    // Log connection info for migration reference
    logConnectionInfo(conn);
    
    return conn;
  } catch (error) {
    console.error(`MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

// Log connection info to file for migration reference
const logConnectionInfo = (conn) => {
  const info = {
    host: conn.connection.host,
    port: conn.connection.port,
    name: conn.connection.name,
    timestamp: new Date().toISOString()
  };
  
  const infoPath = path.join(DATA_DIR, 'connection_info.json');
  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));
};

// Export all collections to JSON files for easy migration
const exportAllCollections = async () => {
  try {
    const collections = await mongoose.connection.db.listCollections().toArray();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const exportPath = path.join(EXPORT_DIR, `export_${timestamp}`);
    
    if (!fs.existsSync(exportPath)) {
      fs.mkdirSync(exportPath, { recursive: true });
    }

    const exportManifest = {
      timestamp: new Date().toISOString(),
      database: mongoose.connection.name,
      collections: []
    };

    for (const collection of collections) {
      const collectionName = collection.name;
      const data = await mongoose.connection.db.collection(collectionName).find({}).toArray();
      
      const filePath = path.join(exportPath, `${collectionName}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      
      exportManifest.collections.push({
        name: collectionName,
        count: data.length,
        file: `${collectionName}.json`
      });
      
      console.log(`Exported ${data.length} documents from ${collectionName}`);
    }

    // Write manifest file
    fs.writeFileSync(
      path.join(exportPath, 'manifest.json'),
      JSON.stringify(exportManifest, null, 2)
    );

    console.log(`Export completed: ${exportPath}`);
    return exportPath;
  } catch (error) {
    console.error('Export error:', error);
    throw error;
  }
};

// Import collections from JSON files (for migration)
const importFromExport = async (exportPath) => {
  try {
    const manifestPath = path.join(exportPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Manifest file not found');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    for (const collectionInfo of manifest.collections) {
      const filePath = path.join(exportPath, collectionInfo.file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      if (data.length > 0) {
        const collection = mongoose.connection.db.collection(collectionInfo.name);
        
        // Clear existing data (optional - comment out if you want to merge)
        await collection.deleteMany({});
        
        // Insert imported data
        await collection.insertMany(data);
        console.log(`Imported ${data.length} documents to ${collectionInfo.name}`);
      }
    }

    console.log('Import completed successfully');
  } catch (error) {
    console.error('Import error:', error);
    throw error;
  }
};

// Create a backup (wrapper around export)
const createBackup = async () => {
  return await exportAllCollections();
};

module.exports = {
  connectDB,
  exportAllCollections,
  importFromExport,
  createBackup,
  DATA_DIR,
  BACKUP_DIR,
  EXPORT_DIR
};
