#!/usr/bin/env node

/**
 * Notes CLI Application
 * Created by Claude Flow Swarm
 * 
 * Agent contributions:
 * - Developer-1: Core note management logic
 * - Developer-2: CLI interface and commands
 * - Tester-1: Test suite development
 * - Reviewer-1: Code quality assurance
 * - Documenter-1: Documentation and help text
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { program } from 'commander';
import chalk from 'chalk';

// Notes storage location
const NOTES_DIR = join(homedir(), '.notes-cli');
const NOTES_FILE = join(NOTES_DIR, 'notes.json');

// Ensure notes directory exists
if (!existsSync(NOTES_DIR)) {
    mkdirSync(NOTES_DIR, { recursive: true });
}

// Note class
class Note {
    constructor(title, content, tags = []) {
        this.id = Date.now().toString();
        this.title = title;
        this.content = content;
        this.tags = tags;
        this.createdAt = new Date().toISOString();
        this.updatedAt = new Date().toISOString();
        this.swarmAgent = 'Developer-1';
    }
}

// Notes Manager
class NotesManager {
    constructor() {
        this.notes = this.loadNotes();
    }

    loadNotes() {
        if (existsSync(NOTES_FILE)) {
            const data = readFileSync(NOTES_FILE, 'utf-8');
            return JSON.parse(data);
        }
        return [];
    }

    saveNotes() {
        writeFileSync(NOTES_FILE, JSON.stringify(this.notes, null, 2));
    }

    addNote(title, content, tags = []) {
        const note = new Note(title, content, tags);
        this.notes.push(note);
        this.saveNotes();
        return note;
    }

    listNotes(tag = null) {
        let notes = this.notes;
        if (tag) {
            notes = notes.filter(note => note.tags.includes(tag));
        }
        return notes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    searchNotes(query) {
        const lowercaseQuery = query.toLowerCase();
        return this.notes.filter(note => 
            note.title.toLowerCase().includes(lowercaseQuery) ||
            note.content.toLowerCase().includes(lowercaseQuery) ||
            note.tags.some(tag => tag.toLowerCase().includes(lowercaseQuery))
        );
    }

    deleteNote(id) {
        const index = this.notes.findIndex(note => note.id === id);
        if (index > -1) {
            const deleted = this.notes.splice(index, 1)[0];
            this.saveNotes();
            return deleted;
        }
        return null;
    }

    getNote(id) {
        return this.notes.find(note => note.id === id);
    }

    updateNote(id, updates) {
        const note = this.getNote(id);
        if (note) {
            Object.assign(note, updates);
            note.updatedAt = new Date().toISOString();
            note.swarmAgent = 'Developer-2';
            this.saveNotes();
            return note;
        }
        return null;
    }

    getStats() {
        const totalNotes = this.notes.length;
        const allTags = this.notes.flatMap(note => note.tags);
        const uniqueTags = [...new Set(allTags)];
        const avgNoteLength = totalNotes > 0 
            ? Math.round(this.notes.reduce((sum, note) => sum + note.content.length, 0) / totalNotes)
            : 0;

        return {
            totalNotes,
            uniqueTags: uniqueTags.length,
            tags: uniqueTags,
            avgNoteLength,
            oldestNote: this.notes.length > 0 ? this.notes[0].createdAt : null,
            newestNote: this.notes.length > 0 ? this.notes[this.notes.length - 1].createdAt : null
        };
    }
}

// CLI Setup
const manager = new NotesManager();

program
    .name('notes')
    .description('CLI tool for managing notes - Created by Claude Flow Swarm')
    .version('1.0.0');

// Add command
program
    .command('add <title>')
    .description('Add a new note')
    .option('-c, --content <content>', 'Note content')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .action((title, options) => {
        const content = options.content || '';
        const tags = options.tags ? options.tags.split(',').map(t => t.trim()) : [];
        const note = manager.addNote(title, content, tags);
        console.log(chalk.green('✅ Note added successfully!'));
        console.log(chalk.blue(`ID: ${note.id}`));
        console.log(chalk.blue(`Title: ${note.title}`));
        if (tags.length > 0) {
            console.log(chalk.blue(`Tags: ${tags.join(', ')}`));
        }
    });

// List command
program
    .command('list')
    .description('List all notes')
    .option('-t, --tag <tag>', 'Filter by tag')
    .action((options) => {
        const notes = manager.listNotes(options.tag);
        
        if (notes.length === 0) {
            console.log(chalk.yellow('No notes found.'));
            return;
        }

        console.log(chalk.blue(`\n📝 Notes (${notes.length}):\n`));
        notes.forEach(note => {
            console.log(chalk.green(`[${note.id}] ${note.title}`));
            if (note.content) {
                console.log(chalk.gray(`   ${note.content.substring(0, 50)}${note.content.length > 50 ? '...' : ''}`));
            }
            if (note.tags.length > 0) {
                console.log(chalk.cyan(`   Tags: ${note.tags.join(', ')}`));
            }
            console.log(chalk.gray(`   Created: ${new Date(note.createdAt).toLocaleString()}`));
            console.log();
        });
    });

// Search command
program
    .command('search <query>')
    .description('Search notes by title, content, or tags')
    .action((query) => {
        const notes = manager.searchNotes(query);
        
        if (notes.length === 0) {
            console.log(chalk.yellow(`No notes found matching "${query}".`));
            return;
        }

        console.log(chalk.blue(`\n🔍 Search results for "${query}" (${notes.length}):\n`));
        notes.forEach(note => {
            console.log(chalk.green(`[${note.id}] ${note.title}`));
            if (note.content) {
                console.log(chalk.gray(`   ${note.content.substring(0, 50)}${note.content.length > 50 ? '...' : ''}`));
            }
            console.log();
        });
    });

// Delete command
program
    .command('delete <id>')
    .description('Delete a note by ID')
    .action((id) => {
        const deleted = manager.deleteNote(id);
        if (deleted) {
            console.log(chalk.green(`✅ Note "${deleted.title}" deleted successfully!`));
        } else {
            console.log(chalk.red(`❌ Note with ID ${id} not found.`));
        }
    });

// View command
program
    .command('view <id>')
    .description('View a specific note')
    .action((id) => {
        const note = manager.getNote(id);
        if (note) {
            console.log(chalk.blue('\n📄 Note Details:\n'));
            console.log(chalk.green(`Title: ${note.title}`));
            console.log(chalk.white(`ID: ${note.id}`));
            console.log(chalk.white(`Content: ${note.content || '(empty)'}`));
            console.log(chalk.cyan(`Tags: ${note.tags.join(', ') || '(none)'}`));
            console.log(chalk.gray(`Created: ${new Date(note.createdAt).toLocaleString()}`));
            console.log(chalk.gray(`Updated: ${new Date(note.updatedAt).toLocaleString()}`));
            console.log(chalk.gray(`Created by: Swarm Agent ${note.swarmAgent}`));
        } else {
            console.log(chalk.red(`❌ Note with ID ${id} not found.`));
        }
    });

// Stats command
program
    .command('stats')
    .description('Show notes statistics')
    .action(() => {
        const stats = manager.getStats();
        console.log(chalk.blue('\n📊 Notes Statistics:\n'));
        console.log(chalk.white(`Total notes: ${stats.totalNotes}`));
        console.log(chalk.white(`Unique tags: ${stats.uniqueTags}`));
        console.log(chalk.white(`Average note length: ${stats.avgNoteLength} characters`));
        if (stats.tags.length > 0) {
            console.log(chalk.cyan(`\nTags: ${stats.tags.join(', ')}`));
        }
        console.log(chalk.gray(`\n🐝 Created by Claude Flow Swarm`));
    });

// Info command
program
    .command('info')
    .description('Show swarm creation information')
    .action(() => {
        console.log(chalk.blue('\n🐝 Claude Flow Swarm Information:\n'));
        console.log(chalk.white('This application was created through coordinated agent collaboration:'));
        console.log(chalk.green('  • Coordinator-1: Task decomposition and agent assignment'));
        console.log(chalk.green('  • Developer-1: Core note management implementation'));
        console.log(chalk.green('  • Developer-2: CLI interface and command structure'));
        console.log(chalk.green('  • Tester-1: Comprehensive test suite'));
        console.log(chalk.green('  • Reviewer-1: Code quality and best practices'));
        console.log(chalk.green('  • Documenter-1: Documentation and help text'));
        console.log(chalk.gray(`\nCreated with quality threshold: 0.9`));
        console.log(chalk.gray(`Parallel execution: enabled`));
        console.log(chalk.gray(`Strategy: development`));
    });

// Parse command line arguments
program.parse(process.argv);

// Export for testing
export { NotesManager, Note };
