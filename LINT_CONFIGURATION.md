# Lint Configuration Notes

## Deno Lint Rules

This project uses Deno's recommended lint rules with one important exception:

### Disabled Rules

#### `prefer-ascii` - **DISABLED**

**Decision**: We allow Unicode characters (including emojis) in our codebase for enhanced user experience.

**Rationale**: 
- Claude-Flow is a modern developer tool targeting contemporary terminals
- Emojis significantly improve readability and user experience in CLI output
- Most target environments (modern terminals, CI systems, IDEs) support Unicode well

**Risks Acknowledged**:
- **Cross-platform compatibility**: Some older systems may not render emojis correctly
- **Terminal compatibility**: Legacy terminals might display garbled characters  
- **Log parsing**: Automated log processing tools may have issues with Unicode
- **File encoding**: Potential problems in environments with ASCII-only encoding
- **Accessibility**: Screen readers may handle emojis inconsistently

**Mitigation Strategies**:
- Monitor for user reports of display issues
- Consider adding a `--no-emoji` flag for environments with poor Unicode support
- Use emojis primarily in user-facing output, not in logs or data files
- Document Unicode requirements in system requirements

**Review Schedule**: 
This decision should be reviewed if:
- Significant user reports of display issues
- CI/CD environments show Unicode problems  
- Accessibility concerns are raised
- Corporate environments require ASCII-only output

## Other Lint Rules

All other Deno recommended rules are enabled, including:
- `no-console` - Enforced with explicit exemptions for CLI tools
- `no-explicit-any` - Enforced for type safety
- `prefer-const` - Enforced for code quality
- `no-await-in-loop` - Enforced with explicit exemptions where sequential processing is required

See `deno.json` for the complete configuration.