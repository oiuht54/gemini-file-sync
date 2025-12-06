const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

class FileService {
    constructor(rootDir) {
        this.rootDir = rootDir;
        this.backupDir = path.join(rootDir, '.ai-bridge', 'backups');
    }

    /**
     * Validates that the requested path is INSIDE the allowed root directory.
     * Prevents Path Traversal attacks (e.g., "../../windows/system32").
     */
    validatePath(targetRelativePath) {
        // Resolve the full absolute path
        const resolvedPath = path.resolve(this.rootDir, targetRelativePath);

        // Check if the resolved path starts with the root dir
        if (!resolvedPath.startsWith(this.rootDir)) {
            throw new Error(`Security Violation: Attempted to write outside root directory. Path: ${targetRelativePath}`);
        }

        return resolvedPath;
    }

    /**
     * Creates a timestamped backup of the file if it exists.
     */
    async createBackup(absolutePath) {
        if (await fs.pathExists(absolutePath)) {
            const relativePath = path.relative(this.rootDir, absolutePath);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(
                this.backupDir,
                timestamp,
                relativePath
            );

            await fs.ensureDir(path.dirname(backupPath));
            await fs.copy(absolutePath, backupPath);
            return true;
        }
        return false;
    }

    /**
     * Main entry point to write a file.
     * 1. Validates path.
     * 2. Creates backup.
     * 3. Writes file safely.
     */
    async safeWrite(relativePath, content) {
        const absolutePath = this.validatePath(relativePath);

        // Ensure parent directory exists
        await fs.ensureDir(path.dirname(absolutePath));

        // Create backup
        await this.createBackup(absolutePath);

        // Write file
        await fs.writeFile(absolutePath, content, 'utf8');

        return {
            path: relativePath,
            status: 'written',
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = { FileService };