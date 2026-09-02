#!/usr/bin/env python
"""
Analyze the _cstack function to understand the nested compound model bug.
"""

import numpy as np

def _coord_matrix(model, pos, noutp):
    """
    Simplified version of _coord_matrix for analysis.
    For Linear1D models, they are separable, so we use diagonal matrix.
    """
    n_inputs = model['n_inputs']
    n_outputs = model['n_outputs']
    
    mat = np.zeros((noutp, n_inputs))
    
    # For separable models (like Linear1D)
    for i in range(n_inputs):
        mat[i, i] = 1
    if pos == "right":
        mat = np.roll(mat, (noutp - n_outputs))
    return mat

def _cstack_original(left, right):
    """
    Original _cstack function behavior.
    """
    # Calculate noutp first
    if isinstance(left, dict):  # Model
        left_outputs = left['n_outputs']
    else:  # Array
        left_outputs = left.shape[0]
        
    if isinstance(right, dict):  # Model
        right_outputs = right['n_outputs']
    else:  # Array
        right_outputs = right.shape[0]
    
    noutp = left_outputs + right_outputs
    
    # Process left
    if isinstance(left, dict):  # Model
        cleft = _coord_matrix(left, "left", noutp)
    else:  # Array
        cleft = np.zeros((noutp, left.shape[1]))
        cleft[: left.shape[0], : left.shape[1]] = left
        
    # Process right
    if isinstance(right, dict):  # Model
        cright = _coord_matrix(right, "right", noutp)
    else:  # Array  
        cright = np.zeros((noutp, right.shape[1]))
        cright[-right.shape[0] :, -right.shape[1] :] = right

    return np.hstack([cleft, cright])

def _cstack_fixed(left, right):
    """
    Fixed _cstack function that handles nested compound models correctly.
    """
    # Calculate total outputs
    if isinstance(left, dict):
        left_outputs = left['n_outputs']
        left_inputs = left['n_inputs']
    else:
        left_outputs = left.shape[0]
        left_inputs = left.shape[1]
        
    if isinstance(right, dict):
        right_outputs = right['n_outputs']
        right_inputs = right['n_inputs']
    else:
        right_outputs = right.shape[0] 
        right_inputs = right.shape[1]
    
    noutp = left_outputs + right_outputs
    
    # Process left side
    if isinstance(left, dict):  # Model
        cleft = _coord_matrix(left, "left", noutp)
    else:  # Array (already a separability matrix)
        cleft = np.zeros((noutp, left_inputs))
        cleft[: left_outputs, :] = left
        
    # Process right side  
    if isinstance(right, dict):  # Model
        cright = _coord_matrix(right, "right", noutp)
    else:  # Array (already a separability matrix)
        cright = np.zeros((noutp, right_inputs))
        # Place the right matrix in the bottom rows
        cright[left_outputs:, :] = right

    return np.hstack([cleft, cright])

def test_nested_models():
    """Test the separability matrix computation for nested models."""
    
    # Simulate Linear1D(10) & Linear1D(5)
    linear1 = {'n_inputs': 1, 'n_outputs': 1, 'name': 'Linear1D(10)'}
    linear2 = {'n_inputs': 1, 'n_outputs': 1, 'name': 'Linear1D(5)'}
    
    # First compute cm = Linear1D(10) & Linear1D(5)
    print("Computing: Linear1D(10) & Linear1D(5)")
    cm_matrix = _cstack_original(linear1, linear2)
    print("Result matrix (original):")
    print(cm_matrix)
    print()
    
    # Now simulate Pix2Sky_TAN (2 inputs, 2 outputs, not separable)
    pix2sky = {'n_inputs': 2, 'n_outputs': 2, 'name': 'Pix2Sky_TAN'}
    
    # Test 1: Direct combination Pix2Sky_TAN() & Linear1D(10) & Linear1D(5)
    print("Test 1: Pix2Sky_TAN() & Linear1D(10) & Linear1D(5)")
    # First: Pix2Sky_TAN() & Linear1D(10)
    temp = _cstack_original(pix2sky, linear1)
    # Then: result & Linear1D(5)
    result1 = _cstack_original(temp, linear2)
    print("Result (direct combination):")
    print(result1.astype(int))
    print()
    
    # Test 2: Nested combination Pix2Sky_TAN() & cm
    print("Test 2: Pix2Sky_TAN() & cm (where cm is the compound model)")
    result2_orig = _cstack_original(pix2sky, cm_matrix)
    print("Result with ORIGINAL _cstack:")
    print(result2_orig.astype(int))
    print("Notice the bug: last two columns both have [0,0,1,1] instead of [0,0,1,0] and [0,0,0,1]")
    print()
    
    # Test 3: Using fixed version
    print("Test 3: Using FIXED _cstack:")
    result3_fixed = _cstack_fixed(pix2sky, cm_matrix)
    print("Result with FIXED _cstack:")
    print(result3_fixed.astype(int))
    print("This should match Test 1 result")
    print()
    
    # Compare
    print("=" * 60)
    print("COMPARISON:")
    print(f"Test 1 and Test 2 (original) match: {np.array_equal(result1, result2_orig)}")
    print(f"Test 1 and Test 3 (fixed) match: {np.array_equal(result1, result3_fixed)}")

if __name__ == "__main__":
    test_nested_models()