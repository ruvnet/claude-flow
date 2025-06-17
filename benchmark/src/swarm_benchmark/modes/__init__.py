"""Coordination mode implementations."""

from .base_mode import BaseCoordinationMode
from .centralized_mode import CentralizedMode
from .distributed_mode import DistributedMode
from .hierarchical_mode import HierarchicalMode
from .mesh_mode import MeshMode
from .hybrid_mode import HybridMode

# Mode factory
def create_coordination_mode(mode_name: str) -> BaseCoordinationMode:
    """Create a coordination mode instance by name."""
    modes = {
        "centralized": CentralizedMode,
        "distributed": DistributedMode,
        "hierarchical": HierarchicalMode,
        "mesh": MeshMode,
        "hybrid": HybridMode,
    }
    
    mode_class = modes.get(mode_name.lower())
    if not mode_class:
        raise ValueError(f"Unknown coordination mode: {mode_name}")
    
    return mode_class()

def get_available_modes() -> list[str]:
    """Get list of available coordination mode names."""
    return ["centralized", "distributed", "hierarchical", "mesh", "hybrid"]

__all__ = [
    "BaseCoordinationMode",
    "CentralizedMode",
    "DistributedMode", 
    "HierarchicalMode",
    "MeshMode",
    "HybridMode",
    "create_coordination_mode",
    "get_available_modes",
]