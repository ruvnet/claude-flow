import pytest
from unittest.mock import Mock, patch
from src.services import UserService, ProductService

class TestUserService:
    @pytest.fixture
    def user_service(self):
        return UserService()
    
    def test_create_user_success(self, user_service):
        """Test successful user creation"""
        user_data = {"username": "newuser", "email": "new@example.com"}
        with patch('src.services.db') as mock_db:
            user = user_service.create_user(user_data)
            assert user.username == "newuser"
            mock_db.session.add.assert_called_once()
    
    def test_get_user_by_id(self, user_service):
        """Test retrieving user by ID"""
        with patch('src.services.User.query') as mock_query:
            mock_query.get.return_value = Mock(id=1, username="testuser")
            user = user_service.get_user(1)
            assert user.id == 1
            assert user.username == "testuser"
