const mongoose = require('mongoose');
const seedProducts = require('./products.seeder');
const seedOrders = require('./orders.seeder');

async function runSeeders() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/rest-api-advanced');
    console.log('Connected to MongoDB');
    
    console.log('\n========== Running Product Seeder ==========');
    await seedProducts();
    
    console.log('\n========== Running Order Seeder ==========');
    await seedOrders();
    
    console.log('\n========== All Seeders Completed ==========');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
}

// Run seeders if called directly
if (require.main === module) {
  runSeeders();
}

module.exports = { seedProducts, seedOrders, runSeeders };