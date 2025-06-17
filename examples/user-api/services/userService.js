const User = require('../models/User');

class UserService {
  constructor() {
    this.users = new Map();
  }

  createUser(userData) {
    const existingUser = this.findByEmail(userData.email);
    if (existingUser) {
      throw new Error('User with this email already exists');
    }
    
    const user = new User(userData);
    this.users.set(user.id, user);
    return user.toJSON();
  }

  getAllUsers() {
    return Array.from(this.users.values()).map(user => user.toJSON());
  }

  getUserById(id) {
    const user = this.users.get(id);
    if (!user) {
      throw new Error('User not found');
    }
    return user.toJSON();
  }

  updateUser(id, userData) {
    const user = this.users.get(id);
    if (!user) {
      throw new Error('User not found');
    }

    if (userData.email && userData.email !== user.email) {
      const existingUser = this.findByEmail(userData.email);
      if (existingUser) {
        throw new Error('User with this email already exists');
      }
    }

    user.update(userData);
    return user.toJSON();
  }

  deleteUser(id) {
    const user = this.users.get(id);
    if (!user) {
      throw new Error('User not found');
    }
    this.users.delete(id);
    return { message: 'User deleted successfully' };
  }

  findByEmail(email) {
    return Array.from(this.users.values()).find(user => user.email === email);
  }
}

module.exports = new UserService();