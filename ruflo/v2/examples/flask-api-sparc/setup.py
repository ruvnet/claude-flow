from setuptools import setup, find_packages

setup(
    name="rest-api",
    version="1.0.0",
    packages=find_packages(),
    install_requires=[
        'flask>=2.3.0',
        'flask-sqlalchemy>=3.0.0',
        'flask-cors>=4.0.0',
        'python-dotenv>=1.0.0',
    ],
    extras_require={
        'dev': [
            'pytest>=7.4.0',
            'pytest-cov>=4.1.0',
            'black>=23.7.0',
            'flake8>=6.0.0',
        ]
    }
)
