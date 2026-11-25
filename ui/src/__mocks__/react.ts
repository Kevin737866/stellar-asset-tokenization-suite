/**
 * Minimal React stub for the Node test environment.
 *
 * Full React rendering is not needed for the logic-only tests in this suite.
 * This stub prevents crashes caused by DOM/browser-only code paths in React
 * when tests run under testEnvironment: 'node'.
 */

// Keep a reference to the real React for class-component infrastructure so
// DashboardErrorBoundary (which extends React.Component) works correctly.
const React = jest.requireActual('react');

module.exports = React;
