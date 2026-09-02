// supabase-admin.js - Supabase Admin mode orchestration template
export function getSupabaseAdminOrchestration(taskDescription, memoryNamespace) {
  return `
## Task Orchestration Steps - Supabase MCP Mode

1. **Requirements Analysis & MCP Setup** (10 mins)
   - Analyze database requirements: "${taskDescription}"
   - Query existing project context:
     \`\`\`bash
     npx claude-flow memory query ${memoryNamespace}_architecture
     npx claude-flow memory query ${memoryNamespace}_data_models
     npx claude-flow memory query ${memoryNamespace}_auth_requirements
     \`\`\`
   - Connect to Supabase via MCP:
     - List organizations: \`list_organizations\`
     - List existing projects: \`list_projects\`
     - Get project details if exists
   - Review cost implications:
     - Use \`get_cost\` before creating resources
     - Confirm costs with user via \`confirm_cost\`
   - Store analysis: \`npx claude-flow memory store ${memoryNamespace}_supabase_requirements "Requirements: ${taskDescription}. Tables needed: users, profiles, permissions. Auth: Email + OAuth. Storage: user avatars, documents."\`

2. **Database Schema Design** (15 mins)
   - Design PostgreSQL schemas optimized for Supabase:
     - Normalize data structures
     - Plan for real-time subscriptions
     - Design for RLS efficiency
   - Define table relationships:
     - Foreign keys and constraints
     - Cascade rules
     - Junction tables for many-to-many
   - Plan indexes for performance:
     - Primary key indexes
     - Foreign key indexes
     - Composite indexes for queries
   - Design audit/history tables if needed
   - Create modular migration approach (<500 lines per file)
   - Store design: \`npx claude-flow memory store ${memoryNamespace}_db_design "Tables: users (id, email, created_at), profiles (user_id, full_name, avatar_url), roles (id, name), user_roles (user_id, role_id). Indexes: users_email_idx, profiles_user_id_idx."\`

3. **Schema Implementation via MCP** (20 mins)
   - Create development branch (if needed):
     - Check costs: \`get_cost type:"branch"\`
     - Create branch: \`create_branch\`
   - Implement schema using \`execute_sql\`:
     \`\`\`sql
     -- Create schemas
     CREATE SCHEMA IF NOT EXISTS auth_ext;
     CREATE SCHEMA IF NOT EXISTS app;
     
     -- Create tables
     CREATE TABLE app.profiles (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
       full_name TEXT,
       avatar_url TEXT,
       created_at TIMESTAMPTZ DEFAULT NOW()
     );
     \`\`\`
   - Add performance indexes
   - Create database functions and triggers
   - Set up audit trails
   - Store migrations: \`npx claude-flow memory store ${memoryNamespace}_migrations "Created: 5 tables, 8 indexes, 3 functions, 2 triggers. Branch: dev-${Date.now()}. Ready for RLS policies."\`

4. **Security & RLS Implementation** (15 mins)
   - Implement Row Level Security policies:
     - Enable RLS on all tables
     - Create policies for CRUD operations
     - Test policy effectiveness
   - Configure authentication:
     - Set up auth providers
     - Configure JWT claims
     - Create custom auth functions
   - Implement data access patterns:
     - User can only see own data
     - Role-based access for admins
     - Public read for certain tables
   - Create security functions:
     \`\`\`sql
     CREATE FUNCTION auth.user_has_role(role_name TEXT) 
     RETURNS BOOLEAN AS $$
       SELECT EXISTS (
         SELECT 1 FROM app.user_roles ur
         JOIN app.roles r ON ur.role_id = r.id
         WHERE ur.user_id = auth.uid() 
         AND r.name = role_name
       );
     $$ LANGUAGE SQL SECURITY DEFINER;
     \`\`\`
   - Store security config: \`npx claude-flow memory store ${memoryNamespace}_security "RLS enabled on all tables. Policies: 15 created (CRUD + special cases). Auth providers: email, google. Custom claims: user_role, organization_id."\`

5. **API & Storage Configuration** (10 mins)
   - Generate TypeScript types:
     - Use \`generate_typescript_types\`
     - Save to project repository
   - Configure storage buckets:
     - Create buckets for different file types
     - Set up access policies
     - Configure file size limits
   - Document API endpoints:
     - Get project URL: \`get_project_url\`
     - Get anon key: \`get_anon_key\`
     - Create API documentation
   - Set up Edge Functions (if needed)
   - Test API access patterns
   - Store completion: \`npx claude-flow memory store ${memoryNamespace}_supabase_complete "Supabase setup complete. API URL: https://xxx.supabase.co. Types generated. Storage buckets: avatars (public), documents (authenticated). Ready for integration."\`

## Deliverables
- migrations/
  - 001_initial_schema.sql
  - 002_create_profiles.sql
  - 003_add_indexes.sql
  - 004_rls_policies.sql
  - 005_auth_functions.sql
- types/
  - supabase.ts (generated types)
  - database.types.ts
- docs/
  - SCHEMA_DESIGN.md
  - RLS_POLICIES.md
  - API_ENDPOINTS.md
  - STORAGE_GUIDE.md
- config/
  - supabase-config.json
  - .env.example (with Supabase URLs)

## Supabase Best Practices
- NEVER expose service role key in code
- Always use RLS for data protection
- Test policies thoroughly before production
- Use \`execute_sql\` for data operations, not \`apply_migration\`
- Keep migration files modular and < 500 lines
- Document all custom functions and triggers
- Use parameterized queries to prevent SQL injection
- Monitor database performance and optimize queries

## MCP Tool Reminders
- Always check costs before creating resources
- Use development branches for testing
- Verify changes with \`list_tables\` and \`list_migrations\`
- Use \`get_logs\` to debug issues
- Test API access with generated types
- Document all database objects

## Next Steps
After Supabase setup:
- \`npx claude-flow sparc run code "Integrate Supabase client in application" --non-interactive\`
- \`npx claude-flow sparc run tdd "Write tests for Supabase operations" --non-interactive\`
- \`npx claude-flow sparc run docs-writer "Create Supabase integration guide" --non-interactive\``;
}
