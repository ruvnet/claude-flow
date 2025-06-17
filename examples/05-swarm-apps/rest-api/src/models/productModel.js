// In-memory data store for demo purposes
// In production, this would connect to a real database
let products = [
  { 
    id: 1, 
    name: 'Laptop', 
    price: 999.99, 
    category: 'Electronics', 
    stock: 50,
    description: 'High-performance laptop',
    createdAt: new Date() 
  },
  { 
    id: 2, 
    name: 'Smartphone', 
    price: 599.99, 
    category: 'Electronics', 
    stock: 100,
    description: 'Latest model smartphone',
    createdAt: new Date() 
  },
  { 
    id: 3, 
    name: 'Coffee Maker', 
    price: 79.99, 
    category: 'Appliances', 
    stock: 30,
    description: 'Automatic coffee maker',
    createdAt: new Date() 
  },
  { 
    id: 4, 
    name: 'Running Shoes', 
    price: 89.99, 
    category: 'Sports', 
    stock: 75,
    description: 'Professional running shoes',
    createdAt: new Date() 
  }
];

let nextId = 5;

const productModel = {
  // Find all products with pagination and filters
  findAll: async ({ page = 1, limit = 10, filters = {} }) => {
    let filteredProducts = [...products];
    
    // Apply filters
    if (filters.category) {
      filteredProducts = filteredProducts.filter(
        p => p.category.toLowerCase() === filters.category.toLowerCase()
      );
    }
    
    if (filters.minPrice) {
      filteredProducts = filteredProducts.filter(p => p.price >= filters.minPrice);
    }
    
    if (filters.maxPrice) {
      filteredProducts = filteredProducts.filter(p => p.price <= filters.maxPrice);
    }
    
    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    return filteredProducts.slice(startIndex, endIndex);
  },

  // Find product by ID
  findById: async (id) => {
    return products.find(product => product.id === parseInt(id));
  },

  // Create new product
  create: async (productData) => {
    const newProduct = {
      id: nextId++,
      ...productData,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    products.push(newProduct);
    return newProduct;
  },

  // Update product
  update: async (id, updateData) => {
    const productIndex = products.findIndex(product => product.id === parseInt(id));
    
    if (productIndex === -1) {
      return null;
    }
    
    products[productIndex] = {
      ...products[productIndex],
      ...updateData,
      updatedAt: new Date()
    };
    
    return products[productIndex];
  },

  // Delete product
  delete: async (id) => {
    const productIndex = products.findIndex(product => product.id === parseInt(id));
    
    if (productIndex === -1) {
      return false;
    }
    
    products.splice(productIndex, 1);
    return true;
  },

  // Get categories
  getCategories: async () => {
    const categories = [...new Set(products.map(p => p.category))];
    return categories.sort();
  },

  // Update stock
  updateStock: async (id, quantity) => {
    const product = products.find(p => p.id === parseInt(id));
    
    if (!product) {
      return null;
    }
    
    product.stock += quantity;
    product.updatedAt = new Date();
    
    return product;
  }
};

module.exports = productModel;