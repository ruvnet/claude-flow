#!/usr/bin/env node

/**
 * Task Manager CLI Application
 * Created by Claude Flow Swarm
 * 
 * Demonstrates:
 * - Multi-agent collaboration
 * - Task decomposition and execution
 * - Quality assurance through testing
 * - Comprehensive documentation
 */

class TaskManager {
    constructor() {
        this.tasks = [];
        this.nextId = 1;
    }

    addTask(description, priority = 'medium') {
        const task = {
            id: this.nextId++,
            description,
            priority,
            status: 'pending',
            createdAt: new Date(),
            swarmAgent: 'Developer-1'
        };
        this.tasks.push(task);
        return task;
    }

    listTasks() {
        return this.tasks;
    }

    completeTask(id) {
        const task = this.tasks.find(t => t.id === id);
        if (task) {
            task.status = 'completed';
            task.completedAt = new Date();
            task.swarmAgent = 'Executor-1';
        }
        return task;
    }

    getStats() {
        const total = this.tasks.length;
        const completed = this.tasks.filter(t => t.status === 'completed').length;
        const pending = total - completed;
        
        return {
            total,
            completed,
            pending,
            completionRate: total > 0 ? (completed / total * 100).toFixed(1) + '%' : '0%'
        };
    }
}

// CLI Interface
if (require.main === module) {
    const manager = new TaskManager();
    const args = process.argv.slice(2);
    const command = args[0];
    
    console.log('📋 Task Manager - Created by Swarm');
    console.log('==================================\n');
    
    switch (command) {
        case 'add':
            const task = manager.addTask(args.slice(1).join(' '));
            console.log(`✅ Task added: #${task.id} - ${task.description}`);
            break;
            
        case 'list':
            const tasks = manager.listTasks();
            if (tasks.length === 0) {
                console.log('No tasks found.');
            } else {
                tasks.forEach(t => {
                    const status = t.status === 'completed' ? '✓' : '○';
                    console.log(`${status} #${t.id} [${t.priority}] ${t.description}`);
                });
            }
            break;
            
        case 'complete':
            const completed = manager.completeTask(parseInt(args[1]));
            if (completed) {
                console.log(`✅ Task #${completed.id} marked as completed`);
            }
            break;
            
        case 'stats':
            const stats = manager.getStats();
            console.log('📊 Task Statistics:');
            console.log(`   Total: ${stats.total}`);
            console.log(`   Completed: ${stats.completed}`);
            console.log(`   Pending: ${stats.pending}`);
            console.log(`   Completion Rate: ${stats.completionRate}`);
            break;
            
        default:
            console.log('Usage:');
            console.log('  node task-manager.js add <description>');
            console.log('  node task-manager.js list');
            console.log('  node task-manager.js complete <id>');
            console.log('  node task-manager.js stats');
    }
    
    console.log('\n🐝 Created by Claude Flow Swarm agents working in parallel');
}

module.exports = TaskManager;
