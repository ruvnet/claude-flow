#!/bin/bash
# Fix AgentDB missing .js extensions in imports
# This is a workaround until agentdb@1.3.9 is fixed upstream

AGENTDB_INDEX="node_modules/agentdb/dist/controllers/index.js"

if [ -f "$AGENTDB_INDEX" ]; then
  echo "🔧 Fixing AgentDB import extensions..."

  # Fix missing .js extensions
  sed -i "s/from '\.\/ReflexionMemory'/from '.\/ReflexionMemory.js'/g" "$AGENTDB_INDEX"
  sed -i "s/from '\.\/SkillLibrary'/from '.\/SkillLibrary.js'/g" "$AGENTDB_INDEX"
  sed -i "s/from '\.\/EmbeddingService'/from '.\/EmbeddingService.js'/g" "$AGENTDB_INDEX"

  echo "✅ AgentDB imports fixed"
else
  echo "⚠️  AgentDB not installed, skipping patch"
fi
