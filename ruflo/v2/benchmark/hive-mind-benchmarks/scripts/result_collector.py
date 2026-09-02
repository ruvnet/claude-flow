#!/usr/bin/env python3
"""
Advanced Result Collection and Aggregation System
Collects, processes, and generates comprehensive reports from Hive Mind benchmark results
"""

import os
import sys
import json
import sqlite3
import pandas as pd
import numpy as np
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
import matplotlib.pyplot as plt
import seaborn as sns
from jinja2 import Template

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))
from benchmark_runner import BenchmarkResult, BenchmarkConfig

@dataclass
class AggregatedMetrics:
    """Aggregated performance metrics"""
    topology: str
    coordination: str
    memory_type: str
    agent_count_range: str
    avg_initialization_time: float
    avg_coordination_latency: float
    avg_memory_usage_mb: float
    avg_cpu_usage_percent: float
    avg_task_completion_rate: float
    success_rate: float
    total_tests: int
    percentile_95_latency: float
    percentile_99_latency: float
    std_dev_latency: float

@dataclass
class PerformanceTrend:
    """Performance trend over time"""
    metric_name: str
    time_points: List[str]
    values: List[float]
    trend_direction: str  # improving, degrading, stable
    trend_magnitude: float
    confidence_level: float

class ResultDatabase:
    """SQLite database for storing and querying benchmark results"""
    
    def __init__(self, db_path: str = "benchmark_results.db"):
        self.db_path = db_path
        self._init_database()
        
    def _init_database(self):
        """Initialize database schema"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Results table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS benchmark_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            config_name TEXT NOT NULL,
            topology TEXT NOT NULL,
            coordination TEXT NOT NULL,
            memory_type TEXT NOT NULL,
            agent_count INTEGER NOT NULL,
            task_complexity TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            duration REAL NOT NULL,
            initialization_time REAL NOT NULL,
            coordination_latency REAL NOT NULL,
            memory_usage_mb REAL NOT NULL,
            cpu_usage_percent REAL NOT NULL,
            token_consumption INTEGER NOT NULL,
            task_completion_rate REAL NOT NULL,
            error_count INTEGER NOT NULL,
            consensus_decisions INTEGER NOT NULL,
            agent_spawn_time REAL NOT NULL,
            collective_memory_ops INTEGER NOT NULL,
            success BOOLEAN NOT NULL,
            error_message TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Aggregated metrics table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS aggregated_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            aggregation_key TEXT NOT NULL,
            topology TEXT NOT NULL,
            coordination TEXT NOT NULL,
            memory_type TEXT,
            agent_count_min INTEGER,
            agent_count_max INTEGER,
            avg_initialization_time REAL,
            avg_coordination_latency REAL,
            avg_memory_usage_mb REAL,
            avg_cpu_usage_percent REAL,
            avg_task_completion_rate REAL,
            success_rate REAL,
            total_tests INTEGER,
            percentile_95_latency REAL,
            percentile_99_latency REAL,
            std_dev_latency REAL,
            aggregated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Performance trends table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS performance_trends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            metric_name TEXT NOT NULL,
            topology TEXT NOT NULL,
            coordination TEXT NOT NULL,
            time_window TEXT NOT NULL,
            trend_direction TEXT NOT NULL,
            trend_magnitude REAL NOT NULL,
            confidence_level REAL NOT NULL,
            data_points INTEGER NOT NULL,
            calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        conn.commit()
        conn.close()
        
    def insert_results(self, results: List[BenchmarkResult]) -> int:
        """Insert benchmark results into database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        inserted_count = 0
        for result in results:
            config = result.config
            cursor.execute("""
            INSERT INTO benchmark_results (
                config_name, topology, coordination, memory_type, agent_count,
                task_complexity, start_time, end_time, duration, initialization_time,
                coordination_latency, memory_usage_mb, cpu_usage_percent, token_consumption,
                task_completion_rate, error_count, consensus_decisions, agent_spawn_time,
                collective_memory_ops, success, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                config.name, config.topology, config.coordination, config.memory_type,
                config.agent_count, config.task_complexity, result.start_time, result.end_time,
                result.duration, result.initialization_time, result.coordination_latency,
                result.memory_usage_mb, result.cpu_usage_percent, result.token_consumption,
                result.task_completion_rate, result.error_count, result.consensus_decisions,
                result.agent_spawn_time, result.collective_memory_ops, result.success,
                result.error_message
            ))
            inserted_count += 1
            
        conn.commit()
        conn.close()
        return inserted_count
        
    def query_results(self, filters: Dict[str, Any] = None, 
                     time_range: Tuple[str, str] = None) -> pd.DataFrame:
        """Query benchmark results with filters"""
        conn = sqlite3.connect(self.db_path)
        
        query = "SELECT * FROM benchmark_results WHERE 1=1"
        params = []
        
        if filters:
            for key, value in filters.items():
                if key in ['topology', 'coordination', 'memory_type', 'task_complexity']:
                    query += f" AND {key} = ?"
                    params.append(value)
                elif key == 'agent_count_min':
                    query += " AND agent_count >= ?"
                    params.append(value)
                elif key == 'agent_count_max':
                    query += " AND agent_count <= ?"
                    params.append(value)
                elif key == 'success_only':
                    query += " AND success = 1"
                    
        if time_range:
            query += " AND created_at BETWEEN ? AND ?"
            params.extend(time_range)
            
        query += " ORDER BY created_at DESC"
        
        df = pd.read_sql_query(query, conn, params=params)
        conn.close()
        return df
        
    def calculate_aggregated_metrics(self, group_by: List[str] = None) -> List[AggregatedMetrics]:
        """Calculate aggregated metrics grouped by specified columns"""
        df = self.query_results()
        if df.empty:
            return []
            
        group_by = group_by or ['topology', 'coordination', 'memory_type']
        
        aggregated = []
        for group_values, group_df in df.groupby(group_by):
            if isinstance(group_values, str):
                group_values = [group_values]
                
            # Calculate agent count range
            min_agents = group_df['agent_count'].min()
            max_agents = group_df['agent_count'].max()
            agent_range = f"{min_agents}-{max_agents}" if min_agents != max_agents else str(min_agents)
            
            # Calculate percentiles
            latency_values = group_df['coordination_latency'].dropna()
            p95_latency = latency_values.quantile(0.95) if not latency_values.empty else 0
            p99_latency = latency_values.quantile(0.99) if not latency_values.empty else 0
            std_latency = latency_values.std() if not latency_values.empty else 0
            
            metrics = AggregatedMetrics(
                topology=group_values[0] if len(group_values) > 0 else 'unknown',
                coordination=group_values[1] if len(group_values) > 1 else 'unknown',
                memory_type=group_values[2] if len(group_values) > 2 else 'unknown',
                agent_count_range=agent_range,
                avg_initialization_time=group_df['initialization_time'].mean(),
                avg_coordination_latency=group_df['coordination_latency'].mean(),
                avg_memory_usage_mb=group_df['memory_usage_mb'].mean(),
                avg_cpu_usage_percent=group_df['cpu_usage_percent'].mean(),
                avg_task_completion_rate=group_df['task_completion_rate'].mean(),
                success_rate=group_df['success'].mean(),
                total_tests=len(group_df),
                percentile_95_latency=p95_latency,
                percentile_99_latency=p99_latency,
                std_dev_latency=std_latency
            )
            aggregated.append(metrics)
            
        return aggregated

class AdvancedResultCollector:
    """Advanced result collection and analysis system"""
    
    def __init__(self, database: ResultDatabase = None, output_dir: str = "collected-results"):
        self.database = database or ResultDatabase()
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
        # Configure plotting style
        plt.style.use('seaborn-v0_8')
        sns.set_palette("husl")
        
    def collect_from_directory(self, results_dir: str) -> int:
        """Collect all benchmark results from a directory"""
        results_path = Path(results_dir)
        if not results_path.exists():
            raise FileNotFoundError(f"Results directory not found: {results_dir}")
            
        all_results = []
        
        # Find all result files
        json_files = list(results_path.glob("**/*results*.json"))
        csv_files = list(results_path.glob("**/*summary*.csv"))
        
        print(f"Found {len(json_files)} JSON files and {len(csv_files)} CSV files")
        
        # Process JSON result files
        for json_file in json_files:
            try:
                with open(json_file, 'r') as f:
                    data = json.load(f)
                    
                # Handle different JSON formats
                if isinstance(data, list):
                    # Raw results format
                    for item in data:
                        if 'config' in item:
                            result = self._dict_to_benchmark_result(item)
                            if result:
                                all_results.append(result)
                elif 'benchmark_analysis' in data:
                    # Analysis format - extract raw results if available
                    raw_results = data.get('raw_results', [])
                    for item in raw_results:
                        result = self._dict_to_benchmark_result(item)
                        if result:
                            all_results.append(result)
                            
            except Exception as e:
                print(f"Error processing {json_file}: {e}")
                continue
                
        # Store in database
        if all_results:
            inserted = self.database.insert_results(all_results)
            print(f"Inserted {inserted} results into database")
            return inserted
        else:
            print("No valid results found")
            return 0
            
    def _dict_to_benchmark_result(self, data: Dict[str, Any]) -> Optional[BenchmarkResult]:
        """Convert dictionary to BenchmarkResult object"""
        try:
            config_data = data.get('config', {})
            config = BenchmarkConfig(
                name=config_data.get('name', 'unknown'),
                topology=config_data.get('topology', 'unknown'),
                coordination=config_data.get('coordination', 'unknown'),
                memory_type=config_data.get('memory_type', 'unknown'),
                agent_count=config_data.get('agent_count', 0),
                task_complexity=config_data.get('task_complexity', 'unknown'),
                duration_seconds=config_data.get('duration_seconds', 0),
                iterations=config_data.get('iterations', 1)
            )
            
            result = BenchmarkResult(
                config=config,
                start_time=data.get('start_time', ''),
                end_time=data.get('end_time', ''),
                duration=data.get('duration', 0.0),
                initialization_time=data.get('initialization_time', 0.0),
                coordination_latency=data.get('coordination_latency', 0.0),
                memory_usage_mb=data.get('memory_usage_mb', 0.0),
                cpu_usage_percent=data.get('cpu_usage_percent', 0.0),
                token_consumption=data.get('token_consumption', 0),
                task_completion_rate=data.get('task_completion_rate', 0.0),
                error_count=data.get('error_count', 0),
                consensus_decisions=data.get('consensus_decisions', 0),
                agent_spawn_time=data.get('agent_spawn_time', 0.0),
                collective_memory_ops=data.get('collective_memory_ops', 0),
                success=data.get('success', False),
                error_message=data.get('error_message')
            )
            
            return result
            
        except Exception as e:
            print(f"Error converting data to BenchmarkResult: {e}")
            return None
            
    def generate_performance_analysis(self, time_window: str = "7d") -> Dict[str, Any]:
        """Generate comprehensive performance analysis"""
        # Calculate time range
        end_time = datetime.now()
        if time_window == "1d":
            start_time = end_time - timedelta(days=1)
        elif time_window == "7d":
            start_time = end_time - timedelta(days=7)
        elif time_window == "30d":
            start_time = end_time - timedelta(days=30)
        else:
            start_time = end_time - timedelta(days=30)
            
        # Query recent results
        df = self.database.query_results(
            time_range=(start_time.isoformat(), end_time.isoformat())
        )
        
        if df.empty:
            return {"error": "No results found in specified time window"}
            
        analysis = {
            "time_window": time_window,
            "analysis_time": datetime.now().isoformat(),
            "total_tests": len(df),
            "successful_tests": len(df[df['success'] == 1]),
            "failed_tests": len(df[df['success'] == 0]),
            "overall_success_rate": (len(df[df['success'] == 1]) / len(df)) * 100
        }
        
        # Performance by topology
        topology_analysis = {}
        for topology in df['topology'].unique():
            topology_df = df[df['topology'] == topology]
            topology_analysis[topology] = {
                "test_count": len(topology_df),
                "success_rate": (len(topology_df[topology_df['success'] == 1]) / len(topology_df)) * 100,
                "avg_coordination_latency": topology_df['coordination_latency'].mean(),
                "avg_memory_usage": topology_df['memory_usage_mb'].mean(),
                "avg_initialization_time": topology_df['initialization_time'].mean()
            }
        analysis["topology_performance"] = topology_analysis
        
        # Performance by coordination
        coordination_analysis = {}
        for coordination in df['coordination'].unique():
            coord_df = df[df['coordination'] == coordination]
            coordination_analysis[coordination] = {
                "test_count": len(coord_df),
                "success_rate": (len(coord_df[coord_df['success'] == 1]) / len(coord_df)) * 100,
                "avg_coordination_latency": coord_df['coordination_latency'].mean(),
                "avg_consensus_decisions": coord_df['consensus_decisions'].mean()
            }
        analysis["coordination_performance"] = coordination_analysis
        
        # Scaling analysis
        scaling_analysis = {}
        agent_ranges = [(1, 10), (11, 50), (51, 100), (101, 1000)]
        for min_agents, max_agents in agent_ranges:
            range_df = df[(df['agent_count'] >= min_agents) & (df['agent_count'] <= max_agents)]
            if not range_df.empty:
                scaling_analysis[f"{min_agents}-{max_agents}"] = {
                    "test_count": len(range_df),
                    "avg_coordination_latency": range_df['coordination_latency'].mean(),
                    "avg_memory_usage": range_df['memory_usage_mb'].mean(),
                    "avg_spawn_time": range_df['agent_spawn_time'].mean()
                }
        analysis["scaling_performance"] = scaling_analysis
        
        # Performance trends
        analysis["trends"] = self._calculate_performance_trends(df)
        
        return analysis
        
    def _calculate_performance_trends(self, df: pd.DataFrame) -> Dict[str, Any]:
        """Calculate performance trends over time"""
        if len(df) < 3:
            return {"error": "Insufficient data for trend analysis"}
            
        # Convert timestamps to datetime
        df['created_at'] = pd.to_datetime(df['created_at'])
        df = df.sort_values('created_at')
        
        trends = {}
        metrics = ['coordination_latency', 'memory_usage_mb', 'initialization_time']
        
        for metric in metrics:
            values = df[metric].dropna()
            if len(values) < 3:
                continue
                
            # Calculate linear trend
            x = np.arange(len(values))
            z = np.polyfit(x, values, 1)
            slope = z[0]
            
            # Determine trend direction
            if abs(slope) < 0.01:  # Very small change
                direction = "stable"
            elif slope > 0:
                direction = "degrading"  # Increasing latency/memory is bad
            else:
                direction = "improving"  # Decreasing is good
                
            # Calculate confidence (R²)
            p = np.poly1d(z)
            yhat = p(x)
            ybar = np.sum(values) / len(values)
            ssreg = np.sum((yhat - ybar) ** 2)
            sstot = np.sum((values - ybar) ** 2)
            confidence = ssreg / sstot if sstot != 0 else 0
            
            trends[metric] = {
                "direction": direction,
                "magnitude": abs(slope),
                "confidence": confidence,
                "data_points": len(values),
                "recent_avg": values[-5:].mean(),  # Last 5 values
                "overall_avg": values.mean()
            }
            
        return trends
        
    def generate_visualizations(self, output_subdir: str = "visualizations") -> Dict[str, str]:
        """Generate comprehensive visualization charts"""
        viz_dir = self.output_dir / output_subdir
        viz_dir.mkdir(exist_ok=True)
        
        df = self.database.query_results()
        if df.empty:
            return {"error": "No data available for visualization"}
            
        generated_files = {}
        
        # 1. Coordination Latency by Topology
        plt.figure(figsize=(12, 8))
        successful_df = df[df['success'] == 1]
        
        if not successful_df.empty:
            sns.boxplot(data=successful_df, x='topology', y='coordination_latency')
            plt.title('Coordination Latency Distribution by Topology')
            plt.ylabel('Latency (ms)')
            plt.xlabel('Topology')
            plt.xticks(rotation=45)
            
            latency_file = viz_dir / 'coordination_latency_by_topology.png'
            plt.savefig(latency_file, dpi=300, bbox_inches='tight')
            plt.close()
            generated_files['coordination_latency'] = str(latency_file)
            
        # 2. Memory Usage vs Agent Count
        plt.figure(figsize=(12, 8))
        if not successful_df.empty:
            scatter = plt.scatter(successful_df['agent_count'], successful_df['memory_usage_mb'], 
                                c=successful_df['coordination_latency'], cmap='viridis', alpha=0.6)
            plt.colorbar(scatter, label='Coordination Latency (ms)')
            plt.xlabel('Agent Count')
            plt.ylabel('Memory Usage (MB)')
            plt.title('Memory Usage vs Agent Count (colored by latency)')
            
            memory_file = viz_dir / 'memory_vs_agents.png'
            plt.savefig(memory_file, dpi=300, bbox_inches='tight')
            plt.close()
            generated_files['memory_usage'] = str(memory_file)
            
        # 3. Success Rate by Configuration
        plt.figure(figsize=(14, 10))
        success_by_config = df.groupby(['topology', 'coordination'])['success'].agg(['mean', 'count']).reset_index()
        success_by_config = success_by_config[success_by_config['count'] >= 3]  # At least 3 tests
        
        if not success_by_config.empty:
            pivot_table = success_by_config.pivot(index='topology', columns='coordination', values='mean')
            sns.heatmap(pivot_table, annot=True, fmt='.2f', cmap='RdYlGn', 
                       cbar_kws={'label': 'Success Rate'})
            plt.title('Success Rate Heatmap by Topology and Coordination')
            
            success_file = viz_dir / 'success_rate_heatmap.png'
            plt.savefig(success_file, dpi=300, bbox_inches='tight')
            plt.close()
            generated_files['success_rate'] = str(success_file)
            
        # 4. Performance Trends Over Time
        plt.figure(figsize=(15, 10))
        if 'created_at' in df.columns:
            df['created_at'] = pd.to_datetime(df['created_at'])
            df_sorted = df.sort_values('created_at')
            
            # Create subplots for different metrics
            fig, axes = plt.subplots(2, 2, figsize=(15, 10))
            
            # Coordination latency over time
            axes[0, 0].plot(df_sorted['created_at'], df_sorted['coordination_latency'], 'b-', alpha=0.7)
            axes[0, 0].set_title('Coordination Latency Over Time')
            axes[0, 0].set_ylabel('Latency (ms)')
            
            # Memory usage over time
            axes[0, 1].plot(df_sorted['created_at'], df_sorted['memory_usage_mb'], 'g-', alpha=0.7)
            axes[0, 1].set_title('Memory Usage Over Time')
            axes[0, 1].set_ylabel('Memory (MB)')
            
            # Success rate over time (rolling average)
            window_size = max(10, len(df_sorted) // 20)
            rolling_success = df_sorted['success'].rolling(window=window_size).mean()
            axes[1, 0].plot(df_sorted['created_at'], rolling_success, 'r-', alpha=0.7)
            axes[1, 0].set_title(f'Success Rate Over Time (rolling {window_size})')
            axes[1, 0].set_ylabel('Success Rate')
            
            # Agent count distribution
            axes[1, 1].hist(df_sorted['agent_count'], bins=20, alpha=0.7, color='purple')
            axes[1, 1].set_title('Agent Count Distribution')
            axes[1, 1].set_ylabel('Frequency')
            axes[1, 1].set_xlabel('Agent Count')
            
            plt.tight_layout()
            trends_file = viz_dir / 'performance_trends.png'
            plt.savefig(trends_file, dpi=300, bbox_inches='tight')
            plt.close()
            generated_files['trends'] = str(trends_file)
            
        return generated_files
        
    def generate_html_report(self, analysis: Dict[str, Any], 
                            visualizations: Dict[str, str] = None) -> str:
        """Generate comprehensive HTML report"""
        template_str = """
<!DOCTYPE html>
<html>
<head>
    <title>Hive Mind Benchmark Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .header { text-align: center; color: #2c3e50; }
        .summary { background: #ecf0f1; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .metric { display: inline-block; margin: 10px; padding: 15px; background: white; border-radius: 5px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .section { margin: 30px 0; }
        .chart { text-align: center; margin: 20px 0; }
        .chart img { max-width: 100%; height: auto; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
        th { background-color: #f2f2f2; }
        .success { color: #27ae60; }
        .warning { color: #f39c12; }
        .error { color: #e74c3c; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🐝 Hive Mind Benchmark Report</h1>
        <p>Generated on {{ analysis.analysis_time }}</p>
        <p>Time Window: {{ analysis.time_window }}</p>
    </div>
    
    <div class="summary">
        <h2>Executive Summary</h2>
        <div class="metric">
            <h3>{{ analysis.total_tests }}</h3>
            <p>Total Tests</p>
        </div>
        <div class="metric">
            <h3 class="{% if analysis.overall_success_rate >= 95 %}success{% elif analysis.overall_success_rate >= 80 %}warning{% else %}error{% endif %}">{{ "%.1f" | format(analysis.overall_success_rate) }}%</h3>
            <p>Success Rate</p>
        </div>
        <div class="metric">
            <h3 class="success">{{ analysis.successful_tests }}</h3>
            <p>Successful Tests</p>
        </div>
        <div class="metric">
            <h3 class="{% if analysis.failed_tests == 0 %}success{% else %}error{% endif %}">{{ analysis.failed_tests }}</h3>
            <p>Failed Tests</p>
        </div>
    </div>
    
    {% if visualizations %}
    <div class="section">
        <h2>Performance Visualizations</h2>
        {% for name, path in visualizations.items() %}
        <div class="chart">
            <h3>{{ name | title | replace('_', ' ') }}</h3>
            <img src="{{ path }}" alt="{{ name }}">
        </div>
        {% endfor %}
    </div>
    {% endif %}
    
    <div class="section">
        <h2>Topology Performance Analysis</h2>
        <table>
            <tr>
                <th>Topology</th>
                <th>Test Count</th>
                <th>Success Rate (%)</th>
                <th>Avg Coordination Latency (ms)</th>
                <th>Avg Memory Usage (MB)</th>
                <th>Avg Initialization Time (s)</th>
            </tr>
            {% for topology, data in analysis.topology_performance.items() %}
            <tr>
                <td>{{ topology }}</td>
                <td>{{ data.test_count }}</td>
                <td class="{% if data.success_rate >= 95 %}success{% elif data.success_rate >= 80 %}warning{% else %}error{% endif %}">{{ "%.1f" | format(data.success_rate) }}</td>
                <td>{{ "%.1f" | format(data.avg_coordination_latency) }}</td>
                <td>{{ "%.1f" | format(data.avg_memory_usage) }}</td>
                <td>{{ "%.2f" | format(data.avg_initialization_time) }}</td>
            </tr>
            {% endfor %}
        </table>
    </div>
    
    <div class="section">
        <h2>Coordination Performance Analysis</h2>
        <table>
            <tr>
                <th>Coordination Type</th>
                <th>Test Count</th>
                <th>Success Rate (%)</th>
                <th>Avg Coordination Latency (ms)</th>
                <th>Avg Consensus Decisions</th>
            </tr>
            {% for coordination, data in analysis.coordination_performance.items() %}
            <tr>
                <td>{{ coordination }}</td>
                <td>{{ data.test_count }}</td>
                <td class="{% if data.success_rate >= 95 %}success{% elif data.success_rate >= 80 %}warning{% else %}error{% endif %}">{{ "%.1f" | format(data.success_rate) }}</td>
                <td>{{ "%.1f" | format(data.avg_coordination_latency) }}</td>
                <td>{{ "%.1f" | format(data.avg_consensus_decisions) }}</td>
            </tr>
            {% endfor %}
        </table>
    </div>
    
    {% if analysis.trends %}
    <div class="section">
        <h2>Performance Trends</h2>
        {% for metric, trend in analysis.trends.items() %}
        <div class="metric">
            <h4>{{ metric | title | replace('_', ' ') }}</h4>
            <p><strong>Direction:</strong> 
                <span class="{% if trend.direction == 'improving' %}success{% elif trend.direction == 'stable' %}warning{% else %}error{% endif %}">
                    {{ trend.direction | title }}
                </span>
            </p>
            <p><strong>Magnitude:</strong> {{ "%.3f" | format(trend.magnitude) }}</p>
            <p><strong>Confidence:</strong> {{ "%.2f" | format(trend.confidence) }}</p>
            <p><strong>Data Points:</strong> {{ trend.data_points }}</p>
        </div>
        {% endfor %}
    </div>
    {% endif %}
    
    <div class="section">
        <h2>Scaling Performance Analysis</h2>
        <table>
            <tr>
                <th>Agent Range</th>
                <th>Test Count</th>
                <th>Avg Coordination Latency (ms)</th>
                <th>Avg Memory Usage (MB)</th>
                <th>Avg Spawn Time (s)</th>
            </tr>
            {% for range, data in analysis.scaling_performance.items() %}
            <tr>
                <td>{{ range }}</td>
                <td>{{ data.test_count }}</td>
                <td>{{ "%.1f" | format(data.avg_coordination_latency) }}</td>
                <td>{{ "%.1f" | format(data.avg_memory_usage) }}</td>
                <td>{{ "%.2f" | format(data.avg_spawn_time) }}</td>
            </tr>
            {% endfor %}
        </table>
    </div>
    
    <div class="summary">
        <h2>Report Generated</h2>
        <p>This automated report was generated by the Hive Mind Benchmark Result Collector.</p>
        <p>For more detailed analysis, please review the raw data and individual test results.</p>
    </div>
</body>
</html>
        """
        
        template = Template(template_str)
        html_content = template.render(analysis=analysis, visualizations=visualizations)
        
        report_file = self.output_dir / f"benchmark_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.html"
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write(html_content)
            
        return str(report_file)
        
    def export_aggregated_data(self, format: str = "csv") -> str:
        """Export aggregated metrics in specified format"""
        aggregated_metrics = self.database.calculate_aggregated_metrics()
        
        if format.lower() == "csv":
            df = pd.DataFrame([asdict(m) for m in aggregated_metrics])
            csv_file = self.output_dir / f"aggregated_metrics_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
            df.to_csv(csv_file, index=False)
            return str(csv_file)
        elif format.lower() == "json":
            json_file = self.output_dir / f"aggregated_metrics_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
            with open(json_file, 'w') as f:
                json.dump([asdict(m) for m in aggregated_metrics], f, indent=2)
            return str(json_file)
        else:
            raise ValueError(f"Unsupported format: {format}")

def main():
    """Main result collection demo"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Advanced Result Collector")
    parser.add_argument('--collect', help='Directory to collect results from')
    parser.add_argument('--analyze', action='store_true', help='Generate performance analysis')
    parser.add_argument('--visualize', action='store_true', help='Generate visualizations')
    parser.add_argument('--report', action='store_true', help='Generate HTML report')
    parser.add_argument('--export', choices=['csv', 'json'], help='Export aggregated data')
    parser.add_argument('--time-window', default='7d', choices=['1d', '7d', '30d'], 
                       help='Time window for analysis')
    
    args = parser.parse_args()
    
    collector = AdvancedResultCollector()
    
    if args.collect:
        print(f"Collecting results from {args.collect}...")
        count = collector.collect_from_directory(args.collect)
        print(f"Collected {count} results")
        
    if args.analyze:
        print(f"Generating performance analysis for {args.time_window}...")
        analysis = collector.generate_performance_analysis(args.time_window)
        analysis_file = collector.output_dir / f"analysis_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(analysis_file, 'w') as f:
            json.dump(analysis, f, indent=2)
        print(f"Analysis saved to {analysis_file}")
        
    if args.visualize:
        print("Generating visualizations...")
        viz_files = collector.generate_visualizations()
        print(f"Generated visualizations: {list(viz_files.keys())}")
        
    if args.report:
        print("Generating HTML report...")
        analysis = collector.generate_performance_analysis(args.time_window)
        viz_files = collector.generate_visualizations()
        report_file = collector.generate_html_report(analysis, viz_files)
        print(f"HTML report generated: {report_file}")
        
    if args.export:
        print(f"Exporting aggregated data as {args.export}...")
        export_file = collector.export_aggregated_data(args.export)
        print(f"Data exported to {export_file}")
        
if __name__ == "__main__":
    main()