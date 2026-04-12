import { describe, it, expect } from 'vitest';
import { isAQMError, toError, getErrorMessage } from '../../src/utils/error-utils.js';
import { PipelineError, ConfigError } from '../../src/types/errors.js';

describe('isAQMError', () => {
  it('returns true for AQMError subclass instances', () => {
    const err = new PipelineError('SOME_CODE', 'pipeline failed');
    expect(isAQMError(err)).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isAQMError(new Error('oops'))).toBe(false);
  });

  it('returns false for string', () => {
    expect(isAQMError('error string')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isAQMError(null)).toBe(false);
    expect(isAQMError(undefined)).toBe(false);
  });
});

describe('toError', () => {
  it('returns the same Error instance if already an Error', () => {
    const original = new Error('already error');
    expect(toError(original)).toBe(original);
  });

  it('wraps a string in a new Error', () => {
    const result = toError('something went wrong');
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('something went wrong');
  });

  it('wraps a number as String(value)', () => {
    const result = toError(42);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('42');
  });

  it('wraps an object via String()', () => {
    const result = toError({ code: 1 });
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('[object Object]');
  });

  it('wraps null', () => {
    const result = toError(null);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('null');
  });

  it('wraps undefined', () => {
    const result = toError(undefined);
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('undefined');
  });

  it('preserves AQMError subclass instance', () => {
    const aqmErr = new ConfigError('CFG_ERR', 'bad config');
    expect(toError(aqmErr)).toBe(aqmErr);
  });
});

describe('getErrorMessage', () => {
  describe('without options (backward compat)', () => {
    it('formats AQMError with code prefix', () => {
      const err = new PipelineError('PIPE_FAIL', 'pipeline failed');
      expect(getErrorMessage(err)).toBe('[PIPE_FAIL] pipeline failed');
    });

    it('returns message for plain Error', () => {
      expect(getErrorMessage(new Error('plain error'))).toBe('plain error');
    });

    it('returns "Unknown error" for unknown values', () => {
      expect(getErrorMessage('raw string')).toBe('Unknown error');
      expect(getErrorMessage(42)).toBe('Unknown error');
      expect(getErrorMessage(null)).toBe('Unknown error');
      expect(getErrorMessage(undefined)).toBe('Unknown error');
    });
  });

  describe('includeCause option', () => {
    it('appends cause from AQMError', () => {
      const cause = new Error('root cause');
      const err = new PipelineError('PIPE_FAIL', 'pipeline failed', {}, cause);
      const msg = getErrorMessage(err, { includeCause: true });
      expect(msg).toBe('[PIPE_FAIL] pipeline failed: root cause');
    });

    it('appends cause chain from nested AQMError', () => {
      const root = new Error('root');
      const mid = new PipelineError('MID', 'middle', {}, root);
      const top = new PipelineError('TOP', 'top level', {}, mid);
      const msg = getErrorMessage(top, { includeCause: true });
      expect(msg).toBe('[TOP] top level: [MID] middle: root');
    });

    it('appends cause from native Error with cause property', () => {
      const cause = new Error('native cause');
      const err = new Error('outer', { cause });
      const msg = getErrorMessage(err, { includeCause: true });
      expect(msg).toBe('outer: native cause');
    });

    it('does not append when cause is undefined', () => {
      const err = new PipelineError('NO_CAUSE', 'no cause here');
      const msg = getErrorMessage(err, { includeCause: true });
      expect(msg).toBe('[NO_CAUSE] no cause here');
    });

    it('behaves same as default when includeCause is false', () => {
      const cause = new Error('hidden');
      const err = new PipelineError('CODE', 'message', {}, cause);
      expect(getErrorMessage(err, { includeCause: false })).toBe('[CODE] message');
    });
  });
});
