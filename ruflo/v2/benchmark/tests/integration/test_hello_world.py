"""
Unit tests for Hello World function
"""

from hello_world import hello_world


def test_hello_world_default():
    """Test default parameter"""
    assert hello_world() == "Hello, World!"
    print("✓ Default parameter test passed")


def test_hello_world_custom_name():
    """Test with custom name"""
    assert hello_world("Claude") == "Hello, Claude!"
    print("✓ Custom name test passed")


def test_hello_world_empty_string():
    """Test with empty string"""
    assert hello_world("") == "Hello, !"
    print("✓ Empty string test passed")


if __name__ == "__main__":
    print("Running Python Hello World Tests:\n")
    
    test_hello_world_default()
    test_hello_world_custom_name()
    test_hello_world_empty_string()
    
    print("\nAll tests completed!")