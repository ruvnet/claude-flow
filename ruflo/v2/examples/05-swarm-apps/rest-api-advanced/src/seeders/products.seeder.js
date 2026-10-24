const mongoose = require('mongoose');
const Product = require('../models/product.model');
const User = require('../models/User');
const bcrypt = require('bcrypt');

const categories = [
  'Electronics',
  'Clothing',
  'Home & Garden',
  'Books',
  'Sports & Outdoors',
  'Toys & Games',
  'Health & Beauty',
  'Food & Beverages',
];

const brands = [
  'TechCorp',
  'FashionHub',
  'HomeStyle',
  'BookWorld',
  'SportsPro',
  'GameMaster',
  'HealthPlus',
  'GourmetFoods',
];

const productTemplates = [
  // Electronics
  {
    category: 'Electronics',
    products: [
      {
        name: 'Wireless Bluetooth Headphones',
        description: 'Premium noise-canceling wireless headphones with 30-hour battery life and superior sound quality.',
        price: 149.99,
        comparePrice: 199.99,
        brand: 'TechCorp',
        tags: ['wireless', 'bluetooth', 'headphones', 'audio'],
        specifications: [
          { key: 'Battery Life', value: '30 hours' },
          { key: 'Connectivity', value: 'Bluetooth 5.0' },
          { key: 'Noise Canceling', value: 'Active NC' },
        ],
      },
      {
        name: 'Smart Watch Pro',
        description: 'Advanced fitness tracking smart watch with heart rate monitor, GPS, and smartphone integration.',
        price: 299.99,
        comparePrice: 399.99,
        brand: 'TechCorp',
        tags: ['smartwatch', 'fitness', 'wearable'],
        specifications: [
          { key: 'Display', value: '1.4" AMOLED' },
          { key: 'Battery', value: '5 days' },
          { key: 'Water Resistance', value: '5 ATM' },
        ],
      },
      {
        name: '4K Webcam',
        description: 'Ultra HD webcam with auto-focus and built-in microphone for professional video calls.',
        price: 89.99,
        brand: 'TechCorp',
        tags: ['webcam', 'camera', 'video'],
        specifications: [
          { key: 'Resolution', value: '4K (3840x2160)' },
          { key: 'Frame Rate', value: '30fps' },
          { key: 'Field of View', value: '90°' },
        ],
      },
    ],
  },
  // Clothing
  {
    category: 'Clothing',
    products: [
      {
        name: 'Premium Cotton T-Shirt',
        description: 'Comfortable 100% organic cotton t-shirt with modern fit and sustainable production.',
        price: 24.99,
        comparePrice: 34.99,
        brand: 'FashionHub',
        tags: ['tshirt', 'cotton', 'casual', 'sustainable'],
        specifications: [
          { key: 'Material', value: '100% Organic Cotton' },
          { key: 'Fit', value: 'Modern Fit' },
          { key: 'Care', value: 'Machine Washable' },
        ],
      },
      {
        name: 'Denim Jeans Classic',
        description: 'Classic straight-fit denim jeans with stretch comfort and timeless style.',
        price: 59.99,
        brand: 'FashionHub',
        tags: ['jeans', 'denim', 'pants'],
        specifications: [
          { key: 'Material', value: '98% Cotton, 2% Elastane' },
          { key: 'Fit', value: 'Straight' },
          { key: 'Rise', value: 'Mid-Rise' },
        ],
      },
    ],
  },
  // Home & Garden
  {
    category: 'Home & Garden',
    products: [
      {
        name: 'Smart LED Bulb Set',
        description: 'WiFi-enabled RGB LED bulbs with app control and voice assistant compatibility.',
        price: 39.99,
        comparePrice: 59.99,
        brand: 'HomeStyle',
        tags: ['smart home', 'lighting', 'led', 'wifi'],
        specifications: [
          { key: 'Wattage', value: '10W (60W equivalent)' },
          { key: 'Colors', value: '16 Million' },
          { key: 'Lifespan', value: '25,000 hours' },
        ],
      },
      {
        name: 'Indoor Plant Collection',
        description: 'Set of 3 low-maintenance indoor plants perfect for home or office decoration.',
        price: 45.00,
        brand: 'HomeStyle',
        tags: ['plants', 'indoor', 'decoration'],
        specifications: [
          { key: 'Plants Included', value: 'Snake Plant, Pothos, ZZ Plant' },
          { key: 'Pot Size', value: '6 inches' },
          { key: 'Care Level', value: 'Low Maintenance' },
        ],
      },
    ],
  },
  // Books
  {
    category: 'Books',
    products: [
      {
        name: 'JavaScript: The Complete Guide',
        description: 'Comprehensive guide to modern JavaScript programming with practical examples and best practices.',
        price: 39.99,
        brand: 'BookWorld',
        tags: ['programming', 'javascript', 'education'],
        specifications: [
          { key: 'Pages', value: '850' },
          { key: 'Format', value: 'Paperback' },
          { key: 'Edition', value: '3rd Edition' },
        ],
      },
      {
        name: 'The Art of Cooking',
        description: 'Master chef\'s guide to culinary excellence with over 200 recipes and techniques.',
        price: 29.99,
        comparePrice: 45.00,
        brand: 'BookWorld',
        tags: ['cooking', 'recipes', 'culinary'],
        specifications: [
          { key: 'Pages', value: '400' },
          { key: 'Format', value: 'Hardcover' },
          { key: 'Recipes', value: '200+' },
        ],
      },
    ],
  },
  // Sports & Outdoors
  {
    category: 'Sports & Outdoors',
    products: [
      {
        name: 'Yoga Mat Premium',
        description: 'Extra thick non-slip yoga mat with alignment marks and carrying strap.',
        price: 34.99,
        brand: 'SportsPro',
        tags: ['yoga', 'fitness', 'exercise'],
        specifications: [
          { key: 'Thickness', value: '6mm' },
          { key: 'Material', value: 'TPE Eco-friendly' },
          { key: 'Size', value: '72" x 24"' },
        ],
      },
      {
        name: 'Camping Tent 4-Person',
        description: 'Waterproof family camping tent with easy setup and excellent ventilation.',
        price: 129.99,
        comparePrice: 179.99,
        brand: 'SportsPro',
        tags: ['camping', 'tent', 'outdoor'],
        specifications: [
          { key: 'Capacity', value: '4 Person' },
          { key: 'Season', value: '3-Season' },
          { key: 'Setup Time', value: '5 minutes' },
        ],
      },
    ],
  },
];

async function seedProducts() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/rest-api-advanced');
    
    console.log('Connected to MongoDB');
    
    // Clear existing products
    await Product.deleteMany({});
    console.log('Cleared existing products');
    
    // Create admin user if not exists
    let adminUser = await User.findOne({ email: 'admin@example.com' });
    if (!adminUser) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      adminUser = await User.create({
        email: 'admin@example.com',
        password: hashedPassword,
        name: 'Admin User',
        role: 'admin',
        isEmailVerified: true,
      });
      console.log('Created admin user');
    }
    
    // Create products
    const products = [];
    let totalProducts = 0;
    
    for (const template of productTemplates) {
      for (const productData of template.products) {
        // Generate multiple variants for some products
        const baseProduct = {
          ...productData,
          category: template.category,
          subcategory: productData.subcategory || template.category,
          sku: `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`.toUpperCase(),
          inventory: {
            quantity: Math.floor(Math.random() * 100) + 20,
            trackInventory: true,
            allowBackorder: Math.random() > 0.8,
            lowStockThreshold: 10,
          },
          images: [
            {
              url: `https://picsum.photos/seed/${productData.name}/800/800`,
              alt: productData.name,
              isMain: true,
            },
            {
              url: `https://picsum.photos/seed/${productData.name}-2/800/800`,
              alt: `${productData.name} - View 2`,
              position: 1,
            },
            {
              url: `https://picsum.photos/seed/${productData.name}-3/800/800`,
              alt: `${productData.name} - View 3`,
              position: 2,
            },
          ],
          featured: Math.random() > 0.7,
          status: 'active',
          visibility: 'visible',
          vendor: adminUser._id,
          // Add some initial reviews
          reviews: generateRandomReviews(),
        };
        
        // Calculate rating statistics
        if (baseProduct.reviews.length > 0) {
          const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
          let totalRating = 0;
          
          baseProduct.reviews.forEach(review => {
            distribution[review.rating]++;
            totalRating += review.rating;
          });
          
          baseProduct.rating = {
            average: totalRating / baseProduct.reviews.length,
            count: baseProduct.reviews.length,
            distribution,
          };
        }
        
        products.push(baseProduct);
        totalProducts++;
      }
    }
    
    // Insert all products
    const createdProducts = await Product.insertMany(products);
    console.log(`Created ${totalProducts} products`);
    
    // Create relationships between products
    for (let i = 0; i < createdProducts.length; i++) {
      const product = createdProducts[i];
      const relatedProducts = [];
      
      // Find products in same category
      const sameCategory = createdProducts.filter(
        p => p.category === product.category && p._id.toString() !== product._id.toString()
      );
      
      // Add 3-5 related products
      const numRelated = Math.min(sameCategory.length, Math.floor(Math.random() * 3) + 3);
      for (let j = 0; j < numRelated; j++) {
        const randomIndex = Math.floor(Math.random() * sameCategory.length);
        const relatedProduct = sameCategory[randomIndex];
        if (!relatedProducts.includes(relatedProduct._id)) {
          relatedProducts.push(relatedProduct._id);
        }
      }
      
      product.relatedProducts = relatedProducts;
      await product.save();
    }
    
    console.log('Added related products relationships');
    
    // Display summary
    const summary = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          avgPrice: { $avg: '$price' },
          totalInventory: { $sum: '$inventory.quantity' },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    
    console.log('\nProduct Summary by Category:');
    console.table(summary.map(s => ({
      Category: s._id,
      Count: s.count,
      'Avg Price': `$${s.avgPrice.toFixed(2)}`,
      'Total Inventory': s.totalInventory,
    })));
    
    console.log('\nSeeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exit(1);
  }
}

function generateRandomReviews() {
  const reviews = [];
  const numReviews = Math.floor(Math.random() * 10) + 2; // 2-12 reviews
  
  const reviewTemplates = [
    { rating: 5, comments: ['Excellent product!', 'Highly recommended!', 'Perfect, exactly what I needed.', 'Outstanding quality!'] },
    { rating: 4, comments: ['Very good product.', 'Great value for money.', 'Happy with my purchase.', 'Good quality overall.'] },
    { rating: 3, comments: ['Decent product.', 'Average quality.', 'It\'s okay.', 'Could be better.'] },
    { rating: 2, comments: ['Not satisfied.', 'Below expectations.', 'Quality issues.', 'Disappointed.'] },
    { rating: 1, comments: ['Poor quality.', 'Do not recommend.', 'Waste of money.', 'Very disappointed.'] },
  ];
  
  const userNames = ['John Doe', 'Jane Smith', 'Mike Johnson', 'Sarah Williams', 'David Brown', 'Emma Davis', 'Chris Wilson', 'Lisa Anderson'];
  
  for (let i = 0; i < numReviews; i++) {
    // Bias towards positive reviews
    const ratingBias = Math.random();
    let rating;
    if (ratingBias < 0.6) rating = 5;
    else if (ratingBias < 0.8) rating = 4;
    else if (ratingBias < 0.9) rating = 3;
    else if (ratingBias < 0.95) rating = 2;
    else rating = 1;
    
    const template = reviewTemplates.find(t => t.rating === rating);
    const comment = template.comments[Math.floor(Math.random() * template.comments.length)];
    
    reviews.push({
      user: mongoose.Types.ObjectId(), // Fake user ID for seeding
      rating,
      comment,
      isVerifiedPurchase: Math.random() > 0.3,
      helpful: {
        yes: Math.floor(Math.random() * 20),
        no: Math.floor(Math.random() * 5),
      },
      createdAt: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000), // Random date within last 90 days
    });
  }
  
  return reviews;
}

// Run seeder if called directly
if (require.main === module) {
  seedProducts();
}

module.exports = seedProducts;