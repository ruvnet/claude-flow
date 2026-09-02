#!/usr/bin/env python3
"""
Test script for MLE-STAR ensemble integration.

This script tests the basic functionality of the MLE-STAR implementation
including ensemble execution, voting strategies, and performance tracking.
"""

import asyncio
import logging
import sys
import os
<<<<<<< Updated upstream
=======
from pathlib import Path
>>>>>>> Stashed changes

# Add the src directory to Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'src'))

from swarm_benchmark.mle_star import (
    MLEStarEnsembleExecutor, MLEStarConfig,
    MLScenarios, ClassificationScenario, RegressionScenario
)