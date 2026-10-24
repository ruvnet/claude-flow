#!/bin/bash
# Install real SWE-bench from official repository

echo "Installing official SWE-bench..."

# Install SWE-bench
pip install swebench

# Clone the official repository for additional resources
git clone https://github.com/princeton-nlp/SWE-bench.git swe-bench-official

# Download the dataset
python -c "
from datasets import load_dataset

# Load SWE-bench dataset from HuggingFace
print('Downloading SWE-bench dataset...')
dataset = load_dataset('princeton-nlp/SWE-bench', split='test')
print(f'Loaded {len(dataset)} test instances')

# Save locally
dataset.save_to_disk('swe-bench-data')
print('Dataset saved to swe-bench-data/')
"

echo "SWE-bench installation complete!"