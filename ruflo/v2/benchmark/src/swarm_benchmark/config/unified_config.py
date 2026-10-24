"""
Unified Configuration Management System.

This module provides centralized configuration management for all benchmark
system components, supporting multiple formats, environments, and validation.
"""

import json
import yaml
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Union, Type, Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
import logging

logger = logging.getLogger(__name__)


class ConfigFormat(Enum):
    """Supported configuration file formats."""
    JSON = "json"
    YAML = "yaml"
    TOML = "toml"
    ENV = "env"
    PYTHON = "py"


class ConfigPriority(Enum):
    """Configuration source priority levels."""
    DEFAULT = 1
    FILE = 2
    ENVIRONMENT = 3
    COMMAND_LINE = 4
    OVERRIDE = 5


@dataclass
class ConfigSource:
    """Information about a configuration source."""
    name: str
    format: ConfigFormat
    priority: ConfigPriority
    path: Optional[str] = None
    loaded_at: Optional[datetime] = None
    data: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ValidationError:
    """Configuration validation error."""
    field: str
    message: str
    value: Any
    rule: str


class ConfigValidator:
    """Configuration validation engine."""
    
    def __init__(self):
        self.rules: Dict[str, List[Callable]] = {}
        self.schemas: Dict[str, Dict[str, Any]] = {}
    
    def add_rule(self, field: str, rule_func: Callable[[Any], bool], 
                 message: str) -> None:
        """Add a validation rule for a field."""
        if field not in self.rules:
            self.rules[field] = []
        
        def wrapped_rule(value):
            if not rule_func(value):
                return ValidationError(field, message, value, rule_func.__name__)
            return None
        
        self.rules[field].append(wrapped_rule)
    
    def add_schema(self, name: str, schema: Dict[str, Any]) -> None:
        """Add a JSON schema for validation."""
        self.schemas[name] = schema
    
    def validate(self, config: Dict[str, Any], 
                schema_name: Optional[str] = None) -> List[ValidationError]:
        """Validate configuration against rules and schemas."""
        errors = []
        
        # Validate with field rules
        for field, rules in self.rules.items():
            if field in config:
                value = config[field]
                for rule in rules:
                    error = rule(value)
                    if error:
                        errors.append(error)
        
        # Validate with JSON schema if provided
        if schema_name and schema_name in self.schemas:
            try:
                import jsonschema
                jsonschema.validate(config, self.schemas[schema_name])
            except ImportError:
                logger.warning("jsonschema not available for schema validation")
            except jsonschema.ValidationError as e:
                errors.append(ValidationError(
                    field=".".join(str(x) for x in e.path),
                    message=e.message,
                    value=e.instance,
                    rule="schema"
                ))
        
        return errors


class ConfigLoader:
    """Configuration file loader supporting multiple formats."""
    
    def __init__(self):
        self.loaders = {
            ConfigFormat.JSON: self._load_json,
            ConfigFormat.YAML: self._load_yaml,
            ConfigFormat.TOML: self._load_toml,
            ConfigFormat.ENV: self._load_env,
            ConfigFormat.PYTHON: self._load_python
        }
    
    def load(self, path: Union[str, Path], 
             format: Optional[ConfigFormat] = None) -> Dict[str, Any]:
        """Load configuration from file."""
        path = Path(path)
        
        if not path.exists():
            raise FileNotFoundError(f"Configuration file not found: {path}")
        
        # Auto-detect format if not provided
        if format is None:
            format = self._detect_format(path)
        
        loader = self.loaders.get(format)
        if not loader:
            raise ValueError(f"Unsupported configuration format: {format}")
        
        try:
            return loader(path)
        except Exception as e:
            raise ValueError(f"Failed to load config from {path}: {e}")
    
    def _detect_format(self, path: Path) -> ConfigFormat:
        """Auto-detect configuration format from file extension."""
        ext = path.suffix.lower()
        format_map = {
            '.json': ConfigFormat.JSON,
            '.yaml': ConfigFormat.YAML,
            '.yml': ConfigFormat.YAML,
            '.toml': ConfigFormat.TOML,
            '.env': ConfigFormat.ENV,
            '.py': ConfigFormat.PYTHON
        }
        return format_map.get(ext, ConfigFormat.JSON)
    
    def _load_json(self, path: Path) -> Dict[str, Any]:
        """Load JSON configuration."""
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def _load_yaml(self, path: Path) -> Dict[str, Any]:
        """Load YAML configuration."""
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return yaml.safe_load(f) or {}
        except ImportError:
            raise ValueError("PyYAML not available for YAML configuration")
    
    def _load_toml(self, path: Path) -> Dict[str, Any]:
        """Load TOML configuration."""
        try:
            import tomllib  # Python 3.11+
        except ImportError:
            try:
                import tomli as tomllib  # Fallback for older versions
            except ImportError:
                raise ValueError("tomllib/tomli not available for TOML configuration")
        
        with open(path, 'rb') as f:
            return tomllib.load(f)
    
    def _load_env(self, path: Path) -> Dict[str, Any]:
        """Load environment file configuration."""
        config = {}
        with open(path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    config[key.strip()] = value.strip()
        return config
    
    def _load_python(self, path: Path) -> Dict[str, Any]:
        """Load Python configuration file."""
        import importlib.util
        spec = importlib.util.spec_from_file_location("config", path)
        if spec and spec.loader:
            config_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(config_module)
            
            # Extract configuration variables
            config = {}
            for attr_name in dir(config_module):
                if not attr_name.startswith('_'):
                    config[attr_name] = getattr(config_module, attr_name)
            return config
        return {}


class ConfigManager:
    """Central configuration manager."""
    
    def __init__(self, base_config: Optional[Dict[str, Any]] = None):
        self.sources: List[ConfigSource] = []
        self.merged_config: Dict[str, Any] = base_config or {}
        self.loader = ConfigLoader()
        self.validator = ConfigValidator()
        self._watchers: Dict[str, Callable] = {}
        self._setup_default_validation()
    
    def _setup_default_validation(self) -> None:
        """Setup default validation rules."""
        # Resource limits
        self.validator.add_rule(
            "max_agents",
            lambda x: isinstance(x, int) and x > 0 and x <= 100,
            "max_agents must be an integer between 1 and 100"
        )
        
        # Timeout values
        self.validator.add_rule(
            "timeout_seconds",
            lambda x: isinstance(x, (int, float)) and x > 0,
            "timeout_seconds must be a positive number"
        )
        
        # Memory limits
        self.validator.add_rule(
            "memory_limit_mb",
            lambda x: isinstance(x, int) and x > 0,
            "memory_limit_mb must be a positive integer"
        )
    
    def add_source(self, name: str, source: Union[str, Path, Dict[str, Any]], 
                   priority: ConfigPriority = ConfigPriority.FILE,
                   format: Optional[ConfigFormat] = None) -> None:
        """Add a configuration source."""
        if isinstance(source, (str, Path)):
            # Load from file
            data = self.loader.load(source, format)
            config_source = ConfigSource(
                name=name,
                format=format or self.loader._detect_format(Path(source)),
                priority=priority,
                path=str(source),
                loaded_at=datetime.now(),
                data=data
            )
        else:
            # Direct dictionary data
            config_source = ConfigSource(
                name=name,
                format=ConfigFormat.PYTHON,
                priority=priority,
                loaded_at=datetime.now(),
                data=source
            )
        
        # Insert in priority order
        inserted = False
        for i, existing in enumerate(self.sources):
            if priority.value > existing.priority.value:
                self.sources.insert(i, config_source)
                inserted = True
                break
        
        if not inserted:
            self.sources.append(config_source)
        
        self._merge_configs()
        logger.info(f"Added configuration source '{name}' with priority {priority.name}")
    
    def remove_source(self, name: str) -> None:
        """Remove a configuration source."""
        self.sources = [s for s in self.sources if s.name != name]
        self._merge_configs()
        logger.info(f"Removed configuration source '{name}'")
    
    def _merge_configs(self) -> None:
        """Merge all configuration sources by priority."""
        merged = {}
        
        # Merge in reverse priority order (lowest to highest)
        for source in reversed(self.sources):
            merged = self._deep_merge(merged, source.data)
        
        self.merged_config = merged
        self._notify_watchers()
    
    def _deep_merge(self, base: Dict[str, Any], 
                   override: Dict[str, Any]) -> Dict[str, Any]:
        """Deep merge two dictionaries."""
        result = base.copy()
        
        for key, value in override.items():
            if (key in result and 
                isinstance(result[key], dict) and 
                isinstance(value, dict)):
                result[key] = self._deep_merge(result[key], value)
            else:
                result[key] = value
        
        return result
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value with optional default."""
        keys = key.split('.')
        value = self.merged_config
        
        try:
            for k in keys:
                value = value[k]
            return value
        except (KeyError, TypeError):
            return default
    
    def set(self, key: str, value: Any, 
            source_name: str = "runtime") -> None:
        """Set configuration value at runtime."""
        # Create or update runtime source
        runtime_source = None
        for source in self.sources:
            if source.name == source_name:
                runtime_source = source
                break
        
        if runtime_source is None:
            runtime_source = ConfigSource(
                name=source_name,
                format=ConfigFormat.PYTHON,
                priority=ConfigPriority.OVERRIDE,
                loaded_at=datetime.now(),
                data={}
            )
            self.sources.insert(0, runtime_source)
        
        # Set nested key
        keys = key.split('.')
        current = runtime_source.data
        
        for k in keys[:-1]:
            if k not in current:
                current[k] = {}
            current = current[k]
        
        current[keys[-1]] = value
        self._merge_configs()
    
    def validate(self, schema_name: Optional[str] = None) -> List[ValidationError]:
        """Validate current configuration."""
        return self.validator.validate(self.merged_config, schema_name)
    
    def watch(self, key: str, callback: Callable[[Any], None]) -> None:
        """Watch for changes to a configuration key."""
        self._watchers[key] = callback
    
    def unwatch(self, key: str) -> None:
        """Stop watching a configuration key."""
        if key in self._watchers:
            del self._watchers[key]
    
    def _notify_watchers(self) -> None:
        """Notify watchers of configuration changes."""
        for key, callback in self._watchers.items():
            try:
                value = self.get(key)
                callback(value)
            except Exception as e:
                logger.error(f"Error notifying watcher for '{key}': {e}")
    
    def get_source_info(self) -> List[Dict[str, Any]]:
        """Get information about all configuration sources."""
        return [
            {
                "name": source.name,
                "format": source.format.value,
                "priority": source.priority.name,
                "path": source.path,
                "loaded_at": source.loaded_at.isoformat() if source.loaded_at else None,
                "keys": list(source.data.keys())
            }
            for source in self.sources
        ]
    
    def export(self, format: ConfigFormat = ConfigFormat.JSON) -> str:
        """Export merged configuration to string."""
        if format == ConfigFormat.JSON:
            return json.dumps(self.merged_config, indent=2, default=str)
        elif format == ConfigFormat.YAML:
            try:
                return yaml.dump(self.merged_config, default_flow_style=False)
            except ImportError:
                raise ValueError("PyYAML not available for YAML export")
        else:
            raise ValueError(f"Export format {format} not supported")
    
    def save(self, path: Union[str, Path], 
             format: Optional[ConfigFormat] = None) -> None:
        """Save merged configuration to file."""
        path = Path(path)
        
        if format is None:
            format = self.loader._detect_format(path)
        
        content = self.export(format)
        
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        logger.info(f"Configuration saved to {path}")


class UnifiedConfig:
    """Main unified configuration class."""
    
    _instance: Optional['UnifiedConfig'] = None
    _initialized: bool = False
    
    def __new__(cls) -> 'UnifiedConfig':
        """Singleton pattern for global configuration."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self.manager = ConfigManager()
        self._setup_default_config()
        self._load_environment_config()
        self._initialized = True
    
    def _setup_default_config(self) -> None:
        """Setup default configuration values."""
        defaults = {
            "benchmark": {
                "max_agents": 10,
                "timeout_seconds": 300,
                "memory_limit_mb": 2048,
                "parallel_execution": True,
                "retry_attempts": 3,
                "retry_delay_seconds": 1.0
            },
            "mle_star": {
                "ensemble_size": 5,
                "voting_strategy": "weighted",
                "consensus_threshold": 0.7,
                "model_timeout_seconds": 60
            },
            "automation": {
                "batch_size": 50,
                "max_parallel_batches": 5,
                "pipeline_timeout_seconds": 600,
                "resource_pool_size": 20
            },
            "metrics": {
                "collection_interval_seconds": 1.0,
                "retention_days": 30,
                "aggregation_window_seconds": 60,
                "export_formats": ["json", "csv"]
            },
            "collective": {
                "swarm_size": 10,
                "consensus_mechanisms": ["voting", "weighted_consensus"],
                "synchronization_timeout_seconds": 30,
                "memory_sync_interval_seconds": 5.0
            },
            "claude_optimizer": {
                "optimization_iterations": 10,
                "population_size": 20,
                "mutation_rate": 0.1,
                "crossover_rate": 0.8
            },
            "logging": {
                "level": "INFO",
                "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s",
                "file_path": "benchmark.log"
            }
        }
        
        self.manager.add_source(
            "defaults", 
            defaults, 
            ConfigPriority.DEFAULT
        )
    
    def _load_environment_config(self) -> None:
        """Load configuration from environment variables."""
        env_config = {}
        
        # Map environment variables to config keys
        env_mappings = {
            "BENCHMARK_MAX_AGENTS": "benchmark.max_agents",
            "BENCHMARK_TIMEOUT": "benchmark.timeout_seconds",
            "BENCHMARK_MEMORY_LIMIT": "benchmark.memory_limit_mb",
            "MLE_STAR_ENSEMBLE_SIZE": "mle_star.ensemble_size",
            "AUTOMATION_BATCH_SIZE": "automation.batch_size",
            "LOG_LEVEL": "logging.level"
        }
        
        for env_key, config_key in env_mappings.items():
            if env_key in os.environ:
                value = os.environ[env_key]
                
                # Convert to appropriate type
                if config_key.endswith(("_seconds", "_mb", "_size", "_agents")):
                    try:
                        value = int(value)
                    except ValueError:
                        try:
                            value = float(value)
                        except ValueError:
                            pass
                elif config_key.endswith("_rate"):
                    try:
                        value = float(value)
                    except ValueError:
                        pass
                
                # Set nested value
                keys = config_key.split('.')
                current = env_config
                for key in keys[:-1]:
                    if key not in current:
                        current[key] = {}
                    current = current[key]
                current[keys[-1]] = value
        
        if env_config:
            self.manager.add_source(
                "environment",
                env_config,
                ConfigPriority.ENVIRONMENT
            )
    
    def load_config_file(self, path: Union[str, Path], 
                        priority: ConfigPriority = ConfigPriority.FILE) -> None:
        """Load configuration from file."""
        self.manager.add_source(
            f"file:{path}",
            path,
            priority
        )
    
    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value."""
        return self.manager.get(key, default)
    
    def set(self, key: str, value: Any) -> None:
        """Set configuration value."""
        self.manager.set(key, value)
    
    def validate(self) -> List[ValidationError]:
        """Validate current configuration."""
        return self.manager.validate()
    
    @property
    def config(self) -> Dict[str, Any]:
        """Get full merged configuration."""
        return self.manager.merged_config


# Global configuration instance
config = UnifiedConfig()