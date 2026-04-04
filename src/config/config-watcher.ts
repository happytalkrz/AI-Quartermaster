import { watch, FSWatcher, existsSync } from "fs";
import { resolve } from "path";
import { EventEmitter } from "events";
import { getLogger } from "../utils/logger.js";

const logger = getLogger();

export interface ConfigChangeEvent {
  type: 'base' | 'local' | 'both';
  paths: string[];
}

export class ConfigWatcher extends EventEmitter {
  private projectRoot: string;
  private baseConfigPath: string;
  private localConfigPath: string;
  private watchers: Map<string, FSWatcher> = new Map();
  private debounceTimer: NodeJS.Timeout | null = null;
  private pendingChanges: Set<string> = new Set();
  private errorCounts: Map<string, number> = new Map();
  private readonly maxErrorRetries = 3;
  private readonly errorRetryDelay = 1000; // 1 second

  constructor(projectRoot: string) {
    super();
    this.projectRoot = resolve(projectRoot);
    this.baseConfigPath = resolve(this.projectRoot, "config.yml");
    this.localConfigPath = resolve(this.projectRoot, "config.local.yml");
  }

  startWatching(): void {
    this.stopWatching(); // Ensure clean state

    // Watch base config.yml (required)
    this.watchFile(this.baseConfigPath, 'base');

    // Watch local config.local.yml if it exists
    if (existsSync(this.localConfigPath)) {
      this.watchFile(this.localConfigPath, 'local');
    }

    // Also watch the project directory to catch creation of config.local.yml
    this.watchDirectory();

    logger.info(`Started watching config files in: ${this.projectRoot}`);
  }

  stopWatching(): void {
    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Close all watchers with enhanced error handling
    for (const [path, watcher] of this.watchers.entries()) {
      try {
        // Remove all listeners to prevent memory leaks
        watcher.removeAllListeners();
        watcher.close();
        logger.debug(`Stopped watching: ${path}`);
      } catch (err: unknown) {
        logger.warn(`Error closing watcher for ${path}: ${err}`);
      }
    }

    // Clear all maps and sets
    this.watchers.clear();
    this.pendingChanges.clear();
    this.errorCounts.clear();

    logger.info('Stopped watching config files - all resources cleaned');
  }

  private registerWatcher(filePath: string, type: 'base' | 'local', watcher: FSWatcher): void {
    watcher.on('error', (error) => {
      this.handleWatcherError(filePath, type, error);
    });
    this.watchers.set(filePath, watcher);
    this.errorCounts.set(filePath, 0);
  }

  private watchFile(filePath: string, type: 'base' | 'local'): void {
    try {
      const watcher = watch(filePath, { persistent: false }, (eventType) => {
        this.handleFileEvent(filePath, type, eventType);
      });
      this.registerWatcher(filePath, type, watcher);
      logger.debug(`Started watching file: ${filePath}`);
    } catch (err: unknown) {
      logger.error(`Failed to watch file ${filePath}: ${err}`);
      this.handleWatcherError(filePath, type, err);
    }
  }

  private watchDirectory(): void {
    try {
      const watcher = watch(this.projectRoot, { persistent: false }, (eventType, filename) => {
        if (filename === 'config.local.yml') {
          this.handleDirectoryEvent(eventType, filename);
        }
      });
      this.registerWatcher(this.projectRoot, 'local', watcher);
      logger.debug(`Started watching directory: ${this.projectRoot}`);
    } catch (err: unknown) {
      logger.error(`Failed to watch directory ${this.projectRoot}: ${err}`);
      this.handleWatcherError(this.projectRoot, 'local', err);
    }
  }

  private handleFileEvent(filePath: string, type: 'base' | 'local', eventType: string): void {
    logger.debug(`Config file event: ${eventType} on ${filePath}`);

    // Add to pending changes
    this.pendingChanges.add(type);

    // Clear existing debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Set new debounce timer (100ms like JobStore)
    this.debounceTimer = setTimeout(() => {
      this.emitConfigChanged();
      this.debounceTimer = null;
    }, 100);
  }

  private handleDirectoryEvent(eventType: string, filename: string): void {
    if (filename !== 'config.local.yml') return;

    const localPath = this.localConfigPath;
    const exists = existsSync(localPath);

    logger.debug(`Directory event: ${eventType} for ${filename}, exists: ${exists}`);

    if (exists && !this.watchers.has(localPath)) {
      // config.local.yml was created, start watching it
      this.watchFile(localPath, 'local');
      this.pendingChanges.add('local');
    } else if (!exists && this.watchers.has(localPath)) {
      // config.local.yml was deleted, stop watching it
      const watcher = this.watchers.get(localPath);
      if (watcher) {
        watcher.close();
        this.watchers.delete(localPath);
      }
      this.pendingChanges.add('local');
    }

    // Trigger debounced config change if there are pending changes
    if (this.pendingChanges.size > 0) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }

      this.debounceTimer = setTimeout(() => {
        this.emitConfigChanged();
        this.debounceTimer = null;
      }, 100);
    }
  }

  private emitConfigChanged(): void {
    const changes = Array.from(this.pendingChanges);
    this.pendingChanges.clear();

    if (changes.length === 0) return;

    // Determine event type based on what changed
    let eventType: 'base' | 'local' | 'both';
    const paths: string[] = [];

    const hasBase = changes.includes('base');
    const hasLocal = changes.includes('local');

    if (hasBase && hasLocal) {
      eventType = 'both';
      paths.push(this.baseConfigPath, this.localConfigPath);
    } else if (hasBase) {
      eventType = 'base';
      paths.push(this.baseConfigPath);
    } else {
      eventType = 'local';
      paths.push(this.localConfigPath);
    }

    const event: ConfigChangeEvent = {
      type: eventType,
      paths
    };

    logger.info(`Config changed: ${eventType} (${paths.join(', ')})`);
    this.emit('configChanged', event);
  }

  private handleWatcherError(filePath: string, type: 'base' | 'local', error: unknown): void {
    const errorCount = (this.errorCounts.get(filePath) || 0) + 1;
    this.errorCounts.set(filePath, errorCount);

    logger.warn(`Watcher error for ${filePath} (attempt ${errorCount}/${this.maxErrorRetries}): ${error}`);

    // Close and remove the problematic watcher
    const existingWatcher = this.watchers.get(filePath);
    if (existingWatcher) {
      try {
        existingWatcher.removeAllListeners();
        existingWatcher.close();
      } catch (closeError) {
        logger.warn(`Error closing watcher for ${filePath}: ${closeError}`);
      }
      this.watchers.delete(filePath);
    }

    // Attempt to restart the watcher if we haven't exceeded retry limit
    if (errorCount <= this.maxErrorRetries) {
      logger.info(`Attempting to restart watcher for ${filePath} in ${this.errorRetryDelay}ms`);
      setTimeout(() => {
        this.restartWatcher(filePath, type);
      }, this.errorRetryDelay);
    } else {
      logger.error(`Maximum retry attempts exceeded for ${filePath}. Disabling watcher for this file.`);
      this.errorCounts.delete(filePath); // Clean up error count

      // Emit a warning event for graceful degradation
      this.emit('watcherDisabled', { filePath, type, reason: 'max_retries_exceeded' });
    }
  }

  private restartWatcher(filePath: string, type: 'base' | 'local'): void {
    try {
      // Check if file/directory still exists before restarting
      if (!existsSync(filePath)) {
        logger.info(`${filePath} no longer exists, not restarting watcher`);
        this.errorCounts.delete(filePath);
        return;
      }

      logger.info(`Restarting watcher for ${filePath}`);

      if (filePath === this.projectRoot) {
        this.watchDirectory();
      } else {
        this.watchFile(filePath, type);
      }
    } catch (restartError) {
      logger.error(`Failed to restart watcher for ${filePath}: ${restartError}`);
      this.handleWatcherError(filePath, type, restartError);
    }
  }
}