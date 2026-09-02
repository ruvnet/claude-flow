#!/usr/bin/env python3

import os
import re
import subprocess
from typing import List, Tuple, Dict
from pathlib import Path

def fix_file(filepath: str) -> bool:
    """Fix common TypeScript errors in a file."""
    try:
        with open(filepath, 'r') as f:
            content = f.read()
        
        original_content = content
        
        # Fix 1: Remove duplicate .js extensions
        content = re.sub(r'\.js\.js', '.js', content)
        
        # Fix 2: Fix incorrect constructor replacements
        content = re.sub(r'\$1\$2override \$3\(', 'constructor(', content)
        content = re.sub(r'constructor\(event: SwarmEvent\)', 'emitSwarmEvent(event: SwarmEvent)', content)
        content = re.sub(r'constructor\(events: SwarmEvent\[\]\)', 'emitSwarmEvents(events: SwarmEvent[])', content)
        content = re.sub(r'constructor\(type: EventType', 'onSwarmEvent(type: EventType', content)
        content = re.sub(r'constructor\(predicate:', 'filterEvents(predicate:', content)
        content = re.sub(r'constructor\(correlationId:', 'correlateEvents(correlationId:', content)
        
        # Fix 3: Fix method signatures that should be methods, not constructors
        if 'extends BaseAgent' in content:
            # Fix executeTask method
            content = re.sub(r'constructor\(task: TaskDefinition\)', 'override async executeTask(task: TaskDefinition)', content)
            # Fix getAgentStatus method
            content = re.sub(r'constructor\(\): any {', 'override getAgentStatus(): any {', content)
        
        if 'class ResearchStrategy' in content:
            # Fix decompose method
            content = re.sub(r'constructor\(objective: SwarmObjective\): Promise<{', 'override async decompose(objective: SwarmObjective): Promise<{', content)
            # Fix getMetrics method
            content = re.sub(r'constructor\(\) {\n    return {', 'getMetrics() {\n    return {', content)
            # Fix refineScope method
            content = re.sub(r'constructor\(objective: SwarmObjective, intermediateResults:', 'async refineScope(objective: SwarmObjective, intermediateResults:', content)
            # Fix Promise resolve/setTimeout patterns
            content = re.sub(r'constructor\(\);', 'resolve();', content)
            content = re.sub(r'constructor\(checkConnection', 'setTimeout(checkConnection', content)
            content = re.sub(r'constructor\(config\);', 'super(config);', content)
            content = re.sub(r'constructor\(config: Partial<SwarmConfig>', 'constructor(config: Partial<SwarmConfig>', content)
        
        if 'class HttpTransport' in content:
            # Fix interface methods
            content = re.sub(r'constructor\(\): Promise<void> {', 'override async start(): Promise<void> {', content)
            content = re.sub(r'constructor\(handler: RequestHandler\)', 'override onRequest(handler: RequestHandler)', content)
            content = re.sub(r'constructor\(handler: NotificationHandler\)', 'override onNotification(handler: NotificationHandler)', content)
            content = re.sub(r'constructor\(request: MCPRequest\)', 'override async sendRequest(request: MCPRequest)', content)
            content = re.sub(r'constructor\(notification: MCPNotification\)', 'override async sendNotification(notification: MCPNotification)', content)
            # Fix other methods that got incorrectly replaced
            content = re.sub(r'constructor\(\): Promise<{', 'override async checkHealth(): Promise<{', content, count=1)
            content = re.sub(r'constructor\(\);', 'resolve();', content)
            
            # Find and fix specific async methods
            lines = content.split('\n')
            for i, line in enumerate(lines):
                if i > 0 and 'constructor(): Promise<void>' in line and 'override' not in line:
                    # Check context to determine which method this should be
                    if 'stopping' in lines[i+2].lower():
                        lines[i] = line.replace('constructor(): Promise<void>', 'override async stop(): Promise<void>')
                    elif 'connect' in lines[i+2].lower() and 'disconnect' not in lines[i+2].lower():
                        lines[i] = line.replace('constructor(): Promise<void>', 'override async connect(): Promise<void>')
                    elif 'disconnect' in lines[i+2].lower():
                        lines[i] = line.replace('constructor(): Promise<void>', 'override async disconnect(): Promise<void>')
            content = '\n'.join(lines)
        
        # Fix 4: Add override modifiers to methods that need them
        if 'extends BaseAgent' in content or 'extends BaseStrategy' in content:
            # Find methods that likely need override
            lines = content.split('\n')
            for i, line in enumerate(lines):
                # Check for async methods without override
                if re.match(r'^\s+async\s+\w+\(', line) and 'override' not in line and 'constructor' not in line:
                    method_name = re.search(r'async\s+(\w+)\(', line)
                    if method_name:
                        name = method_name.group(1)
                        if name in ['executeTask', 'decompose', 'refineScope', 'start', 'stop', 'connect', 'disconnect']:
                            lines[i] = line.replace('async', 'override async')
                # Check for non-async methods without override
                elif re.match(r'^\s+(\w+)\(.*\):\s*\w+', line) and 'override' not in line and 'constructor' not in line:
                    method_name = re.search(r'(\w+)\(', line)
                    if method_name:
                        name = method_name.group(1)
                        if name in ['getAgentStatus', 'getMetrics', 'onRequest', 'onNotification']:
                            lines[i] = re.sub(r'^(\s+)', r'\1override ', line)
            content = '\n'.join(lines)
        
        # Fix 5: Fix array push operations on never[]
        content = re.sub(r'\(\(([a-zA-Z0-9_]+) as any\[\]\)\.push\(', r'(\1 as any[]).push(', content)
        
        # Fix 6: Fix specific type imports
        if 'import type {' in content:
            # Check if types are used as values
            type_imports = re.findall(r'import type \{([^}]+)\}', content)
            for imports in type_imports:
                import_items = [item.strip() for item in imports.split(',')]
                for item in import_items:
                    # Check if the type is used as a value (common patterns)
                    if re.search(rf'\b{item}\.', content) or re.search(rf'new {item}\b', content):
                        # Convert type import to regular import
                        content = re.sub(
                            rf'import type \{{([^}}]*\b{item}\b[^}}]*)\}}',
                            r'import {\1}',
                            content,
                            count=1
                        )
        
        # Fix 7: Add missing imports for Node.js globals
        if '__dirname' in content and 'fileURLToPath' not in content:
            imports = [
                "import { dirname } from 'node:path';",
                "import { fileURLToPath } from 'node:url';",
                "const __dirname = dirname(fileURLToPath(import.meta.url));"
            ]
            lines = content.split('\n')
            # Find the first import or the beginning of the file
            insert_index = 0
            for i, line in enumerate(lines):
                if line.startswith('import'):
                    insert_index = i
                    break
            lines[insert_index:insert_index] = imports
            content = '\n'.join(lines)
        
        if original_content != content:
            with open(filepath, 'w') as f:
                f.write(content)
            return True
        return False
    except Exception as e:
        print(f"Error processing {filepath}: {e}")
        return False

def main():
    """Main function to fix TypeScript errors."""
    print("🔧 Starting comprehensive TypeScript fixes...")
    
    # Find all TypeScript files
    ts_files = []
    for root, dirs, files in os.walk('src'):
        for file in files:
            if file.endswith('.ts'):
                ts_files.append(os.path.join(root, file))
    
    print(f"📝 Found {len(ts_files)} TypeScript files")
    
    # Fix files
    fixed_count = 0
    for filepath in ts_files:
        if fix_file(filepath):
            fixed_count += 1
    
    print(f"✅ Fixed {fixed_count} files")
    
    # Run build to check remaining errors
    print("\n🔧 Running TypeScript build to check remaining errors...")
    result = subprocess.run(['npm', 'run', 'build:ts'], capture_output=True, text=True)
    
    # Count errors
    error_count = len([line for line in result.stderr.split('\n') if 'error TS' in line])
    print(f"\n📊 Remaining errors: {error_count}")
    
    # Show error summary
    if error_count > 0:
        error_types = {}
        for line in result.stderr.split('\n'):
            match = re.search(r'error TS(\d+):', line)
            if match:
                code = f"TS{match.group(1)}"
                error_types[code] = error_types.get(code, 0) + 1
        
        print("\n📊 Error summary:")
        for code, count in sorted(error_types.items(), key=lambda x: x[1], reverse=True)[:10]:
            print(f"  {code}: {count} errors")

if __name__ == "__main__":
    main()