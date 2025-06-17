/**
 * Test Suite for Notes CLI
 * Created by Swarm Agent: Tester-1
 * 
 * Comprehensive testing following TDD principles
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { NotesManager, Note } from './notes.js';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('Notes CLI Test Suite', () => {
    let manager;
    let tempDir;

    before(() => {
        // Create temporary directory for test data
        tempDir = mkdtempSync(join(tmpdir(), 'notes-test-'));
        process.env.HOME = tempDir;
        manager = new NotesManager();
    });

    after(() => {
        // Clean up
        rmSync(tempDir, { recursive: true, force: true });
    });

    describe('Note Creation', () => {
        it('should create a new note', () => {
            const note = manager.addNote('Test Note', 'Test content', ['test']);
            assert.strictEqual(note.title, 'Test Note');
            assert.strictEqual(note.content, 'Test content');
            assert.deepStrictEqual(note.tags, ['test']);
            assert.ok(note.id);
            assert.ok(note.createdAt);
        });

        it('should create note with empty content', () => {
            const note = manager.addNote('Empty Note', '', []);
            assert.strictEqual(note.content, '');
            assert.deepStrictEqual(note.tags, []);
        });
    });

    describe('Note Listing', () => {
        before(() => {
            manager.notes = [];
            manager.addNote('Note 1', 'Content 1', ['work']);
            manager.addNote('Note 2', 'Content 2', ['personal']);
            manager.addNote('Note 3', 'Content 3', ['work', 'important']);
        });

        it('should list all notes', () => {
            const notes = manager.listNotes();
            assert.strictEqual(notes.length, 3);
        });

        it('should filter notes by tag', () => {
            const workNotes = manager.listNotes('work');
            assert.strictEqual(workNotes.length, 2);
            
            const personalNotes = manager.listNotes('personal');
            assert.strictEqual(personalNotes.length, 1);
        });

        it('should sort notes by creation date (newest first)', () => {
            const notes = manager.listNotes();
            const dates = notes.map(n => new Date(n.createdAt));
            for (let i = 0; i < dates.length - 1; i++) {
                assert.ok(dates[i] >= dates[i + 1]);
            }
        });
    });

    describe('Note Search', () => {
        before(() => {
            manager.notes = [];
            manager.addNote('JavaScript Tutorial', 'Learn JS basics', ['programming', 'tutorial']);
            manager.addNote('Python Guide', 'Python programming guide', ['programming', 'python']);
            manager.addNote('Meeting Notes', 'Discuss project timeline', ['work', 'meeting']);
        });

        it('should search by title', () => {
            const results = manager.searchNotes('JavaScript');
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].title, 'JavaScript Tutorial');
        });

        it('should search by content', () => {
            const results = manager.searchNotes('timeline');
            assert.strictEqual(results.length, 1);
            assert.strictEqual(results[0].title, 'Meeting Notes');
        });

        it('should search by tag', () => {
            const results = manager.searchNotes('programming');
            assert.strictEqual(results.length, 2);
        });

        it('should be case-insensitive', () => {
            const results = manager.searchNotes('PYTHON');
            assert.strictEqual(results.length, 1);
        });
    });

    describe('Note Deletion', () => {
        it('should delete a note by ID', () => {
            const note = manager.addNote('To Delete', 'Delete me', []);
            const noteId = note.id;
            const initialCount = manager.notes.length;
            
            const deleted = manager.deleteNote(noteId);
            assert.ok(deleted);
            assert.strictEqual(deleted.id, noteId);
            assert.strictEqual(manager.notes.length, initialCount - 1);
        });

        it('should return null for non-existent ID', () => {
            const deleted = manager.deleteNote('non-existent-id');
            assert.strictEqual(deleted, null);
        });
    });

    describe('Note Updates', () => {
        it('should update a note', () => {
            const note = manager.addNote('Original', 'Original content', ['tag1']);
            const updated = manager.updateNote(note.id, {
                title: 'Updated',
                content: 'Updated content'
            });
            
            assert.strictEqual(updated.title, 'Updated');
            assert.strictEqual(updated.content, 'Updated content');
            assert.notStrictEqual(updated.updatedAt, note.createdAt);
        });
    });

    describe('Statistics', () => {
        before(() => {
            manager.notes = [];
            manager.addNote('Short', 'Hi', ['a']);
            manager.addNote('Medium', 'Hello world', ['a', 'b']);
            manager.addNote('Long', 'This is a longer note', ['b', 'c']);
        });

        it('should calculate correct statistics', () => {
            const stats = manager.getStats();
            assert.strictEqual(stats.totalNotes, 3);
            assert.strictEqual(stats.uniqueTags, 3);
            assert.deepStrictEqual(stats.tags.sort(), ['a', 'b', 'c']);
            assert.ok(stats.avgNoteLength > 0);
        });
    });
});

console.log('🧪 Test suite created by Swarm Agent: Tester-1');
console.log('✨ Quality threshold: 0.9 - All tests must pass!');
