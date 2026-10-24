import pytest
from src.models import User, Product

class TestUserModel:
    def test_create_user(self):
        """Test user creation with valid data"""
        user = User(username="testuser", email="test@example.com")
        assert user.username == "testuser"
        assert user.email == "test@example.com"
        assert user.id is None  # Not saved yet
    
    def test_user_validation(self):
        """Test user validation rules"""
        with pytest.raises(ValueError):
            User(username="", email="invalid-email")
    
    def test_user_serialization(self):
        """Test user to dict conversion"""
        user = User(username="testuser", email="test@example.com")
        data = user.to_dict()
        assert data['username'] == "testuser"
        assert 'password' not in data  # Should not expose password

class TestProductModel:
    def test_create_product(self):
        """Test product creation"""
        product = Product(name="Test Product", price=99.99)
        assert product.name == "Test Product"
        assert product.price == 99.99
