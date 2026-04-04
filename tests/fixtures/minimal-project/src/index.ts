/**
 * Minimal TypeScript project for AQM E2E testing
 */

export function greet(name: string): string {
  return `Hello, ${name}!`;
}

export function add(a: number, b: number): number {
  return a + b;
}

// Default export for main functionality
export default function main(): void {
  console.log(greet('World'));
  console.log(`2 + 3 = ${add(2, 3)}`);
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}