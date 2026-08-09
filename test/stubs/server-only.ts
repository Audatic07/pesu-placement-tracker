/**
 * Stand-in for the `server-only` package under test.
 *
 * The real package throws on import to stop server code being pulled into a
 * client bundle. That guard is correct in the app and useless in a test runner,
 * where it would simply make every server module unimportable.
 */
export {};
