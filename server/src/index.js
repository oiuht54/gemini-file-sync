const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');
const os = require('os');

// --- CONSTANTS ---
const CONFIG_FILE = path.join(__dirname, '..', 'bridge_history.json');
const MAX_HISTORY_ITEMS = 50; 
const PORT = 3000;
const HOST = '0.0.0.0'; // Binding to 0.0.0.0 allows external network access

// --- NETWORK UTIL ---
function getNetworkIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                ips.push(net.address);
            }
        }
    }
    return ips;
}

// --- CONFIG SERVICE ---
class ConfigService {
    constructor() {
        this.data = { currentRoot: process.cwd(), history: [] };
        this.load();
    }
    load() {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                const loaded = fs.readJsonSync(CONFIG_FILE);
                if (loaded.currentRoot && fs.existsSync(loaded.currentRoot)) {
                    this.data.currentRoot = loaded.currentRoot;
                }
                if (Array.isArray(loaded.history)) this.data.history = loaded.history;
            }
        } catch (e) { console.error('Config load error:', e.message); }
    }
    save() {
        try {
            this.data.history = [...new Set(this.data.history)].filter(p => fs.existsSync(p)).slice(0, 10);
            fs.writeJsonSync(CONFIG_FILE, this.data, { spaces: 2 });
        } catch (e) { console.error('Config save error:', e.message); }
    }
    setRoot(newPath) {
        if (!fs.existsSync(newPath)) throw new Error(`Path not found: ${newPath}`);
        this.data.currentRoot = path.resolve(newPath);
        this.data.history = [this.data.currentRoot, ...this.data.history];
        this.save();
        console.log(chalk.yellow(`\nContext switched to: ${this.data.currentRoot}`));
    }
    getCurrentRoot() { return this.data.currentRoot; }
    getHistory() { return this.data.history; }
}

// --- TRANSACTION MANAGER ---
class TransactionManager {
    constructor(configService) {
        this.config = configService;
    }
    getTransactionDir() {
        return path.join(this.config.getCurrentRoot(), '.ai-bridge', 'transactions');
    }
    async beginTransaction() {
        const txRoot = this.getTransactionDir();
        const id = new Date().toISOString().replace(/[:.]/g, '-');
        const dir = path.join(txRoot, id);
        await fs.ensureDir(dir);
        await fs.writeJson(path.join(dir, 'manifest.json'), []);
        this.pruneOldTransactions().catch(err => console.error("Cleanup failed:", err));
        return { id, dir };
    }
    async pruneOldTransactions() {
        const txRoot = this.getTransactionDir();
        if (!await fs.pathExists(txRoot)) return;
        const dirs = await fs.readdir(txRoot);
        dirs.sort();
        if (dirs.length > MAX_HISTORY_ITEMS) {
            const toDeleteCount = dirs.length - MAX_HISTORY_ITEMS;
            const toDelete = dirs.slice(0, toDeleteCount);
            console.log(chalk.gray(`[Auto-Cleanup] Removing ${toDeleteCount} old backups...`));
            for (const folder of toDelete) {
                await fs.remove(path.join(txRoot, folder));
            }
        }
    }
    async recordOperation(txDir, relativePath, operationType) {
        const root = this.config.getCurrentRoot();
        const absolutePath = path.join(root, relativePath);
        const manifestPath = path.join(txDir, 'manifest.json');
        const manifest = await fs.readJson(manifestPath);
        manifest.push({ path: relativePath, type: operationType });
        await fs.writeJson(manifestPath, manifest, { spaces: 2 });
        
        if (operationType === 'MODIFIED') {
            const backupPath = path.join(txDir, 'files', relativePath);
            await fs.ensureDir(path.dirname(backupPath));
            await fs.copy(absolutePath, backupPath);
        }
    }
    async rollbackLast() {
        const txRoot = this.getTransactionDir();
        if (!await fs.pathExists(txRoot)) throw new Error("No transactions found.");
        const dirs = (await fs.readdir(txRoot)).sort().reverse();
        if (dirs.length === 0) throw new Error("No history to undo.");
        
        const lastTxId = dirs[0];
        const txDir = path.join(txRoot, lastTxId);
        const manifestPath = path.join(txDir, 'manifest.json');
        
        console.log(chalk.yellow(`\n[Rollback] Reverting transaction: ${lastTxId}`));
        const manifest = await fs.readJson(manifestPath);
        const root = this.config.getCurrentRoot();
        const results = [];
        
        for (const item of manifest.reverse()) {
            const targetPath = path.join(root, item.path);
            if (item.type === 'CREATED') {
                if (await fs.pathExists(targetPath)) {
                    await fs.remove(targetPath);
                    results.push(`Deleted ${item.path}`);
                }
            } else if (item.type === 'MODIFIED') {
                const backupPath = path.join(txDir, 'files', item.path);
                if (await fs.pathExists(backupPath)) {
                    await fs.copy(backupPath, targetPath, { overwrite: true });
                    results.push(`Restored ${item.path}`);
                }
            }
        }
        await fs.remove(txDir);
        console.log(chalk.green(`[Rollback] Success.`));
        return { count: results.length, lastTxId };
    }
}

// --- FILE SERVICE ---
class FileService {
    constructor(configService, txManager) {
        this.config = configService;
        this.tx = txManager;
    }
    resolvePath(rawPath) {
        const root = this.config.getCurrentRoot();
        let cleanPath = rawPath.trim()
            .replace(/^res:\/\//, '')
            .replace(/^user:\/\//, 'user_data/')
            .replace(/^file:\/\//, '')
            .replace(/^[\/\\]+/, '')
            .replace(/^\.[\/\\]+/, '');
            
        const absolutePath = path.resolve(root, cleanPath);
        if (!absolutePath.startsWith(root)) throw new Error(`Security Violation: ${cleanPath}`);
        return { absolutePath, relativePath: cleanPath };
    }
    async performSync(files) {
        const { dir: txDir } = await this.tx.beginTransaction();
        const results = [];
        for (const f of files) {
            try {
                const { absolutePath, relativePath } = this.resolvePath(f.path);
                const exists = await fs.pathExists(absolutePath);
                const status = exists ? 'MODIFIED' : 'CREATED';
                
                await this.tx.recordOperation(txDir, relativePath, status);
                await fs.ensureDir(path.dirname(absolutePath));
                await fs.writeFile(absolutePath, f.content, 'utf8');
                
                const icon = status === 'CREATED' ? '✨' : '📝';
                const color = status === 'CREATED' ? chalk.magenta : chalk.green;
                console.log(`${icon} ${color(status)}: ${relativePath}`);
                results.push({ path: relativePath, status });
            } catch (e) {
                console.error(chalk.red(`✖ ERROR: ${f.path} - ${e.message}`));
                results.push({ path: f.path, status: 'ERROR', error: e.message });
            }
        }
        return results;
    }
}

// --- MAIN ---
const app = express();
const configService = new ConfigService();
const txManager = new TransactionManager(configService);
const fileService = new FileService(configService, txManager);

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

app.get('/status', (req, res) => {
    res.json({ cwd: configService.getCurrentRoot(), history: configService.getHistory() });
});

app.post('/config/root', (req, res) => {
    try {
        configService.setRoot(req.body.path);
        res.json({ success: true, cwd: configService.getCurrentRoot() });
    } catch (e) { res.status(400).json({ success: false, error: e.message }); }
});

app.post('/sync', async (req, res) => {
    try {
        console.log(chalk.blue(`\n[Sync] Started...`));
        const results = await fileService.performSync(req.body.files);
        res.json({ success: true, results });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/rollback', async (req, res) => {
    try {
        const result = await txManager.rollbackLast();
        res.json({ success: true, ...result });
    } catch (e) {
        console.error(chalk.red(`[Rollback Failed] ${e.message}`));
        res.status(400).json({ success: false, error: e.message });
    }
});

app.listen(PORT, HOST, () => {
    const lanIps = getNetworkIPs();
    
    console.log(chalk.cyan('='.repeat(60)));
    console.log(chalk.bold.yellow(' 🌉 AI BRIDGE v3.0 (LAN Server Edition) '));
    console.log(chalk.cyan('='.repeat(60)));
    console.log(chalk.white(`📂 Root: ${configService.getCurrentRoot()}`));
    console.log();
    console.log(chalk.green(`✓ Server is running.`));
    console.log(`🔌 Available on local machine: http://localhost:${PORT}`);
    
    if (lanIps.length > 0) {
        console.log(chalk.magenta.bold(`🌐 Enter this IP in your browser extension:`));
        lanIps.forEach(ip => console.log(chalk.bold(`   http://${ip}:${PORT}`)));
    } else {
        console.log(chalk.gray(`(No external LAN IPs detected)`));
    }
    console.log(chalk.cyan('-'.repeat(60)));
});