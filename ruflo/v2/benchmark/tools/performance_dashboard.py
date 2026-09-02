#!/usr/bin/env python3
"""
Performance Dashboard Generator for Claude-Flow Swarm Operations

This script generates interactive HTML dashboards for performance monitoring:
- Real-time performance metrics visualization
- Historical trend analysis and charts
- Performance regression tracking
- Interactive charts and graphs
- Automated report generation

Author: Metrics Analyst Agent
Version: 1.0.0
"""

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional
import statistics
from dataclasses import asdict

# Add local modules to path
sys.path.insert(0, str(Path(__file__).parent))

try:
    from continuous_performance_monitor import PerformanceMonitor, MetricSnapshot
except ImportError:
    print("Warning: Could not import performance monitor - dashboard will use sample data")


class PerformanceDashboard:
    """Generates interactive performance dashboards."""
    
    def __init__(self, output_dir: str = "dashboard_output"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
    def generate_dashboard(self, data_source: str = "database") -> str:
        """Generate complete performance dashboard."""
        print("📊 Generating Performance Dashboard...")
        
        # Collect data
        if data_source == "database":
            dashboard_data = self._collect_database_data()
        else:
            dashboard_data = self._generate_sample_data()
        
        # Generate HTML dashboard
        dashboard_file = self._generate_html_dashboard(dashboard_data)
        
        # Generate additional reports
        self._generate_csv_export(dashboard_data)
        self._generate_json_export(dashboard_data)
        
        print(f"✅ Dashboard generated: {dashboard_file}")
        return str(dashboard_file)
    
    def _collect_database_data(self) -> Dict[str, Any]:
        """Collect data from performance database."""
        try:
            monitor = PerformanceMonitor()
            
            # Get dashboard data for different time periods
            data = {
                "last_24h": monitor.get_performance_dashboard_data(24),
                "last_7d": monitor.get_performance_dashboard_data(168),
                "last_30d": monitor.get_performance_dashboard_data(720),
                "regression_report": monitor.generate_regression_report()
            }
            
            return data
            
        except Exception as e:
            print(f"Warning: Could not collect database data: {e}")
            return self._generate_sample_data()
    
    def _generate_sample_data(self) -> Dict[str, Any]:
        """Generate sample data for demonstration."""
        import random
        
        # Generate sample time series data
        now = datetime.now()
        time_series = []
        
        for i in range(100):
            timestamp = now - timedelta(hours=i)
            time_series.append({
                "timestamp": timestamp.isoformat(),
                "swarm_init_time": random.uniform(1.0, 8.0),
                "agent_coordination_latency": random.uniform(50, 300),
                "memory_usage_mb": random.uniform(20, 80),
                "token_consumption_rate": random.uniform(80, 150),
                "mcp_response_time": random.uniform(0.2, 2.0),
                "neural_processing_time": random.uniform(100, 800),
                "active_agents": random.randint(0, 8),
                "cpu_usage_percent": random.uniform(10, 70)
            })
        
        return {
            "last_24h": {
                "summary": {
                    "total_samples": 100,
                    "time_range_hours": 24,
                    "last_update": now.isoformat()
                },
                "swarm_performance": {
                    "avg_init_time": 3.2,
                    "max_init_time": 7.8,
                    "avg_coordination_latency": 180.5,
                    "max_coordination_latency": 295.2
                },
                "resource_usage": {
                    "avg_memory_mb": 45.3,
                    "peak_memory_mb": 78.9,
                    "memory_trend": "stable"
                },
                "time_series": time_series,
                "baselines": {
                    "swarm_init_time": 5.0,
                    "agent_coordination_latency": 200.0,
                    "memory_usage_mb": 50.0
                }
            },
            "regression_report": {
                "analysis_period": {
                    "recent_period_hours": 24,
                    "historical_period_hours": 168
                },
                "regression_analysis": {
                    "swarm_init_time": {
                        "recent_avg": 3.2,
                        "historical_avg": 3.5,
                        "regression_percent": -8.6,
                        "regression_detected": False
                    },
                    "memory_usage": {
                        "recent_avg": 45.3,
                        "historical_avg": 42.1,
                        "regression_percent": 7.6,
                        "regression_detected": False
                    }
                }
            }
        }
    
    def _generate_html_dashboard(self, data: Dict[str, Any]) -> Path:
        """Generate HTML dashboard file."""
        dashboard_data = data.get("last_24h", {})
        regression_data = data.get("regression_report", {})
        
        html_content = self._create_html_template(dashboard_data, regression_data)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dashboard_file = self.output_dir / f"performance_dashboard_{timestamp}.html"
        
        with open(dashboard_file, 'w') as f:
            f.write(html_content)
        
        # Also create a 'latest' version
        latest_file = self.output_dir / "performance_dashboard_latest.html"
        with open(latest_file, 'w') as f:
            f.write(html_content)
        
        return dashboard_file
    
    def _create_html_template(self, dashboard_data: Dict[str, Any], regression_data: Dict[str, Any]) -> str:
        """Create HTML template with embedded data and charts."""
        
        summary = dashboard_data.get("summary", {})
        swarm_perf = dashboard_data.get("swarm_performance", {})
        resource_usage = dashboard_data.get("resource_usage", {})
        time_series = dashboard_data.get("time_series", [])
        baselines = dashboard_data.get("baselines", {})
        
        # Create JavaScript data for charts
        chart_data = {
            "timeSeries": time_series[-50:],  # Last 50 data points
            "baselines": baselines,
            "summary": summary,
            "swarmPerf": swarm_perf,
            "resourceUsage": resource_usage,
            "regressionData": regression_data
        }
        
        html_template = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude-Flow Swarm Performance Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body {{
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }}
        .container {{
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }}
        .header {{
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }}
        .header h1 {{
            margin: 0;
            font-size: 2.5em;
            font-weight: 300;
        }}
        .header p {{
            margin: 10px 0 0;
            opacity: 0.9;
            font-size: 1.1em;
        }}
        .metrics-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            padding: 30px;
        }}
        .metric-card {{
            background: white;
            border: 1px solid #e1e5e9;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            transition: transform 0.2s;
        }}
        .metric-card:hover {{
            transform: translateY(-2px);
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }}
        .metric-value {{
            font-size: 2.5em;
            font-weight: bold;
            margin-bottom: 5px;
        }}
        .metric-label {{
            color: #666;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }}
        .metric-target {{
            font-size: 0.8em;
            color: #999;
            margin-top: 5px;
        }}
        .status-good {{ color: #28a745; }}
        .status-warning {{ color: #ffc107; }}
        .status-critical {{ color: #dc3545; }}
        .charts-section {{
            padding: 30px;
            background: #fafafa;
        }}
        .chart-container {{
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 30px;
            border: 1px solid #e1e5e9;
        }}
        .chart-title {{
            font-size: 1.3em;
            font-weight: 600;
            margin-bottom: 20px;
            color: #333;
        }}
        .chart-canvas {{
            max-height: 400px;
        }}
        .regression-section {{
            padding: 30px;
            background: #f8f9fa;
            border-top: 1px solid #e1e5e9;
        }}
        .regression-item {{
            background: white;
            border-radius: 6px;
            padding: 15px;
            margin-bottom: 15px;
            border-left: 4px solid #007bff;
        }}
        .regression-item.warning {{ border-left-color: #ffc107; }}
        .regression-item.critical {{ border-left-color: #dc3545; }}
        .regression-item.improvement {{ border-left-color: #28a745; }}
        .footer {{
            background: #333;
            color: white;
            text-align: center;
            padding: 20px;
            font-size: 0.9em;
        }}
        .refresh-info {{
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0,0,0,0.8);
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            font-size: 0.8em;
        }}
    </style>
</head>
<body>
    <div class="refresh-info">
        Last updated: {summary.get("last_update", datetime.now().isoformat())[:19]}
    </div>
    
    <div class="container">
        <div class="header">
            <h1>🚀 Claude-Flow Swarm Performance Dashboard</h1>
            <p>Real-time monitoring and performance analytics</p>
        </div>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value status-{self._get_status(swarm_perf.get("avg_init_time", 0), baselines.get("swarm_init_time", 5.0))}">
                    {swarm_perf.get("avg_init_time", 0):.2f}s
                </div>
                <div class="metric-label">Avg Swarm Init Time</div>
                <div class="metric-target">Target: &lt; {baselines.get("swarm_init_time", 5.0)}s</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-value status-{self._get_status(swarm_perf.get("avg_coordination_latency", 0), baselines.get("agent_coordination_latency", 200.0))}">
                    {swarm_perf.get("avg_coordination_latency", 0):.1f}ms
                </div>
                <div class="metric-label">Avg Coordination Latency</div>
                <div class="metric-target">Target: &lt; {baselines.get("agent_coordination_latency", 200.0)}ms</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-value status-{self._get_status(resource_usage.get("avg_memory_mb", 0), baselines.get("memory_usage_mb", 50.0))}">
                    {resource_usage.get("avg_memory_mb", 0):.1f}MB
                </div>
                <div class="metric-label">Avg Memory Usage</div>
                <div class="metric-target">Target: &lt; {baselines.get("memory_usage_mb", 50.0)}MB</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-value status-good">
                    {resource_usage.get("peak_memory_mb", 0):.1f}MB
                </div>
                <div class="metric-label">Peak Memory Usage</div>
                <div class="metric-target">Trend: {resource_usage.get("memory_trend", "unknown")}</div>
            </div>
        </div>
        
        <div class="charts-section">
            <div class="chart-container">
                <div class="chart-title">📈 Performance Trends (Last 24 Hours)</div>
                <canvas id="performanceTrendChart" class="chart-canvas"></canvas>
            </div>
            
            <div class="chart-container">
                <div class="chart-title">💾 Memory Usage Over Time</div>
                <canvas id="memoryUsageChart" class="chart-canvas"></canvas>
            </div>
            
            <div class="chart-container">
                <div class="chart-title">🕒 Response Time Distribution</div>
                <canvas id="responseTimeChart" class="chart-canvas"></canvas>
            </div>
        </div>
        
        <div class="regression-section">
            <h2>🔍 Performance Regression Analysis</h2>
            {self._generate_regression_html(regression_data)}
        </div>
        
        <div class="footer">
            Generated by Claude-Flow Metrics Analyst Agent | 
            Version 1.0.0 | 
            {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
        </div>
    </div>
    
    <script>
        // Dashboard data
        const dashboardData = {json.dumps(chart_data, indent=2, default=str)};
        
        // Initialize charts when page loads
        document.addEventListener('DOMContentLoaded', function() {{
            initializeCharts();
        }});
        
        function initializeCharts() {{
            createPerformanceTrendChart();
            createMemoryUsageChart();
            createResponseTimeChart();
        }}
        
        function createPerformanceTrendChart() {{
            const ctx = document.getElementById('performanceTrendChart').getContext('2d');
            const timeSeries = dashboardData.timeSeries;
            
            new Chart(ctx, {{
                type: 'line',
                data: {{
                    labels: timeSeries.map(d => new Date(d.timestamp).toLocaleTimeString()),
                    datasets: [{{
                        label: 'Swarm Init Time (s)',
                        data: timeSeries.map(d => d.swarm_init_time),
                        borderColor: 'rgb(75, 192, 192)',
                        backgroundColor: 'rgba(75, 192, 192, 0.1)',
                        tension: 0.1
                    }}, {{
                        label: 'Coordination Latency (ms)',
                        data: timeSeries.map(d => d.agent_coordination_latency),
                        borderColor: 'rgb(255, 99, 132)',
                        backgroundColor: 'rgba(255, 99, 132, 0.1)',
                        yAxisID: 'y1',
                        tension: 0.1
                    }}]
                }},
                options: {{
                    responsive: true,
                    interaction: {{
                        mode: 'index',
                        intersect: false,
                    }},
                    scales: {{
                        x: {{
                            display: true,
                            title: {{
                                display: true,
                                text: 'Time'
                            }}
                        }},
                        y: {{
                            type: 'linear',
                            display: true,
                            position: 'left',
                            title: {{
                                display: true,
                                text: 'Init Time (seconds)'
                            }}
                        }},
                        y1: {{
                            type: 'linear',
                            display: true,
                            position: 'right',
                            title: {{
                                display: true,
                                text: 'Latency (ms)'
                            }},
                            grid: {{
                                drawOnChartArea: false,
                            }},
                        }}
                    }}
                }}
            }});
        }}
        
        function createMemoryUsageChart() {{
            const ctx = document.getElementById('memoryUsageChart').getContext('2d');
            const timeSeries = dashboardData.timeSeries;
            
            new Chart(ctx, {{
                type: 'area',
                data: {{
                    labels: timeSeries.map(d => new Date(d.timestamp).toLocaleTimeString()),
                    datasets: [{{
                        label: 'Memory Usage (MB)',
                        data: timeSeries.map(d => d.memory_usage_mb),
                        borderColor: 'rgb(153, 102, 255)',
                        backgroundColor: 'rgba(153, 102, 255, 0.2)',
                        fill: true,
                        tension: 0.1
                    }}]
                }},
                options: {{
                    responsive: true,
                    plugins: {{
                        title: {{
                            display: true,
                            text: 'Memory Usage Trend'
                        }}
                    }},
                    scales: {{
                        y: {{
                            beginAtZero: true,
                            title: {{
                                display: true,
                                text: 'Memory (MB)'
                            }}
                        }}
                    }}
                }}
            }});
        }}
        
        function createResponseTimeChart() {{
            const ctx = document.getElementById('responseTimeChart').getContext('2d');
            const timeSeries = dashboardData.timeSeries;
            
            // Create histogram data
            const responseTimeBins = [0, 0.5, 1.0, 1.5, 2.0, 2.5];
            const binCounts = new Array(responseTimeBins.length - 1).fill(0);
            
            timeSeries.forEach(d => {{
                const responseTime = d.mcp_response_time;
                for (let i = 0; i < responseTimeBins.length - 1; i++) {{
                    if (responseTime >= responseTimeBins[i] && responseTime < responseTimeBins[i + 1]) {{
                        binCounts[i]++;
                        break;
                    }}
                }}
            }});
            
            new Chart(ctx, {{
                type: 'bar',
                data: {{
                    labels: responseTimeBins.slice(0, -1).map((bin, i) => 
                        `${{bin}}-${{responseTimeBins[i + 1]}}s`),
                    datasets: [{{
                        label: 'Response Time Distribution',
                        data: binCounts,
                        backgroundColor: 'rgba(54, 162, 235, 0.5)',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        borderWidth: 1
                    }}]
                }},
                options: {{
                    responsive: true,
                    plugins: {{
                        title: {{
                            display: true,
                            text: 'MCP Response Time Distribution'
                        }}
                    }},
                    scales: {{
                        y: {{
                            beginAtZero: true,
                            title: {{
                                display: true,
                                text: 'Frequency'
                            }}
                        }},
                        x: {{
                            title: {{
                                display: true,
                                text: 'Response Time Range'
                            }}
                        }}
                    }}
                }}
            }});
        }}
    </script>
</body>
</html>"""
        
        return html_template
    
    def _get_status(self, value: float, target: float) -> str:
        """Get status class based on value vs target."""
        if value <= target:
            return "good"
        elif value <= target * 1.2:
            return "warning"
        else:
            return "critical"
    
    def _generate_regression_html(self, regression_data: Dict[str, Any]) -> str:
        """Generate HTML for regression analysis section."""
        if not regression_data or "regression_analysis" not in regression_data:
            return "<p>No regression data available.</p>"
        
        analysis = regression_data["regression_analysis"]
        html_parts = []
        
        for metric_name, metric_data in analysis.items():
            regression_percent = metric_data.get("regression_percent", 0)
            regression_detected = metric_data.get("regression_detected", False)
            recent_avg = metric_data.get("recent_avg", 0)
            historical_avg = metric_data.get("historical_avg", 0)
            
            # Determine status class
            if regression_percent < -5:
                status_class = "improvement"
                icon = "🚀"
                status_text = "Improvement"
            elif regression_percent > 15:
                status_class = "critical"
                icon = "🚨"
                status_text = "Critical Regression"
            elif regression_percent > 5:
                status_class = "warning"
                icon = "⚠️"
                status_text = "Warning"
            else:
                status_class = ""
                icon = "✅"
                status_text = "Stable"
            
            html_parts.append(f"""
            <div class="regression-item {status_class}">
                <h4>{icon} {metric_name.replace('_', ' ').title()}</h4>
                <p><strong>Status:</strong> {status_text}</p>
                <p><strong>Change:</strong> {regression_percent:+.1f}%</p>
                <p><strong>Recent Average:</strong> {recent_avg:.2f}</p>
                <p><strong>Historical Average:</strong> {historical_avg:.2f}</p>
            </div>
            """)
        
        return "".join(html_parts)
    
    def _generate_csv_export(self, data: Dict[str, Any]):
        """Generate CSV export of performance data."""
        dashboard_data = data.get("last_24h", {})
        time_series = dashboard_data.get("time_series", [])
        
        if not time_series:
            return
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        csv_file = self.output_dir / f"performance_data_{timestamp}.csv"
        
        # Write CSV header and data
        with open(csv_file, 'w') as f:
            if time_series:
                # Write header
                headers = list(time_series[0].keys())
                f.write(",".join(headers) + "\n")
                
                # Write data rows
                for row in time_series:
                    values = [str(row.get(h, "")) for h in headers]
                    f.write(",".join(values) + "\n")
        
        print(f"📄 CSV export saved: {csv_file}")
    
    def _generate_json_export(self, data: Dict[str, Any]):
        """Generate JSON export of all dashboard data."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        json_file = self.output_dir / f"dashboard_data_{timestamp}.json"
        
        with open(json_file, 'w') as f:
            json.dump(data, f, indent=2, default=str)
        
        print(f"📋 JSON export saved: {json_file}")


def create_dashboard_server():
    """Create a simple HTTP server for the dashboard."""
    server_script = """#!/usr/bin/env python3
import http.server
import socketserver
import webbrowser
import os
from pathlib import Path

PORT = 8000
dashboard_dir = Path(__file__).parent / "dashboard_output"

class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(dashboard_dir), **kwargs)

if __name__ == "__main__":
    os.chdir(dashboard_dir)
    
    with socketserver.TCPServer(("", PORT), DashboardHandler) as httpd:
        print(f"🌐 Performance Dashboard Server started at http://localhost:{PORT}")
        print("📊 Available dashboards:")
        
        for file in dashboard_dir.glob("*.html"):
            print(f"   http://localhost:{PORT}/{file.name}")
        
        try:
            # Try to open in browser
            webbrowser.open(f"http://localhost:{PORT}/performance_dashboard_latest.html")
        except:
            pass
        
        print("\\nPress Ctrl+C to stop the server")
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\\n🛑 Dashboard server stopped")
"""
    
    server_file = Path("dashboard_server.py")
    with open(server_file, 'w') as f:
        f.write(server_script)
    
    # Make executable
    os.chmod(server_file, 0o755)
    
    print(f"✅ Dashboard server created: {server_file}")
    print(f"   Run with: python {server_file}")


def main():
    """Main entry point for dashboard generation."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Performance Dashboard Generator")
    parser.add_argument("--output-dir", default="dashboard_output", help="Output directory")
    parser.add_argument("--data-source", choices=["database", "sample"], default="database", help="Data source")
    parser.add_argument("--create-server", action="store_true", help="Create dashboard server script")
    parser.add_argument("--serve", action="store_true", help="Generate dashboard and start server")
    
    args = parser.parse_args()
    
    if args.create_server:
        create_dashboard_server()
        return
    
    # Generate dashboard
    dashboard = PerformanceDashboard(args.output_dir)
    dashboard_file = dashboard.generate_dashboard(args.data_source)
    
    if args.serve:
        import subprocess
        import webbrowser
        import time
        
        # Create server if it doesn't exist
        if not Path("dashboard_server.py").exists():
            create_dashboard_server()
        
        print("🌐 Starting dashboard server...")
        
        try:
            # Start server in background
            server_process = subprocess.Popen(
                ["python", "dashboard_server.py"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            # Give server time to start
            time.sleep(2)
            
            # Open in browser
            webbrowser.open("http://localhost:8000/performance_dashboard_latest.html")
            
            print("Dashboard is now running at http://localhost:8000")
            print("Press Ctrl+C to stop...")
            
            # Wait for user to stop
            server_process.wait()
            
        except KeyboardInterrupt:
            if 'server_process' in locals():
                server_process.terminate()
            print("\n🛑 Dashboard server stopped")


if __name__ == "__main__":
    main()