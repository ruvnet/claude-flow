from setuptools import setup, find_packages

with open("README.md", "r", encoding="utf-8") as fh:
    long_description = fh.read()

with open("requirements.txt", "r", encoding="utf-8") as fh:
    requirements = [line.strip() for line in fh if line.strip() and not line.startswith("#")]

setup(
    name="swarm-benchmark",
    version="1.0.0",
    author="Claude Flow Team",
    author_email="support@claude-flow.dev",
    description="Agent swarm benchmarking tool for Claude Flow",
    long_description=long_description,
    long_description_content_type="text/markdown",
    url="https://github.com/claude-flow/swarm-benchmark",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    classifiers=[
        "Development Status :: 5 - Production/Stable",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "Topic :: Software Development :: Testing",
        "Topic :: System :: Benchmark",
    ],
    python_requires=">=3.8",
    install_requires=requirements,
    extras_require={
        "dev": [
            "pytest>=7.0",
            "pytest-cov>=4.0",
            "pytest-asyncio>=0.21",
            "pytest-benchmark>=4.0",
            "black>=22.0",
            "flake8>=5.0",
            "mypy>=1.0",
            "pre-commit>=2.20",
        ]
    },
    entry_points={
        "console_scripts": [
            "swarm-benchmark=swarm_benchmark.__main__:main",
            "swarm-bench=swarm_benchmark.__main__:main",
        ],
    },
    include_package_data=True,
    zip_safe=False,
)