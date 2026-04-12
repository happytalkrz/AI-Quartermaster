import { describe, it, expect } from 'vitest';
import {
  sanitizeErrorMessage,
  sanitizeCliError,
  sanitizeGitError,
  sanitizeGhError,
} from '../../src/utils/error-sanitizer.js';

describe('Error Sanitizer', () => {
  describe('sanitizeErrorMessage', () => {
    it('should sanitize GitHub tokens', () => {
      const message = 'Error: Authentication failed with token ghp_1234567890abcdef1234567890abcdef123456';
      const result = sanitizeErrorMessage(message);
      expect(result).toBe('Error: Authentication failed with token [REDACTED]');
    });

    it('should sanitize home directory paths', () => {
      const message = 'Error: File not found at /home/username/secret.txt';
      const result = sanitizeErrorMessage(message);
      expect(result).toBe('Error: File not found at [REDACTED]/secret.txt');
    });

    it('should sanitize email addresses', () => {
      const message = 'Error: Failed to send to user@example.com';
      const result = sanitizeErrorMessage(message);
      expect(result).toBe('Error: Failed to send to [REDACTED]');
    });

    it('should sanitize IP addresses', () => {
      const message = 'Error: Connection failed to 192.168.1.1';
      const result = sanitizeErrorMessage(message);
      expect(result).toBe('Error: Connection failed to [REDACTED]');
    });

    it('should sanitize long hash values', () => {
      const message = 'Error: Commit abc123def456789012345678 not found';
      const result = sanitizeErrorMessage(message);
      expect(result).toBe('Error: Commit [HASH] not found');
    });

    it('should truncate very long messages', () => {
      const longMessage = 'Error: ' + 'x'.repeat(200);
      const result = sanitizeErrorMessage(longMessage);
      expect(result.length).toBeLessThanOrEqual(200);
      expect(result).toMatch(/\.\.\.$/);
    });

    it('should handle empty or invalid input', () => {
      expect(sanitizeErrorMessage('')).toBe('An error occurred');
      expect(sanitizeErrorMessage(null as any)).toBe('An error occurred');
      expect(sanitizeErrorMessage(undefined as any)).toBe('An error occurred');
    });

    it('should handle normal error messages', () => {
      const message = 'Error: File not found';
      const result = sanitizeErrorMessage(message);
      expect(result).toBe('Error: File not found');
    });

    it('should sanitize stack trace absolute paths', () => {
      const message = 'Error: something failed\n    at Object.<anonymous> (/home/user/project/src/index.ts:10:5)';
      const result = sanitizeErrorMessage(message);
      expect(result).not.toContain('/home/user/project/src/index.ts');
      expect(result).toContain('[REDACTED]');
    });

    it('should sanitize /root/ paths', () => {
      const message = 'Error: config not found at /root/.config/app/settings.json';
      const result = sanitizeErrorMessage(message);
      expect(result).not.toContain('/root/.config/app/settings.json');
      expect(result).toContain('[REDACTED]');
    });

    it('should sanitize /var/ paths', () => {
      const message = 'Error: log file /var/log/app/error.log is missing';
      const result = sanitizeErrorMessage(message);
      expect(result).not.toContain('/var/log/app/error.log');
      expect(result).toContain('[REDACTED]');
    });

    it('should sanitize /tmp/ paths', () => {
      const message = 'Error: temp file /tmp/aqm-work-abc123/output not found';
      const result = sanitizeErrorMessage(message);
      expect(result).not.toContain('/tmp/aqm-work-abc123/output');
      expect(result).toContain('[REDACTED]');
    });

    it('should sanitize Windows absolute paths', () => {
      const message = 'Error: file not found C:\\Users\\username\\project\\src\\main.ts';
      const result = sanitizeErrorMessage(message);
      expect(result).not.toContain('C:\\Users\\username\\project');
      expect(result).toContain('[REDACTED]');
    });
  });

  describe('sanitizeCliError', () => {
    it('should use stderr over stdout', () => {
      const stderr = 'Permission denied with token ghp_secret123';
      const stdout = 'Success';
      const result = sanitizeCliError(stderr, stdout);
      expect(result).toBe('Permission denied with token [REDACTED]');
    });

    it('should use stdout when stderr is empty', () => {
      const stderr = '';
      const stdout = 'Error: invalid token ghp_secret123';
      const result = sanitizeCliError(stderr, stdout);
      expect(result).toBe('Error: invalid token [REDACTED]');
    });

    it('should use fallback when both are empty', () => {
      const result = sanitizeCliError('', '', 'Custom fallback');
      expect(result).toBe('Custom fallback');
    });

    it('should use default fallback', () => {
      const result = sanitizeCliError('', '');
      expect(result).toBe('Command failed');
    });
  });

  describe('sanitizeGitError', () => {
    it('should handle permission denied errors', () => {
      const stderr = 'Permission denied (publickey).\r\nfatal: Could not read from remote repository.';
      const result = sanitizeGitError(stderr, 'push');
      expect(result).toBe('Git push failed: Permission denied');
    });

    it('should handle not a git repository errors', () => {
      const stderr = 'fatal: not a git repository (or any of the parent directories): .git';
      const result = sanitizeGitError(stderr, 'status');
      expect(result).toBe('Git status failed: Not a git repository');
    });

    it('should handle remote repository errors', () => {
      const stderr = 'fatal: remote origin already exists.';
      const result = sanitizeGitError(stderr, 'remote add');
      expect(result).toBe('Git remote add failed: Remote repository issue');
    });

    it('should handle push failures', () => {
      const stderr = 'error: failed to push some refs to git@github.com:user/repo.git';
      const result = sanitizeGitError(stderr, 'push');
      expect(result).toBe('Git push failed: Push rejected');
    });

    it('should handle merge conflicts', () => {
      const stderr = 'CONFLICT (content): Merge conflict in file.txt';
      const result = sanitizeGitError(stderr, 'merge');
      expect(result).toBe('Git merge failed: Merge conflict detected');
    });

    it('should handle generic git errors with sanitization', () => {
      const stderr = 'fatal: unable to access https://github.com/user/repo.git/: The requested URL returned error: 403';
      const result = sanitizeGitError(stderr, 'clone');
      expect(result).toContain('Git clone failed:');
      expect(result).not.toContain('https://github.com/user/repo.git');
    });

    it('should handle empty stderr', () => {
      const result = sanitizeGitError('', 'status');
      expect(result).toBe('Git status failed');
    });
  });

  describe('sanitizeGhError', () => {
    it('should handle authentication errors', () => {
      const stderr = 'authentication required\nHTTP 401: Unauthorized';
      const result = sanitizeGhError(stderr, '', 'issue view');
      expect(result).toBe('GitHub issue view failed: Authentication required');
    });

    it('should handle not found errors', () => {
      const stderr = 'HTTP 404: Not Found';
      const result = sanitizeGhError(stderr, '', 'repo view');
      expect(result).toBe('GitHub repo view failed: Resource not found');
    });

    it('should handle rate limit errors', () => {
      const stderr = 'HTTP 429: rate limit exceeded';
      const result = sanitizeGhError(stderr, '', 'api call');
      expect(result).toBe('GitHub api call failed: Rate limit exceeded');
    });

    it('should handle permission errors', () => {
      const stderr = 'HTTP 403: Forbidden';
      const result = sanitizeGhError(stderr, '', 'push');
      expect(result).toBe('GitHub push failed: Permission denied');
    });

    it('should handle generic errors with sanitization', () => {
      const stderr = 'failed to authenticate with token ghp_secrettoken123';
      const result = sanitizeGhError(stderr, '', 'auth');
      expect(result).toBe('GitHub auth failed: failed to authenticate with token [REDACTED]');
    });

    it('should prefer stderr over stdout', () => {
      const stderr = 'authentication required';
      const stdout = 'some output with ghp_token123';
      const result = sanitizeGhError(stderr, stdout, 'test');
      expect(result).toBe('GitHub test failed: Authentication required');
    });

    it('should use stdout when stderr is empty', () => {
      const stderr = '';
      const stdout = 'Error: token ghp_secret123 invalid';
      const result = sanitizeGhError(stderr, stdout, 'test');
      expect(result).toBe('GitHub test failed: Error: token [REDACTED] invalid');
    });

    it('should handle empty input', () => {
      const result = sanitizeGhError('', '', 'test');
      expect(result).toBe('GitHub test failed');
    });
  });
});