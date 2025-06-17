// Simple API test script
// Run with: node test-api.js

const baseURL = 'http://localhost:3000';

async function testAPI() {
  console.log('Testing Simple REST API...\n');

  try {
    // Test 1: Get all items
    console.log('1. Getting all items:');
    const allItemsRes = await fetch(`${baseURL}/api/items`);
    const allItems = await allItemsRes.json();
    console.log(JSON.stringify(allItems, null, 2));
    console.log('\n---\n');

    // Test 2: Create a new item
    console.log('2. Creating a new item:');
    const createRes = await fetch(`${baseURL}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Item',
        description: 'Created via test script'
      })
    });
    const newItem = await createRes.json();
    console.log(JSON.stringify(newItem, null, 2));
    console.log('\n---\n');

    // Test 3: Get single item
    console.log('3. Getting single item:');
    const singleItemRes = await fetch(`${baseURL}/api/items/${newItem.id}`);
    const singleItem = await singleItemRes.json();
    console.log(JSON.stringify(singleItem, null, 2));
    console.log('\n---\n');

    // Test 4: Update item
    console.log('4. Updating item:');
    const updateRes = await fetch(`${baseURL}/api/items/${newItem.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Updated Test Item',
        description: 'Updated via test script'
      })
    });
    const updatedItem = await updateRes.json();
    console.log(JSON.stringify(updatedItem, null, 2));
    console.log('\n---\n');

    // Test 5: Delete item
    console.log('5. Deleting item:');
    const deleteRes = await fetch(`${baseURL}/api/items/${newItem.id}`, {
      method: 'DELETE'
    });
    console.log(`Delete status: ${deleteRes.status} ${deleteRes.statusText}`);
    console.log('\n---\n');

    // Test 6: Health check
    console.log('6. Health check:');
    const healthRes = await fetch(`${baseURL}/health`);
    const health = await healthRes.json();
    console.log(JSON.stringify(health, null, 2));

    console.log('\n✅ All tests completed successfully!');
  } catch (error) {
    console.error('❌ Error during testing:', error.message);
    console.log('\nMake sure the API is running on port 3000');
  }
}

// Run tests
testAPI();