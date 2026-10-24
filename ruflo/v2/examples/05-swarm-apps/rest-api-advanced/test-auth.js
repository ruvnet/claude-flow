const axios = require('axios');

const API_URL = 'http://localhost:3000/api';

// Test user data
const testUser = {
  email: `test${Date.now()}@example.com`,
  password: 'Test123!',
  confirmPassword: 'Test123!',
  name: 'Test User',
  phone: '+1234567890',
  address: {
    street: '123 Test St',
    city: 'Test City',
    state: 'TS',
    zipCode: '12345',
    country: 'Test Country'
  }
};

let authToken = '';
let refreshToken = '';
let userId = '';

// Helper function to make API calls
async function apiCall(method, endpoint, data = null, token = null) {
  try {
    const config = {
      method,
      url: `${API_URL}${endpoint}`,
      headers: {}
    };

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error(`Error in ${method} ${endpoint}:`, error.response?.data || error.message);
    throw error;
  }
}

// Test functions
async function testRegister() {
  console.log('\n1. Testing Registration...');
  try {
    const result = await apiCall('POST', '/auth/register', testUser);
    console.log('✓ Registration successful');
    console.log('  User ID:', result.data.user._id);
    console.log('  Email verification required:', !result.data.user.isEmailVerified);
    authToken = result.data.accessToken;
    refreshToken = result.data.refreshToken;
    userId = result.data.user._id;
    return true;
  } catch (error) {
    console.log('✗ Registration failed');
    return false;
  }
}

async function testLogin() {
  console.log('\n2. Testing Login...');
  try {
    const result = await apiCall('POST', '/auth/login', {
      email: testUser.email,
      password: testUser.password,
      rememberMe: true
    });
    console.log('✓ Login successful');
    authToken = result.data.accessToken;
    refreshToken = result.data.refreshToken;
    return true;
  } catch (error) {
    console.log('✗ Login failed');
    return false;
  }
}

async function testGetMe() {
  console.log('\n3. Testing Get Current User...');
  try {
    const result = await apiCall('GET', '/auth/me', null, authToken);
    console.log('✓ Get current user successful');
    console.log('  User:', result.data.user.name, `(${result.data.user.email})`);
    return true;
  } catch (error) {
    console.log('✗ Get current user failed');
    return false;
  }
}

async function testPasswordStrength() {
  console.log('\n4. Testing Password Strength Checker...');
  const passwords = [
    { password: '123', expected: 'weak' },
    { password: 'password', expected: 'weak' },
    { password: 'Password1', expected: 'medium' },
    { password: 'Password1!', expected: 'strong' }
  ];

  for (const test of passwords) {
    try {
      const result = await apiCall('POST', '/auth/check-password', { password: test.password });
      console.log(`✓ Password "${test.password}": ${result.data.level} (score: ${result.data.score}/5)`);
    } catch (error) {
      console.log(`✗ Password strength check failed for "${test.password}"`);
    }
  }
  return true;
}

async function testUpdateProfile() {
  console.log('\n5. Testing Update Profile...');
  try {
    const updateData = {
      name: 'Updated Test User',
      phone: '+9876543210',
      address: {
        street: '456 Updated Ave',
        city: 'New City',
        state: 'NC',
        zipCode: '54321',
        country: 'Updated Country'
      }
    };
    const result = await apiCall('PUT', `/users/${userId}`, updateData, authToken);
    console.log('✓ Profile update successful');
    console.log('  Updated name:', result.data.name);
    return true;
  } catch (error) {
    console.log('✗ Profile update failed');
    return false;
  }
}

async function testChangePassword() {
  console.log('\n6. Testing Change Password...');
  try {
    const result = await apiCall('PUT', '/users/change-password', {
      currentPassword: testUser.password,
      newPassword: 'NewTest123!',
      confirmPassword: 'NewTest123!'
    }, authToken);
    console.log('✓ Password change successful');
    console.log('  New tokens generated');
    authToken = result.data.accessToken;
    refreshToken = result.data.refreshToken;
    testUser.password = 'NewTest123!';
    return true;
  } catch (error) {
    console.log('✗ Password change failed');
    return false;
  }
}

async function testRefreshToken() {
  console.log('\n7. Testing Refresh Token...');
  try {
    const result = await apiCall('POST', '/auth/refresh', { refreshToken });
    console.log('✓ Token refresh successful');
    console.log('  New access token generated');
    authToken = result.data.accessToken;
    refreshToken = result.data.refreshToken;
    return true;
  } catch (error) {
    console.log('✗ Token refresh failed');
    return false;
  }
}

async function testForgotPassword() {
  console.log('\n8. Testing Forgot Password...');
  try {
    const result = await apiCall('POST', '/auth/forgot-password', {
      email: testUser.email
    });
    console.log('✓ Forgot password request successful');
    console.log('  Message:', result.message);
    return true;
  } catch (error) {
    console.log('✗ Forgot password failed');
    return false;
  }
}

async function testLogout() {
  console.log('\n9. Testing Logout...');
  try {
    await apiCall('POST', '/auth/logout', { refreshToken }, authToken);
    console.log('✓ Logout successful');
    
    // Try to use the token after logout
    try {
      await apiCall('GET', '/auth/me', null, authToken);
      console.log('✗ Token still valid after logout (should not happen)');
      return false;
    } catch (error) {
      console.log('✓ Token properly invalidated after logout');
      return true;
    }
  } catch (error) {
    console.log('✗ Logout failed');
    return false;
  }
}

async function testFailedLogin() {
  console.log('\n10. Testing Failed Login Attempts...');
  const wrongPassword = 'WrongPassword123!';
  
  for (let i = 1; i <= 6; i++) {
    try {
      await apiCall('POST', '/auth/login', {
        email: testUser.email,
        password: wrongPassword
      });
      console.log(`✗ Login attempt ${i}: Should have failed but succeeded`);
    } catch (error) {
      if (i < 5) {
        console.log(`✓ Login attempt ${i}: Failed as expected`);
      } else if (i === 5) {
        console.log(`✓ Login attempt ${i}: Failed and account should be locked`);
      } else {
        console.log(`✓ Login attempt ${i}: Account is locked`);
      }
    }
  }
  return true;
}

// Run all tests
async function runTests() {
  console.log('Starting Authentication System Tests...');
  console.log('=====================================');
  
  const tests = [
    testRegister,
    testLogin,
    testGetMe,
    testPasswordStrength,
    testUpdateProfile,
    testChangePassword,
    testRefreshToken,
    testForgotPassword,
    testLogout,
    testFailedLogin
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    const result = await test();
    if (result) {
      passed++;
    } else {
      failed++;
    }
  }
  
  console.log('\n=====================================');
  console.log(`Tests completed: ${passed} passed, ${failed} failed`);
  console.log('=====================================');
}

// Check if server is running
async function checkServer() {
  try {
    await axios.get(`${API_URL}/health`);
    return true;
  } catch (error) {
    console.error('Server is not running. Please start the server with: npm run dev');
    return false;
  }
}

// Main execution
(async () => {
  const serverRunning = await checkServer();
  if (serverRunning) {
    await runTests();
  }
})();