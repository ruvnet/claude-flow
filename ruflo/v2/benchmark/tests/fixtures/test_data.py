"""
Test data and fixtures for realistic claude-flow benchmarking.
Provides sample projects, code snippets, and scenarios for testing.
"""

import json
import tempfile
from pathlib import Path
from typing import Dict, List, Any
import shutil


class TestDataGenerator:
    """Generate test data for benchmarking"""
    
    @staticmethod
    def create_sample_project(project_type: str = "web_api") -> Path:
        """Create a sample project structure for testing"""
        temp_dir = Path(tempfile.mkdtemp(prefix=f"test_{project_type}_"))
        
        if project_type == "web_api":
            # Create a simple web API project structure
            structure = {
                "src": {
                    "api": {
                        "__init__.py": "",
                        "routes.py": '''from flask import Flask, jsonify
app = Flask(__name__)

@app.route('/users')
def get_users():
    return jsonify({"users": []})

@app.route('/users/<int:id>')
def get_user(id):
    return jsonify({"id": id, "name": "Test User"})
''',
                        "models.py": '''class User:
    def __init__(self, id, name, email):
        self.id = id
        self.name = name
        self.email = email
''',
                        "database.py": '''import sqlite3

def get_connection():
    return sqlite3.connect('test.db')
'''
                    },
                    "tests": {
                        "__init__.py": "",
                        "test_routes.py": '''import pytest
from api.routes import app

def test_get_users():
    client = app.test_client()
    response = client.get('/users')
    assert response.status_code == 200
'''
                    }
                },
                "requirements.txt": "flask==2.3.0\npytest==7.4.0\n",
                "README.md": "# Test Web API Project\n\nA sample project for benchmarking."
            }
            
        elif project_type == "data_pipeline":
            structure = {
                "pipeline": {
                    "__init__.py": "",
                    "extract.py": '''import pandas as pd

def extract_data(source):
    """Extract data from source"""
    return pd.read_csv(source)
''',
                    "transform.py": '''def transform_data(df):
    """Transform the data"""
    df['processed'] = True
    return df
''',
                    "load.py": '''def load_data(df, destination):
    """Load data to destination"""
    df.to_csv(destination, index=False)
'''
                },
                "data": {
                    "sample.csv": "id,name,value\n1,Test,100\n2,Sample,200\n"
                }
            }
            
        elif project_type == "ml_model":
            structure = {
                "model": {
                    "__init__.py": "",
                    "train.py": '''import numpy as np
from sklearn.linear_model import LinearRegression

def train_model(X, y):
    """Train a simple model"""
    model = LinearRegression()
    model.fit(X, y)
    return model
''',
                    "predict.py": '''def predict(model, X):
    """Make predictions"""
    return model.predict(X)
''',
                    "evaluate.py": '''from sklearn.metrics import mean_squared_error

def evaluate_model(y_true, y_pred):
    """Evaluate model performance"""
    return mean_squared_error(y_true, y_pred)
'''
                },
                "notebooks": {
                    "analysis.ipynb": json.dumps({
                        "cells": [
                            {
                                "cell_type": "code",
                                "source": "import pandas as pd\nimport numpy as np",
                                "metadata": {}
                            }
                        ],
                        "metadata": {},
                        "nbformat": 4,
                        "nbformat_minor": 5
                    })
                }
            }
        else:
            # Default simple project
            structure = {
                "src": {
                    "main.py": "def main():\n    print('Hello, World!')\n",
                    "utils.py": "def helper():\n    return 'Helper function'\n"
                },
                "tests": {
                    "test_main.py": "def test_main():\n    assert True\n"
                }
            }
        
        # Create the project structure
        TestDataGenerator._create_structure(temp_dir, structure)
        return temp_dir
    
    @staticmethod
    def _create_structure(base_path: Path, structure: Dict[str, Any]):
        """Recursively create directory structure"""
        for name, content in structure.items():
            path = base_path / name
            if isinstance(content, dict):
                path.mkdir(exist_ok=True)
                TestDataGenerator._create_structure(path, content)
            else:
                path.write_text(content)
    
    @staticmethod
    def get_test_prompts() -> Dict[str, List[str]]:
        """Get categorized test prompts for different scenarios"""
        return {
            "simple": [
                "Create a function to calculate factorial",
                "Write a hello world program",
                "Create a simple calculator"
            ],
            "moderate": [
                "Build a REST API for user management",
                "Create a data validation module",
                "Implement a caching mechanism"
            ],
            "complex": [
                "Design a microservices architecture for e-commerce",
                "Build a real-time chat application with websockets",
                "Create a distributed task queue system"
            ],
            "research": [
                "Research best practices for Python async programming",
                "Investigate microservices design patterns",
                "Analyze cloud deployment strategies"
            ],
            "analysis": [
                "Analyze code complexity in the project",
                "Review security vulnerabilities",
                "Assess performance bottlenecks"
            ],
            "testing": [
                "Create comprehensive unit tests",
                "Build integration test suite",
                "Develop end-to-end tests"
            ],
            "optimization": [
                "Optimize database query performance",
                "Improve API response times",
                "Reduce memory usage"
            ]
        }
    
    @staticmethod
    def get_performance_scenarios() -> List[Dict[str, Any]]:
        """Get realistic performance testing scenarios"""
        return [
            {
                "name": "Small Project Development",
                "description": "Build a simple CRUD API",
                "expected_files": 5,
                "expected_duration": 30,
                "complexity": "low"
            },
            {
                "name": "Medium Project Analysis",
                "description": "Analyze and refactor legacy code",
                "expected_files": 15,
                "expected_duration": 60,
                "complexity": "medium"
            },
            {
                "name": "Large Project Architecture",
                "description": "Design microservices system",
                "expected_files": 25,
                "expected_duration": 90,
                "complexity": "high"
            },
            {
                "name": "Research Task",
                "description": "Research and document best practices",
                "expected_files": 3,
                "expected_duration": 45,
                "complexity": "medium"
            },
            {
                "name": "Testing Suite Creation",
                "description": "Build comprehensive test coverage",
                "expected_files": 10,
                "expected_duration": 50,
                "complexity": "medium"
            }
        ]
    
    @staticmethod
    def get_code_samples() -> Dict[str, str]:
        """Get code samples for testing different aspects"""
        return {
            "buggy_code": '''def calculate_average(numbers):
    total = 0
    for i in range(len(numbers)):
        total += numbers[i]
    return total / len(numbers)  # Bug: Division by zero when list is empty
''',
            "unoptimized_code": '''def find_duplicates(lst):
    duplicates = []
    for i in range(len(lst)):
        for j in range(i + 1, len(lst)):
            if lst[i] == lst[j] and lst[i] not in duplicates:
                duplicates.append(lst[i])
    return duplicates  # O(n²) complexity
''',
            "security_issue": '''import os
def execute_command(user_input):
    # Security issue: Command injection vulnerability
    os.system(f"echo {user_input}")
''',
            "good_code": '''from typing import List, Optional

def calculate_average(numbers: List[float]) -> Optional[float]:
    """Calculate the average of a list of numbers.
    
    Args:
        numbers: List of numbers to average
        
    Returns:
        Average value or None if list is empty
    """
    if not numbers:
        return None
    return sum(numbers) / len(numbers)
''',
            "complex_algorithm": '''def dijkstra(graph, start):
    """Dijkstra's shortest path algorithm"""
    import heapq
    
    distances = {node: float('infinity') for node in graph}
    distances[start] = 0
    pq = [(0, start)]
    
    while pq:
        current_distance, current_node = heapq.heappop(pq)
        
        if current_distance > distances[current_node]:
            continue
            
        for neighbor, weight in graph[current_node].items():
            distance = current_distance + weight
            
            if distance < distances[neighbor]:
                distances[neighbor] = distance
                heapq.heappush(pq, (distance, neighbor))
    
    return distances
'''
        }
    
    @staticmethod
    def cleanup_test_projects(paths: List[Path]):
        """Clean up temporary test projects"""
        for path in paths:
            if path.exists() and path.is_dir():
                shutil.rmtree(path)


# Pytest fixtures
import pytest

@pytest.fixture
def sample_web_api_project():
    """Create a sample web API project for testing"""
    project_path = TestDataGenerator.create_sample_project("web_api")
    yield project_path
    shutil.rmtree(project_path)

@pytest.fixture
def sample_data_pipeline_project():
    """Create a sample data pipeline project for testing"""
    project_path = TestDataGenerator.create_sample_project("data_pipeline")
    yield project_path
    shutil.rmtree(project_path)

@pytest.fixture
def sample_ml_project():
    """Create a sample ML project for testing"""
    project_path = TestDataGenerator.create_sample_project("ml_model")
    yield project_path
    shutil.rmtree(project_path)

@pytest.fixture
def test_prompts():
    """Get test prompts for different scenarios"""
    return TestDataGenerator.get_test_prompts()

@pytest.fixture
def performance_scenarios():
    """Get performance testing scenarios"""
    return TestDataGenerator.get_performance_scenarios()

@pytest.fixture
def code_samples():
    """Get code samples for testing"""
    return TestDataGenerator.get_code_samples()