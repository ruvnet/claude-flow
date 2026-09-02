// In-memory data store for demo purposes
// In production, this would connect to a real database
let users = [
  { id: 1, name: 'John Doe', email: 'john@example.com', age: 30, createdAt: new Date() },
  { id: 2, name: 'Jane Smith', email: 'jane@example.com', age: 25, createdAt: new Date() },
  { id: 3, name: 'Bob Johnson', email: 'bob@example.com', age: 35, createdAt: new Date() }
];

let nextId = 4;

const userModel = {
  // Find all users with pagination
  findAll: async ({ page = 1, limit = 10, sort = 'id' }) => {
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    // Simple sorting
    const sortedUsers = [...users].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'email') return a.email.localeCompare(b.email);
      if (sort === 'age') return a.age - b.age;
      return a.id - b.id;
    });
    
    return sortedUsers.slice(startIndex, endIndex);
  },

  // Find user by ID
  findById: async (id) => {
    return users.find(user => user.id === parseInt(id));
  },

  // Create new user
  create: async (userData) => {
    const newUser = {
      id: nextId++,
      ...userData,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    users.push(newUser);
    return newUser;
  },

  // Update user
  update: async (id, updateData) => {
    const userIndex = users.findIndex(user => user.id === parseInt(id));
    
    if (userIndex === -1) {
      return null;
    }
    
    users[userIndex] = {
      ...users[userIndex],
      ...updateData,
      updatedAt: new Date()
    };
    
    return users[userIndex];
  },

  // Delete user
  delete: async (id) => {
    const userIndex = users.findIndex(user => user.id === parseInt(id));
    
    if (userIndex === -1) {
      return false;
    }
    
    users.splice(userIndex, 1);
    return true;
  },

  // Check if email exists
  emailExists: async (email) => {
    return users.some(user => user.email === email);
  }
};

module.exports = userModel;