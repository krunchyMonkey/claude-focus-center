// Claude Code hook entry point, copied to Focus Center's global storage and run as
//   node claude-focus-center-hook.js <EventName>
// It must never block Claude, never make a decision and never print to stdout.
// Placeholder until the event spool lands (issue 05): drain stdin and exit 0.
// Keep this file dependency-free: it runs outside VS Code with whatever node is installed.

process.stdin.on('data', () => undefined);
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));
// Safety net: never linger even if stdin is not closed.
setTimeout(() => process.exit(0), 2000).unref();
