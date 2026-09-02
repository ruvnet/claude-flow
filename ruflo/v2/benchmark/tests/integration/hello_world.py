"""
Simple Hello World function in Python
"""

def hello_world(name: str = "World") -> str:
    """
    Simple Hello World function
    
    Args:
        name (str): Optional name parameter, defaults to 'World'
    
    Returns:
        str: Greeting message
    """
    return f"Hello, {name}!"


# Example usage
if __name__ == "__main__":
    print(hello_world())          # Output: Hello, World!
    print(hello_world("Claude"))  # Output: Hello, Claude!