import { describe, it, expect } from 'vitest';
import { greet, add } from '../src/index.js';

describe('greet', () => {
  it('returns greeting with name', () => {
    expect(greet('World')).toBe('Hello, World!');
  });

  it('returns greeting with custom name', () => {
    expect(greet('AQM')).toBe('Hello, AQM!');
  });
});

describe('add', () => {
  it('adds two numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('handles zero', () => {
    expect(add(0, 0)).toBe(0);
  });
});
