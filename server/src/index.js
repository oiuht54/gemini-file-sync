const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');

// --- CONSTANTS ---
const CONFIG_FILE = path.join(__dirname, '..', 'bridge_history.json');
const PORT = 3000;

// --- CONFIGURATION SERVICE ---
// Handles persistence of project paths
class ConfigService {
    constructor() {
        this.data = {
            currentRoot: process.cwd(),
            history: []
        };
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
                const loaded = JSON.parse(raw);
                if (loaded.currentRoot && fs.existsSync(loaded.currentRoot)) {
                    this.data.currentRoot = loaded.currentRoot;
                }
                if (Array.isArray(loaded.history)) {
                    this.data.history = loaded.history;
                }
            }
        } catch (e) {
            console.error(chalk.red('Error loading config, using defaults.'));
        }
    }

    save() {
        try {
            // Validate history uniqueness and existence
            this.data.history = [...new Set(this.data.history)]
                .filter(p => fs.existsSync(p))
                .slice(0, 10); // Keep last 10

            fs.writeJsonSync(CONFIG_FILE, this.data, { spaces: 2 });
        } catch (e) {
            console.error(chalk.red('Failed to save config:'), e.message);
        }
    }

    setRoot(newPath) {
        if (!fs.existsSync(newPath)) {
            throw new Error(`Directory does not exist: ${newPath}`);
        }
        this.data.currentRoot = path.resolve(newPath);
        // Add to history (unshift to top)
        this.data.history = [this.data.currentRoot, ...this.data.history];
        this.save();
        console.log(chalk.yellow(`\nContext switched to: ${this.data.currentRoot}`));
    }

    getCurrentRoot() {
        return this.data.currentRoot;
    }

    getHistory() {
        return this.data.history;
    }
}

// --- FILE SERVICE ---
// Handles path normalization and safe writing
class FileService {
    constructor(configService) {
        this.config = configService;
    }

    /**
     * Converts "res://scripts/main.gd" -> "C:/Project/scripts/main.gd"
     */
    resolvePath(rawPath) {
        const root = this.config.getCurrentRoot();
        let cleanPath = rawPath.trim();

        // 1. Remove Godot/Url prefixes
        cleanPath = cleanPath
            .replace(/^res:\/\//, '')
            .replace(/^user:\/\//, 'user_data/') // Map user:// to a folder named user_data
            .replace(/^file:\/\//, '');

        // 2. Remove leading slashes/dots to ensure relative path
        // e.g. "/src/main" -> "src/main"
        cleanPath = cleanPath.replace(/^[\/\\]+/, '').replace(/^\.[\/\\]+/, '');

        // 3. Resolve absolute
        const absolutePath = path.resolve(root, cleanPath);

        // 4. Security Check (Sandbox)
        if (!absolutePath.startsWith(root)) {
            throw new Error(`Security Violation: Path ${cleanPath} is outside project root.`);
        }

        return { absolutePath, relativePath: cleanPath };
    }

    async write(rawPath, content) {
        const { absolutePath, relativePath } = this.resolvePath(rawPath);

        // Check state
        const exists = await fs.pathExists(absolutePath);
        const status = exists ? 'UPDATED' : 'CREATED';

        // Backup if updating
        if (exists) {
            await this.createBackup(absolutePath, relativePath);
        }

        // Ensure directory structure (Create directories if missing)
        await fs.ensureDir(path.dirname(absolutePath));

        // Write
        await fs.writeFile(absolutePath, content, 'utf8');

        return { path: relativePath, status };
    }

    async createBackup(absolutePath, relativePath) {
        const root = this.config.getCurrentRoot();
        const backupRoot = path.join(root, '.ai-bridge', 'backups');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        const backupPath = path.join(backupRoot, timestamp, relativePath);

        await fs.ensureDir(path.dirname(backupPath));
        await fs.copy(absolutePath, backupPath);
    }
}

// --- MAIN SERVER SETUP ---

const app = express();
const configService = new ConfigService();
const fileService = new FileService(configService);

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// 1. Get Status (UI Polling)
app.get('/status', (req, res) => {
    res.json({
        active: true,
        cwd: configService.getCurrentRoot(),
        history: configService.getHistory(),
        version: '2.0'
    });
});

// 2. Change Root Endpoint
app.post('/config/root', (req, res) => {
    try {
        const { path: newPath } = req.body;
        if (!newPath) throw new Error("Path is required");

        configService.setRoot(newPath);
        res.json({ success: true, cwd: configService.getCurrentRoot() });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

// 3. Sync Files Endpoint
app.post('/sync', async (req, res) => {
    try {
        const { files } = req.body;
        if (!files || !Array.isArray(files)) return res.status(400).send("Invalid payload");

        console.log(chalk.blue(`\n[Sync] Processing ${files.length} files into: ${chalk.bold(configService.getCurrentRoot())}`));

        const results = [];
        for (const f of files) {
            try {
                const result = await fileService.write(f.path, f.content);
                const icon = result.status === 'CREATED' ? '✨' : '📝';
                const color = result.status === 'CREATED' ? chalk.magenta : chalk.green;

                console.log(`${icon} ${color(result.status)}: ${result.path}`);
                results.push({ ...result, success: true });
            } catch (e) {
                console.error(chalk.red(`✖ ERROR: ${f.path} - ${e.message}`));
                results.push({ path: f.path, success: false, error: e.message });
            }
        }

        res.json({ success: true, results });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Start
app.listen(PORT, () => {
    console.log(chalk.cyan('='.repeat(50)));
    console.log(chalk.bold.yellow(' AI STUDIO WORKSPACE MANAGER v2.0 '));
    console.log(chalk.cyan('='.repeat(50)));
    console.log(`Current Project: ${chalk.green(configService.getCurrentRoot())}`);
    console.log(`History stored in: ${chalk.gray(CONFIG_FILE)}`);
    console.log(`Server running on http://localhost:${PORT}`);
});