#!/usr/bin/env python3
"""
AI-Powered Code Quality & Issue Analysis Agent
Automatically analyzes code quality, security, and architectural issues
"""

import os
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
import requests
from typing import Dict, List, Any, Optional

class CodeQualityAgent:
    def __init__(self):
        self.repo_root = Path.cwd()

        # Try multiple environment variable names for OpenAI API key
        self.openai_api_key = (
            os.environ.get('OPENAI_API_KEY') or
            os.environ.get('OPENAI_KEY') or
            os.environ.get('OPENAI_TOKEN')
        )

        self.github_token = os.environ.get('GITHUB_TOKEN')
        self.pr_number = os.environ.get('PR_NUMBER')

        # Debug environment variables
        print(f"🔍 Environment check:")
        print(f"   OpenAI API Key: {'✅ Found' if self.openai_api_key else '❌ Not found'}")
        print(f"   GitHub Token: {'✅ Found' if self.github_token else '❌ Not found'}")
        print(f"   PR Number: {self.pr_number or 'Not set (normal for local runs)'}")

        self.analysis_results = {
            'timestamp': datetime.now().isoformat(),
            'issues': [],
            'suggestions': [],
            'security_concerns': [],
            'typescript_errors': [],
            'architectural_concerns': []
        }

    def run_typescript_check(self) -> Dict[str, Any]:
        """Run TypeScript strict mode check and capture errors"""
        try:
            result = subprocess.run(
                ['npm', 'run', 'check:strict'],
                capture_output=True,
                text=True,
                cwd=self.repo_root
            )
            
            return {
                'success': result.returncode == 0,
                'stdout': result.stdout,
                'stderr': result.stderr,
                'error_count': result.stderr.count('error TS') if result.stderr else 0
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    def run_security_audit(self) -> Dict[str, Any]:
        """Run npm security audit"""
        try:
            result = subprocess.run(
                ['npm', 'audit', '--json'],
                capture_output=True,
                text=True,
                cwd=self.repo_root
            )
            
            if result.stdout:
                audit_data = json.loads(result.stdout)
                return {
                    'vulnerabilities': audit_data.get('vulnerabilities', {}),
                    'metadata': audit_data.get('metadata', {})
                }
        except Exception as e:
            return {'error': str(e)}
        
        return {}

    def analyze_code_with_ai(self, code_snippet: str, file_path: str) -> Optional[Dict[str, Any]]:
        """Analyze code snippet with OpenAI for quality issues"""
        if not self.openai_api_key:
            print("⚠️ OpenAI API key not found - skipping AI analysis")
            return None

        prompt = f"""
        Analyze this TypeScript/JavaScript code for:
        1. Code quality issues
        2. Security vulnerabilities
        3. Architectural concerns
        4. Performance issues
        5. Maintainability problems

        File: {file_path}
        Code:
        ```
        {code_snippet}
        ```

        Respond with JSON format:
        {{
            "issues": [
                {{"type": "quality|security|architecture|performance", "severity": "high|medium|low", "description": "...", "line": number}}
            ],
            "suggestions": ["..."],
            "score": 1-10
        }}
        """

        try:
            # Try different model names in case codex-mini-latest isn't available
            models_to_try = ['gpt-3.5-turbo', 'gpt-4o-mini', 'gpt-4', 'codex-mini-latest']

            for model in models_to_try:
                try:
                    print(f"🤖 Trying AI analysis with model: {model}")
                    response = requests.post(
                        'https://api.openai.com/v1/chat/completions',
                        headers={
                            'Authorization': f'Bearer {self.openai_api_key}',
                            'Content-Type': 'application/json'
                        },
                        json={
                            'model': model,
                            'messages': [{'role': 'user', 'content': prompt}],
                            'temperature': 0.1,
                            'max_tokens': 1000
                        },
                        timeout=30
                    )

                    if response.status_code == 200:
                        content = response.json()['choices'][0]['message']['content']
                        print(f"✅ AI analysis successful with model: {model}")
                        # Try to extract JSON from the response
                        start = content.find('{')
                        end = content.rfind('}') + 1
                        if start != -1 and end != 0:
                            return json.loads(content[start:end])
                        else:
                            # If no JSON found, create a simple response
                            return {
                                "issues": [],
                                "suggestions": [content[:200] + "..." if len(content) > 200 else content],
                                "score": 7
                            }
                    else:
                        print(f"❌ Model {model} failed with status: {response.status_code}")
                        if response.status_code == 404:
                            continue  # Try next model
                        else:
                            print(f"Error response: {response.text}")

                except requests.exceptions.RequestException as e:
                    print(f"❌ Request error with model {model}: {e}")
                    continue

        except Exception as e:
            print(f"❌ AI analysis error: {e}")

        return None

    def get_changed_files(self) -> List[str]:
        """Get list of changed files in the current PR or recent commits"""
        try:
            if self.pr_number:
                # Get PR diff files
                result = subprocess.run(
                    ['git', 'diff', '--name-only', 'origin/main...HEAD'],
                    capture_output=True,
                    text=True,
                    cwd=self.repo_root
                )
            else:
                # For manual runs or when no PR, get recent changes or all files
                result = subprocess.run(
                    ['git', 'diff', '--name-only', 'HEAD~1', 'HEAD'],
                    capture_output=True,
                    text=True,
                    cwd=self.repo_root
                )

            if result.returncode == 0:
                files = [f.strip() for f in result.stdout.split('\n') if f.strip()]
                # Filter for TypeScript/JavaScript files
                ts_js_files = [f for f in files if f.endswith(('.ts', '.js', '.tsx', '.jsx'))]

                # If no changed files found, analyze some key files for manual runs
                if not ts_js_files and not self.pr_number:
                    print("🔍 No changed files found, analyzing key source files...")
                    # Get all TypeScript/JavaScript files in src directory
                    all_files_result = subprocess.run(
                        ['find', 'src', '-name', '*.ts', '-o', '-name', '*.js', '-o', '-name', '*.tsx', '-o', '-name', '*.jsx'],
                        capture_output=True,
                        text=True,
                        cwd=self.repo_root
                    )
                    if all_files_result.returncode == 0:
                        all_files = [f.strip() for f in all_files_result.stdout.split('\n') if f.strip()]
                        # Return first 10 files for analysis
                        return all_files[:10]

                return ts_js_files
        except Exception as e:
            print(f"Error getting changed files: {e}")

        # Fallback: analyze some key files
        try:
            print("🔍 Fallback: analyzing key source files...")
            fallback_result = subprocess.run(
                ['find', 'src', '-name', '*.ts', '-o', '-name', '*.js'],
                capture_output=True,
                text=True,
                cwd=self.repo_root
            )
            if fallback_result.returncode == 0:
                files = [f.strip() for f in fallback_result.stdout.split('\n') if f.strip()]
                return files[:5]  # Analyze first 5 files
        except Exception as e:
            print(f"Fallback error: {e}")

        return []

    def analyze_file(self, file_path: str) -> None:
        """Analyze a single file for issues"""
        try:
            full_path = self.repo_root / file_path
            if not full_path.exists():
                return

            with open(full_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Basic static analysis
            issues = []
            
            # Check for potential security issues
            if 'eval(' in content:
                issues.append({
                    'type': 'security',
                    'severity': 'high',
                    'description': 'Use of eval() detected - potential security risk',
                    'file': file_path
                })
            
            if 'innerHTML' in content and 'sanitize' not in content.lower():
                issues.append({
                    'type': 'security',
                    'severity': 'medium',
                    'description': 'innerHTML usage without sanitization',
                    'file': file_path
                })

            # Check for code quality issues
            if content.count('any') > 5:
                issues.append({
                    'type': 'quality',
                    'severity': 'medium',
                    'description': 'Excessive use of "any" type - consider proper typing',
                    'file': file_path
                })

            # AI-powered analysis (if API key available)
            if self.openai_api_key and len(content) < 5000:  # Limit size for API
                print(f"🤖 Running AI analysis on {file_path}...")
                ai_analysis = self.analyze_code_with_ai(content[:2000], file_path)
                if ai_analysis:
                    print(f"✅ AI analysis completed for {file_path}")
                    for issue in ai_analysis.get('issues', []):
                        issue['file'] = file_path
                        issues.append(issue)

                    self.analysis_results['suggestions'].extend(
                        [f"{file_path}: {s}" for s in ai_analysis.get('suggestions', [])]
                    )
                else:
                    print(f"⚠️ AI analysis failed for {file_path}")
            elif not self.openai_api_key:
                print(f"⚠️ Skipping AI analysis for {file_path} (no API key)")
            else:
                print(f"⚠️ Skipping AI analysis for {file_path} (file too large: {len(content)} chars)")

            self.analysis_results['issues'].extend(issues)

        except Exception as e:
            print(f"Error analyzing {file_path}: {e}")

    def generate_report(self) -> str:
        """Generate a comprehensive analysis report"""
        ts_check = self.run_typescript_check()
        security_audit = self.run_security_audit()
        
        # Analyze changed files
        changed_files = self.get_changed_files()
        print(f"📁 Found {len(changed_files)} files to analyze")

        if not changed_files:
            print("⚠️ No files found for analysis")
        else:
            for i, file_path in enumerate(changed_files[:10], 1):  # Limit to 10 files
                print(f"🔍 Analyzing file {i}/{min(len(changed_files), 10)}: {file_path}")
                self.analyze_file(file_path)

        # Generate report
        report = f"""# 🤖 AI Code Quality Analysis Report

**Generated:** {self.analysis_results['timestamp']}
**Analyzed Files:** {len(changed_files)}

## 📊 Summary

"""

        # TypeScript Analysis
        if ts_check.get('success'):
            report += "✅ **TypeScript Strict Mode:** PASSED\n"
        else:
            error_count = ts_check.get('error_count', 0)
            report += f"❌ **TypeScript Strict Mode:** FAILED ({error_count} errors)\n"
            if ts_check.get('stderr'):
                report += f"```\n{ts_check['stderr'][:500]}...\n```\n"

        # Security Analysis
        vulnerabilities = security_audit.get('vulnerabilities', {})
        if vulnerabilities:
            high_vuln = sum(1 for v in vulnerabilities.values() if v.get('severity') == 'high')
            report += f"🔒 **Security Vulnerabilities:** {len(vulnerabilities)} found ({high_vuln} high severity)\n"
        else:
            report += "✅ **Security Audit:** No vulnerabilities found\n"

        # Code Quality Issues
        issues_by_severity = {}
        for issue in self.analysis_results['issues']:
            severity = issue.get('severity', 'unknown')
            issues_by_severity[severity] = issues_by_severity.get(severity, 0) + 1

        report += f"\n## 🔍 Code Quality Issues\n"
        for severity in ['high', 'medium', 'low']:
            count = issues_by_severity.get(severity, 0)
            emoji = "🔴" if severity == 'high' else "🟡" if severity == 'medium' else "🟢"
            report += f"{emoji} **{severity.title()}:** {count}\n"

        # Detailed Issues
        if self.analysis_results['issues']:
            report += f"\n## 📋 Detailed Issues\n"
            for issue in self.analysis_results['issues'][:10]:  # Limit to 10
                report += f"- **{issue.get('type', 'unknown').title()}** ({issue.get('severity', 'unknown')}): {issue.get('description', 'No description')}\n"
                if issue.get('file'):
                    report += f"  - File: `{issue['file']}`\n"

        # Suggestions
        if self.analysis_results['suggestions']:
            report += f"\n## 💡 AI Suggestions\n"
            for suggestion in self.analysis_results['suggestions'][:5]:
                report += f"- {suggestion}\n"

        return report

    def post_pr_comment(self, report: str) -> bool:
        """Post the analysis report as a PR comment"""
        if not self.github_token or not self.pr_number:
            return False

        try:
            repo = os.environ.get('GITHUB_REPOSITORY')
            if not repo:
                return False

            url = f"https://api.github.com/repos/{repo}/issues/{self.pr_number}/comments"
            
            response = requests.post(
                url,
                headers={
                    'Authorization': f'token {self.github_token}',
                    'Accept': 'application/vnd.github.v3+json'
                },
                json={'body': report}
            )
            
            return response.status_code == 201
        except Exception as e:
            print(f"Error posting PR comment: {e}")
            return False

def main():
    agent = CodeQualityAgent()
    
    print("🤖 Starting AI Code Quality Analysis...")
    
    # Generate analysis report
    report = agent.generate_report()
    
    # Save report to file
    report_file = Path('ai-code-quality-report.md')
    with open(report_file, 'w') as f:
        f.write(report)
    
    print(f"📄 Report saved to: {report_file}")
    
    # Post to PR if in PR context
    if agent.pr_number:
        if agent.post_pr_comment(report):
            print("✅ Posted analysis to PR comment")
        else:
            print("❌ Failed to post PR comment")
    
    # Print summary to console
    print("\n" + "="*50)
    print(report)
    
    # Exit with error code if critical issues found
    critical_issues = [i for i in agent.analysis_results['issues'] if i.get('severity') == 'high']
    if critical_issues:
        print(f"\n❌ Found {len(critical_issues)} critical issues")
        sys.exit(1)
    else:
        print("\n✅ No critical issues found")

if __name__ == "__main__":
    main()
