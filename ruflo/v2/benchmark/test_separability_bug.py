#!/usr/bin/env python
"""Test script to reproduce the separability_matrix bug for nested CompoundModels."""

import sys
import os
# Add the local astropy to path
sys.path.insert(0, '/workspaces/claude-code-flow/astropy_fix')

from astropy.modeling import models as m
from astropy.modeling.separable import separability_matrix
import numpy as np

def test_nested_compound_models():
    """Test separability matrix for nested compound models."""
    
    # Create simple compound model
    cm = m.Linear1D(10) & m.Linear1D(5)
    
    # Test 1: Simple compound model (should be diagonal)
    print("Test 1: Simple compound model (Linear1D & Linear1D)")
    print("cm = m.Linear1D(10) & m.Linear1D(5)")
    result1 = separability_matrix(cm)
    print("Result:")
    print(result1)
    print("Expected: diagonal matrix")
    print("array([[ True, False],")
    print("       [False,  True]])")
    print()
    
    # Test 2: Complex model with direct combination
    print("Test 2: Complex model (Pix2Sky_TAN() & Linear1D & Linear1D)")
    print("m.Pix2Sky_TAN() & m.Linear1D(10) & m.Linear1D(5)")
    result2 = separability_matrix(m.Pix2Sky_TAN() & m.Linear1D(10) & m.Linear1D(5))
    print("Result:")
    print(result2)
    print("Expected: Block diagonal")
    print("array([[ True,  True, False, False],")
    print("       [ True,  True, False, False],")
    print("       [False, False,  True, False],")
    print("       [False, False, False,  True]])")
    print()
    
    # Test 3: Nested compound model (THE BUG)
    print("Test 3: Nested compound model (Pix2Sky_TAN() & cm)")
    print("m.Pix2Sky_TAN() & cm  where cm = m.Linear1D(10) & m.Linear1D(5)")
    result3 = separability_matrix(m.Pix2Sky_TAN() & cm)
    print("Result:")
    print(result3)
    print("Expected (should be same as Test 2):")
    print("array([[ True,  True, False, False],")
    print("       [ True,  True, False, False],")
    print("       [False, False,  True, False],")
    print("       [False, False, False,  True]])")
    print()
    
    # Check if results match expected
    print("=" * 60)
    print("VERIFICATION:")
    
    # Expected results
    expected1 = np.array([[True, False], [False, True]])
    expected2 = np.array([[True, True, False, False],
                          [True, True, False, False],
                          [False, False, True, False],
                          [False, False, False, True]])
    expected3 = expected2  # Should be the same as expected2
    
    # Check Test 1
    test1_pass = np.array_equal(result1, expected1)
    print(f"Test 1 {'PASSED' if test1_pass else 'FAILED'}")
    
    # Check Test 2
    test2_pass = np.array_equal(result2, expected2)
    print(f"Test 2 {'PASSED' if test2_pass else 'FAILED'}")
    
    # Check Test 3
    test3_pass = np.array_equal(result3, expected3)
    print(f"Test 3 {'PASSED' if test3_pass else 'FAILED'} - This is the bug!")
    
    if not test3_pass:
        print("\nBUG CONFIRMED: Nested compound models produce incorrect separability matrix")
        print("The last two columns show True, True instead of True, False and False, True")

if __name__ == "__main__":
    test_nested_compound_models()