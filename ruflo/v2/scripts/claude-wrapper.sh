#!/bin/bash
# Claude wrapper script to handle TTY issues

# Check if we're in a TTY
if [ -t 0 ]; then
    # We have a TTY, run normally
    exec claude "$@"
else
    # No TTY, use script command to create a pseudo-TTY
    if command -v script >/dev/null 2>&1; then
        # Linux version of script
        exec script -q -c "claude $*" /dev/null
    else
        # Fallback: run without TTY (may cause issues)
        exec claude "$@"
    fi
fi