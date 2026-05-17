// ==UserScript==
// @name         AI Studio Workspace Manager (v16.2 - Remote LAN Server Edition)
// @namespace    http://tampermonkey.net/
// @version      16.2
// @description  Connects to a remote Linux/LAN machine. Bypasses HTTPS mixed-content blocks via GM_xmlhttpRequest. Added History Quick-Buttons.
// @author       Gemini 3 Architect
// @match        https://aistudio.google.com/*
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // Helper wrapper to bypass HTTPS -> HTTP Mixed Content block
    function gmFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: url,
                headers: options.headers || {},
                data: options.body,
                responseType: 'json',
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        resolve({
                            ok: true,
                            status: response.status,
                            json: () => Promise.resolve(response.response)
                        });
                    } else {
                        reject(new Error(`HTTP Error: ${response.status}`));
                    }
                },
                onerror: function(err) {
                    reject(new Error('Connection Failed'));
                }
            });
        });
    }

    // --- HISTORY MANAGER ---
    // Robust local storage manager to keep track of N most recent unique items
    const HistoryManager = {
        MAX_SERVERS: 3,
        MAX_PATHS: 3,

        _get(key) {
            try {
                const data = localStorage.getItem(key);
                return data ? JSON.parse(data) : [];
            } catch (e) {
                console.error(`Error reading history for ${key}:`, e);
                return [];
            }
        },

        _add(key, value, limit) {
            if (!value || typeof value !== 'string') return;
            let items = this._get(key);
            // Remove exact duplicates to bring the used item to the top
            items = items.filter(item => item !== value);
            items.unshift(value); // Add to the beginning
            // Truncate to max limit
            if (items.length > limit) items = items.slice(0, limit);
            localStorage.setItem(key, JSON.stringify(items));
        },

        getServers() { return this._get('ai_bridge_server_history'); },
        addServer(url) { this._add('ai_bridge_server_history', url, this.MAX_SERVERS); },
        
        getPaths() { return this._get('ai_bridge_path_history'); },
        addPath(path) { this._add('ai_bridge_path_history', path, this.MAX_PATHS); }
    };

    const CONFIG = {
        get API_BASE() {
            // First check legacy localstorage fallback, then use the most recent history item if available
            const legacyHost = localStorage.getItem('ai_bridge_host');
            const history = HistoryManager.getServers();
            if (legacyHost && history.length === 0) {
                HistoryManager.addServer(legacyHost);
                return legacyHost;
            }
            return history.length > 0 ? history[0] : 'http://localhost:3000';
        },
        SERVER_POLL_INTERVAL: 10000,
        DOM_SCAN_INTERVAL: 1000,
        UI_WIDTH_COLLAPSED: '260px',
        UI_WIDTH_EXPANDED: '450px',
        COLORS: {
            bg: '#121212', bgHeader: '#1e1e1e', border: '#333',
            accent: '#0d96f2', success: '#4caf50', error: '#f44336', warn: '#ff9800',
            text: '#e0e0e0', btnBg: '#333', btnHover: '#444',
            highlight: 'rgba(13, 150, 242, 0.2)', highlightBorder: '#0d96f2',
            ignored: '#666'
        },
        KNOWN_EXTENSIONS: [
            '.gd', '.tscn', '.tres', '.import', '.cs', '.unity', '.cpp', '.h', '.hpp',
            '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.scss', '.vue', '.svelte', '.php',
            '.py', '.java', '.rb', '.go', '.rs', '.c', '.kt', '.swift', '.dart',
            '.json', '.xml', '.yaml', '.toml', '.ini', '.sql', '.md', '.txt', '.sh', '.bat'
        ]
    };

    const State = {
        isCollapsed: localStorage.getItem('ai_bridge_collapsed') === 'true',
        serverConnected: false,
        manualScope: null,
        isSelecting: false,
        ignoredPaths: new Set()
    };

    // --- DOM HELPERS ---
    function el(tag, style = {}, content = null) {
        const elem = document.createElement(tag);
        Object.assign(elem.style, style);
        if (content) {
            if (typeof content === 'string') elem.textContent = content;
            else for (const [k, v] of Object.entries(content)) elem[k] = v;
        }
        return elem;
    }

    function clearChildren(node) { while (node.firstChild) node.removeChild(node.firstChild); }

    // --- SELECTOR TOOL ---
    const Selector = {
        hoveredElement: null,
        init() {
            const style = document.createElement('style');
            style.textContent = `
                .ai-bridge-target-hover { outline: 2px solid ${CONFIG.COLORS.highlightBorder} !important; background-color: ${CONFIG.COLORS.highlight} !important; cursor: crosshair !important; }
                .ai-bridge-file-row:hover { background-color: #222 !important; }
                .ai-bridge-history-btn:hover { background-color: #444 !important; color: #fff !important; }
            `;
            document.head.appendChild(style);
        },
        toggle() { State.isSelecting ? this.disable() : this.enable(); },
        enable() {
            State.isSelecting = true;
            UI.targetBtn.style.color = CONFIG.COLORS.accent;
            document.body.style.cursor = 'crosshair';
            document.addEventListener('mouseover', this.handleHover, true);
            document.addEventListener('click', this.handleClick, true);
            document.addEventListener('keydown', this.handleKey);
        },
        disable() {
            State.isSelecting = false;
            UI.targetBtn.style.color = '#fff';
            document.body.style.cursor = 'default';
            if (this.hoveredElement) { this.hoveredElement.classList.remove('ai-bridge-target-hover'); this.hoveredElement = null; }
            document.removeEventListener('mouseover', this.handleHover, true);
            document.removeEventListener('click', this.handleClick, true);
            document.removeEventListener('keydown', this.handleKey);
        },
        getContainer(target) {
            let curr = target;
            for (let i = 0; i < 8; i++) {
                if (!curr || curr === document.body) return null;
                if (curr.querySelector('ms-code-block') || curr.tagName === 'MS-CODE-BLOCK') {
                    if (curr.parentElement && curr.parentElement.childElementCount > 1) return curr.parentElement;
                }
                curr = curr.parentElement;
            }
            return target;
        },
        handleHover: (e) => {
            e.stopPropagation();
            if (Selector.hoveredElement) Selector.hoveredElement.classList.remove('ai-bridge-target-hover');
            const container = Selector.getContainer(e.target);
            if (container && container !== document.body && container.id !== 'ai-bridge-v2') {
                Selector.hoveredElement = container;
                container.classList.add('ai-bridge-target-hover');
            }
        },
        handleClick: (e) => {
            e.preventDefault(); e.stopPropagation();
            if (Selector.hoveredElement) {
                State.manualScope = Selector.hoveredElement;
                Selector.disable();
                Scanner.scan();
            }
        },
        handleKey: (e) => { if (e.key === 'Escape') Selector.disable(); }
    };

    // --- UI COMPONENTS ---
    const UI = {
        root: null, header: null, body: null, statusDot: null,
        serverInput: null, connectBtn: null, serverHistoryContainer: null,
        pathInput: null, setBtn: null, pathHistoryContainer: null, 
        activeRootLabel: null, statusLabel: null, fileList: null, 
        syncBtn: null, undoBtn: null, scanBtn: null, toggleBtn: null, targetBtn: null,

        init() {
            Selector.init();
            const old = document.getElementById('ai-bridge-v2');
            if (old) old.remove();

            this.root = el('div', {
                position: 'fixed', bottom: '20px', right: '20px',
                width: State.isCollapsed ? CONFIG.UI_WIDTH_COLLAPSED : CONFIG.UI_WIDTH_EXPANDED,
                backgroundColor: CONFIG.COLORS.bg,
                border: `1px solid ${CONFIG.COLORS.border}`, borderRadius: '8px',
                fontFamily: 'Consolas, monospace', fontSize: '12px', color: CONFIG.COLORS.text,
                zIndex: '999999', boxShadow: '0 10px 30px rgba(0,0,0,0.9)',
                display: 'flex', flexDirection: 'column', transition: 'width 0.2s ease-in-out'
            });
            this.root.id = 'ai-bridge-v2';

            this.header = el('div', {
                padding: '8px 12px', backgroundColor: CONFIG.COLORS.bgHeader,
                borderBottom: State.isCollapsed ? 'none' : `1px solid ${CONFIG.COLORS.border}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '40px'
            });

            const titleRow = el('div', { display: 'flex', alignItems: 'center', gap: '10px' });
            this.statusDot = el('div', {
                width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#555', cursor: 'help',
                transition: 'background-color 0.3s ease'
            }, { title: 'Checking connection...' });
            titleRow.append(this.statusDot, el('span', { fontWeight: 'bold', fontSize: '13px' }, 'AI BRIDGE LAN'));

            const controlsRow = el('div', { display: 'flex', gap: '8px' });
            const btnStyle = {
                background: CONFIG.COLORS.btnBg, border: '1px solid #444', color: '#fff', cursor: 'pointer',
                fontSize: '16px', padding: '0', width: '32px', height: '32px', borderRadius: '4px',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            };

            this.targetBtn = el('button', btnStyle, { textContent: '⌖', title: 'Select Message Manually' });
            this.targetBtn.onclick = (e) => { e.stopPropagation(); Selector.toggle(); };

            this.scanBtn = el('button', btnStyle, { textContent: '↻', title: 'Reset to Auto & Scan' });
            this.scanBtn.onclick = (e) => {
                e.stopPropagation();
                State.manualScope = null; Selector.disable();
                State.ignoredPaths.clear();
                this.scanBtn.style.transform = 'rotate(360deg)';
                this.scanBtn.style.transition = 'transform 0.4s';
                setTimeout(() => { this.scanBtn.style.transform = 'none'; this.scanBtn.style.transition = ''; }, 400);
                Logic.checkServer(false); // Background check, no UI disruption
                Scanner.scan();
            };

            this.toggleBtn = el('button', btnStyle, { textContent: State.isCollapsed ? '+' : '−', title: 'Minimize' });
            this.toggleBtn.onclick = (e) => { e.stopPropagation(); this.toggleCollapse(); };

            controlsRow.append(this.targetBtn, this.scanBtn, this.toggleBtn);
            this.header.append(titleRow, controlsRow);
            this.header.onclick = (e) => { if (e.target.tagName !== 'BUTTON') this.toggleCollapse(); };

            this.body = el('div', {
                display: State.isCollapsed ? 'none' : 'flex', flexDirection: 'column', padding: '12px', gap: '10px'
            });

            // --- Server Network Section ---
            const networkWrapper = el('div', { display: 'flex', flexDirection: 'column', gap: '4px' });
            const networkSettings = el('div', { display: 'flex', gap: '5px' });
            this.serverInput = el('input', {
                flex: '1', background: '#1a1a1a', border: '1px solid #444', color: '#0d96f2', padding: '8px', borderRadius: '4px',
                minWidth: '0' 
            }, { placeholder: 'http://192.168.1.X:3000', value: CONFIG.API_BASE });

            this.connectBtn = el('button', {
                background: '#333', color: '#fff', border: 'none', cursor: 'pointer', padding: '0 12px', borderRadius: '4px', 
                fontWeight: 'bold', transition: 'background 0.2s, color 0.2s', minWidth: '90px'
            }, { textContent: 'CONNECT' });
            
            this.connectBtn.onclick = () => {
                let val = this.serverInput.value.trim();
                if(val.endsWith('/')) val = val.slice(0, -1);
                if(val && !val.startsWith('http')) val = 'http://' + val;
                this.serverInput.value = val;
                localStorage.setItem('ai_bridge_host', val); // Fallback reference
                Logic.checkServer(true); // True indicates a manual click with explicit UI feedback
            };
            networkSettings.append(this.serverInput, this.connectBtn);
            
            this.serverHistoryContainer = el('div', { display: 'none', gap: '4px' });
            networkWrapper.append(networkSettings, this.serverHistoryContainer);

            // --- Path Root Section ---
            const pathWrapper = el('div', { display: 'flex', flexDirection: 'column', gap: '4px' });
            const settings = el('div', { display: 'flex', gap: '5px' });
            this.pathInput = el('input', {
                flex: '1', background: '#222', border: '1px solid #444', color: '#fff', padding: '8px', borderRadius: '4px',
                minWidth: '0'
            }, { placeholder: 'Remote Project Root...' });

            this.setBtn = el('button', {
                background: '#333', color: '#fff', border: 'none', cursor: 'pointer', padding: '0 12px', borderRadius: '4px', 
                fontWeight: 'bold', transition: 'background 0.2s', minWidth: '60px'
            }, { textContent: 'SET' });
            this.setBtn.onclick = Logic.setProjectRoot;
            settings.append(this.pathInput, this.setBtn);

            this.pathHistoryContainer = el('div', { display: 'none', gap: '4px' });
            pathWrapper.append(settings, this.pathHistoryContainer);

            // --- Status & Files Section ---
            this.activeRootLabel = el('div', {
                fontSize: '10px', color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                padding: '0 2px', cursor: 'help'
            }, { textContent: '📂 Connecting to remote...' });

            this.statusLabel = el('div', { textAlign: 'center', color: '#888', padding: '4px' }, 'Idle');
            this.fileList = el('div', {
                maxHeight: '180px', overflowY: 'auto', background: '#000', border: '1px solid #333',
                padding: '5px', display: 'flex', flexDirection: 'column', gap: '2px', borderRadius: '4px'
            });

            // --- Action Buttons ---
            const actionsRow = el('div', { display: 'flex', gap: '5px' });
            this.syncBtn = el('button', {
                flex: '2', padding: '14px', background: '#222', color: '#555', border: 'none', fontWeight: 'bold',
                cursor: 'not-allowed', borderRadius: '4px', fontSize: '13px', transition: 'background 0.2s'
            }, { textContent: 'NO FILES' });
            this.syncBtn.disabled = true;
            this.syncBtn.onclick = Logic.syncFiles;

            this.undoBtn = el('button', {
                flex: '1', padding: '14px', background: '#222', color: '#555', border: 'none', fontWeight: 'bold',
                cursor: 'not-allowed', borderRadius: '4px', fontSize: '13px', transition: 'all 0.2s'
            }, { textContent: 'UNDO', title: 'Instant Rollback' });
            this.undoBtn.disabled = true;
            this.undoBtn.onclick = Logic.rollback;
            actionsRow.append(this.syncBtn, this.undoBtn);

            this.body.append(networkWrapper, pathWrapper, this.activeRootLabel, this.statusLabel, this.fileList, actionsRow);
            this.root.append(this.header, this.body);
            document.body.appendChild(this.root);

            // Populate initial histories
            this.renderServerHistory();
            this.renderPathHistory();
        },

        createHistoryButton(text, clickCallback) {
            const btn = el('button', {
                flex: '1', background: '#1e1e1e', color: '#aaa', border: '1px solid #333', 
                borderRadius: '3px', padding: '3px 6px', fontSize: '10px', cursor: 'pointer',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                transition: 'background 0.1s', className: 'ai-bridge-history-btn'
            }, { textContent: text, title: text });
            
            btn.className = 'ai-bridge-history-btn'; // Use CSS class for hover
            btn.onclick = clickCallback;
            return btn;
        },

        renderServerHistory() {
            if (!this.serverHistoryContainer) return;
            clearChildren(this.serverHistoryContainer);
            
            const servers = HistoryManager.getServers();
            if (servers.length === 0) {
                this.serverHistoryContainer.style.display = 'none';
                return;
            }
            
            this.serverHistoryContainer.style.display = 'flex';
            servers.forEach(server => {
                const btn = this.createHistoryButton(server, () => {
                    this.serverInput.value = server;
                    this.connectBtn.click(); // Auto trigger connection
                });
                this.serverHistoryContainer.appendChild(btn);
            });
        },

        renderPathHistory(serverProvidedHistory = []) {
            if (!this.pathHistoryContainer) return;
            clearChildren(this.pathHistoryContainer);
            
            // Combine script's local history with server-provided history, ensuring uniqueness
            const localPaths = HistoryManager.getPaths();
            const combinedPaths = [...new Set([...localPaths, ...serverProvidedHistory])].slice(0, HistoryManager.MAX_PATHS);
            
            if (combinedPaths.length === 0) {
                this.pathHistoryContainer.style.display = 'none';
                return;
            }

            this.pathHistoryContainer.style.display = 'flex';
            combinedPaths.forEach(path => {
                const btn = this.createHistoryButton(path, () => {
                    this.pathInput.value = path;
                    this.setBtn.click(); // Auto trigger set
                });
                this.pathHistoryContainer.appendChild(btn);
            });
        },

        toggleCollapse() {
            State.isCollapsed = !State.isCollapsed;
            localStorage.setItem('ai_bridge_collapsed', State.isCollapsed);
            this.root.style.width = State.isCollapsed ? CONFIG.UI_WIDTH_COLLAPSED : CONFIG.UI_WIDTH_EXPANDED;
            this.body.style.display = State.isCollapsed ? 'none' : 'flex';
            this.header.style.borderBottom = State.isCollapsed ? 'none' : `1px solid ${CONFIG.COLORS.border}`;
            this.toggleBtn.textContent = State.isCollapsed ? '+' : '−';
        },

        updateStatus(connected, data) {
            State.serverConnected = connected;
            this.statusDot.style.backgroundColor = connected ? CONFIG.COLORS.success : CONFIG.COLORS.error;
            
            if (connected && data) {
                if (data.cwd) {
                    this.activeRootLabel.textContent = `📂 ${data.cwd}`;
                    this.activeRootLabel.title = data.cwd;
                    this.activeRootLabel.style.color = '#aaa';
                }
                if (this.pathInput.value === '') this.pathInput.value = data.cwd;
                
                // Update Path History with merged data
                if (data.history) {
                    this.renderPathHistory(data.history);
                }
            } else {
                this.activeRootLabel.textContent = '🔌 Disconnected from Server';
                this.activeRootLabel.style.color = CONFIG.COLORS.error;
            }
        },

        enableUndo(enabled) {
            this.undoBtn.disabled = !enabled;
            this.undoBtn.style.background = enabled ? CONFIG.COLORS.warn : '#222';
            this.undoBtn.style.color = enabled ? '#000' : '#555';
            this.undoBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
        },

        renderFiles(files) {
            if (!this.fileList) return;
            clearChildren(this.fileList);
            const activeFiles = files.filter(f => !State.ignoredPaths.has(f.path));

            if (State.manualScope) {
                this.statusLabel.textContent = `LOCKED: Manual Selection`;
                this.statusLabel.style.color = CONFIG.COLORS.warn;
            } else if (files.length === 0) {
                this.statusLabel.textContent = "Latest message has no code.";
                this.statusLabel.style.color = '#555';
            } else {
                this.statusLabel.textContent = `Auto: Found ${files.length} file(s)`;
                this.statusLabel.style.color = CONFIG.COLORS.success;
            }

            if (activeFiles.length === 0 && files.length === 0) {
                this.syncBtn.disabled = true;
                this.syncBtn.textContent = "NO FILES";
                this.syncBtn.style.background = '#222';
                this.syncBtn.style.color = '#555';
                this.syncBtn.style.cursor = 'not-allowed';
            } else if (activeFiles.length === 0 && files.length > 0) {
                this.syncBtn.disabled = true;
                this.syncBtn.textContent = "ALL IGNORED";
                this.syncBtn.style.background = '#444';
                this.syncBtn.style.color = '#888';
                this.syncBtn.style.cursor = 'not-allowed';
            } else {
                this.syncBtn.disabled = false;
                this.syncBtn.textContent = `SYNC ${activeFiles.length} FILES`;
                this.syncBtn.style.background = CONFIG.COLORS.accent;
                this.syncBtn.style.color = '#fff';
                this.syncBtn.style.cursor = 'pointer';
            }

            files.forEach(f => {
                const isIgnored = State.ignoredPaths.has(f.path);
                const row = el('div', {
                    display: 'flex', justifyContent: 'space-between',
                    borderBottom: '1px solid #222', padding: '6px 4px',
                    cursor: 'pointer', transition: 'all 0.2s',
                    className: 'ai-bridge-file-row',
                    opacity: isIgnored ? '0.4' : '1'
                });

                const color = isIgnored ? CONFIG.COLORS.ignored : (f.path.includes('res://') ? '#ffecb3' : '#ddd');
                const decoration = isIgnored ? 'line-through' : 'none';

                const nameSpan = el('span', {
                    color: color, textDecoration: decoration,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '280px'
                }, f.path);

                const sizeSpan = el('span', {
                    color: '#555', textDecoration: decoration
                }, `${f.content.length}b`);

                row.onclick = () => {
                    if (isIgnored) State.ignoredPaths.delete(f.path);
                    else State.ignoredPaths.add(f.path);
                    UI.renderFiles(files);
                };

                row.append(nameSpan, sizeSpan);
                this.fileList.appendChild(row);
            });
        }
    };

    // --- LOGIC ---
    const Logic = {
        async checkServer(isManualClick = false) {
            // Provide explicit UI feedback ONLY if the user clicked the connect button.
            // Background polling remains completely silent and visually non-disruptive.
            if (isManualClick) {
                UI.connectBtn.textContent = 'WAIT...';
                UI.connectBtn.disabled = true;
            }

            try {
                const currentEndpoint = isManualClick ? UI.serverInput.value.trim() : CONFIG.API_BASE;
                const res = await gmFetch(`${currentEndpoint}/status`);
                
                if (res.ok) {
                    const data = await res.json();
                    UI.updateStatus(true, data);
                    
                    if (isManualClick) {
                        HistoryManager.addServer(currentEndpoint);
                        UI.renderServerHistory(); // Update visual buttons instantly
                        
                        UI.connectBtn.textContent = 'SUCCESS';
                        UI.connectBtn.style.background = CONFIG.COLORS.success;
                        setTimeout(() => {
                            UI.connectBtn.textContent = 'CONNECT';
                            UI.connectBtn.style.background = '#333';
                            UI.connectBtn.disabled = false;
                        }, 1500);
                    }
                } else {
                    throw new Error();
                }
            } catch {
                UI.updateStatus(false);
                if (isManualClick) {
                    UI.connectBtn.textContent = 'FAILED';
                    UI.connectBtn.style.background = CONFIG.COLORS.error;
                    setTimeout(() => {
                        UI.connectBtn.textContent = 'CONNECT';
                        UI.connectBtn.style.background = '#333';
                        UI.connectBtn.disabled = false;
                    }, 1500);
                }
            }
        },

        async setProjectRoot() {
            const path = UI.pathInput.value.trim();
            if(!path) return;
            
            const btn = UI.setBtn;
            btn.disabled = true; 
            btn.textContent = '...';
            
            try {
                const res = await gmFetch(`${CONFIG.API_BASE}/config/root`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({path})
                });
                const data = await res.json();
                if(data.success) {
                    // Update Local History
                    HistoryManager.addPath(path);
                    UI.renderPathHistory(); // Update visual buttons instantly
                    
                    UI.pathInput.value = ''; 
                    UI.updateStatus(true, data);
                    
                    btn.textContent = 'OK'; 
                    btn.style.background = CONFIG.COLORS.success;
                    setTimeout(() => { 
                        btn.textContent = 'SET'; 
                        btn.style.background = '#333'; 
                        btn.disabled = false; 
                    }, 1500);
                } else {
                    throw new Error(data.error);
                }
            } catch(e) {
                btn.textContent = 'ERR'; 
                btn.style.background = CONFIG.COLORS.error;
                setTimeout(() => { 
                    btn.textContent = 'SET'; 
                    btn.style.background = '#333'; 
                    btn.disabled = false; 
                }, 1500);
            }
        },

        async syncFiles() {
            const files = Scanner.currentFiles.filter(f => !State.ignoredPaths.has(f.path));
            if(!files || !files.length) return;
            
            UI.syncBtn.textContent = "WRITING PENDING...";
            UI.syncBtn.disabled = true;
            
            try {
                const res = await gmFetch(`${CONFIG.API_BASE}/sync`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({files})
                });
                const data = await res.json();
                if(data.success) {
                    UI.syncBtn.textContent = "DONE ✓";
                    UI.syncBtn.style.background = CONFIG.COLORS.success;
                    UI.enableUndo(true);
                    if (!State.manualScope) setTimeout(() => Scanner.scan(), 3000);
                }
            } catch (e) {
                UI.syncBtn.textContent = "NETWORK ERROR";
                UI.syncBtn.style.background = CONFIG.COLORS.error;
            }
        },

        async rollback() {
            UI.undoBtn.textContent = "...";
            try {
                const res = await gmFetch(`${CONFIG.API_BASE}/rollback`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    UI.undoBtn.textContent = "REVERTED";
                    setTimeout(() => { UI.undoBtn.textContent = "UNDO"; UI.enableUndo(false); }, 1500);
                } else {
                    alert(`Rollback failed: ${data.error}`);
                    UI.undoBtn.textContent = "UNDO";
                }
            } catch(e) {
                alert("Connection error during rollback");
                UI.undoBtn.textContent = "UNDO";
            }
        }
    };

    // --- SCANNER ---
    const Scanner = {
        currentFiles: [],
        getPath(text) {
            if (!text) return null;
            text = text.slice(-1000);
            const godotMatch = text.match(/(res:\/\/[a-zA-Z0-9_\-./]+|user:\/\/[a-zA-Z0-9_\-./]+)/);
            if (godotMatch) return godotMatch[0];
            const candidates = Array.from(text.matchAll(/([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+)/g));
            let bestCandidate = null;
            let maxScore = -1;
            for (let i = 0; i < candidates.length; i++) {
                const match = candidates[i];
                let p = match[0];
                p = p.replace(/[:.,;!?]+$/, '');
                p = p.replace(/[*"'`]+$/, '').replace(/^[*"'`]+/, '');
                if (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('www.') || p.startsWith('ftp://')) continue;
                let score = 0;
                if (p.includes('/')) score += 3;
                if (p.includes('\\')) score += 3;
                const lower = p.toLowerCase();
                const hasKnownExt = CONFIG.KNOWN_EXTENSIONS.some(ext => lower.endsWith(ext));
                if (hasKnownExt) score += 5;
                if (/^[0-9.]+$/.test(p) || /^v[0-9.]+$/.test(p)) score -= 10;
                if (p.length < 3) score -= 5;
                score += (i * 0.1);
                if (score > maxScore && score > 0) {
                    maxScore = score;
                    bestCandidate = p;
                }
            }
            if (bestCandidate) return bestCandidate.replace(/\\/g, '/');
            return null;
        },
        parseRawMarkdown(text) {
            const fileMap = new Map();
            if (!text) return fileMap;
            const blockRegex = /```([^\n]*\n)?([\s\S]*?)```/g;
            let match;
            let lastIndex = 0;
            while ((match = blockRegex.exec(text)) !== null) {
                let codeContent = match[2];
                if (!codeContent) continue;
                codeContent = codeContent.replace(/^\r?\n|\r?\n$/g, '');
                const textBefore = text.substring(lastIndex, match.index);
                const path = this.getPath(textBefore);
                if (path) {
                    fileMap.set(path, { path: path, content: codeContent });
                }
                lastIndex = match.index + match[0].length;
            }
            return fileMap;
        },
        findLastModelResponseContainer() {
            const icons = Array.from(document.querySelectorAll('mat-icon, i.google-material-icons, span.material-symbols-outlined'));
            const thumbIcons = icons.filter(i => i.innerText.trim().toLowerCase().includes('thumb_up'));
            if (thumbIcons.length === 0) return null;
            const lastThumb = thumbIcons[thumbIcons.length - 1];
            let container = lastThumb;
            for(let i=0; i<8; i++) {
                if(!container.parentElement) break;
                container = container.parentElement;
                if (container.querySelector('ms-text-chunk') || container.querySelector('ms-code-block')) {
                    return container.parentElement || container;
                }
            }
            return lastThumb.parentElement?.parentElement?.parentElement;
        },
        scan() {
            try {
                let scope;
                if (State.manualScope) {
                    if (!document.body.contains(State.manualScope)) {
                        State.manualScope = null;
                        scope = this.findLastModelResponseContainer();
                    } else {
                        scope = State.manualScope;
                    }
                } else {
                    scope = this.findLastModelResponseContainer();
                }

                if (!scope) {
                    this.currentFiles = []; UI.renderFiles([]); return;
                }

                const fileMap = new Map();
                const activeBlocks = Array.from(scope.querySelectorAll('ms-code-block'));

                if (activeBlocks.length > 0) {
                    const headers = Array.from(scope.querySelectorAll('h3, h4, strong, p, span, li'));
                    activeBlocks.forEach(block => {
                        const codeEl = block.querySelector('code');
                        if (!codeEl) return;
                        const content = codeEl.textContent;
                        if (!content) return;
                        let bestPath = null;
                        for (const header of headers) {
                            if (header.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING) {
                                const headerText = header.innerText || header.textContent;
                                const p = this.getPath(headerText);
                                if (p) bestPath = p;
                            }
                        }
                        if (bestPath) {
                            fileMap.set(bestPath, { path: bestPath, content: content });
                        }
                    });
                }

                const rawText = scope.innerText || scope.textContent || "";
                const rawMap = this.parseRawMarkdown(rawText);

                for (const [k, v] of rawMap.entries()) {
                    if (!fileMap.has(k)) {
                        fileMap.set(k, v);
                    }
                }

                this.currentFiles = Array.from(fileMap.values());
                UI.renderFiles(this.currentFiles);
            } catch (e) { console.error("Scanner Error:", e); }
        }
    };

    setTimeout(() => {
        UI.init();
        Logic.checkServer(false); // Initial background check
        setInterval(() => Scanner.scan(), CONFIG.DOM_SCAN_INTERVAL);
        // Periodic background poll explicitly flagged as non-manual
        setInterval(() => Logic.checkServer(false), CONFIG.SERVER_POLL_INTERVAL);
    }, 1500);
})();