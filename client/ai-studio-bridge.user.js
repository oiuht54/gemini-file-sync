// ==UserScript==
// @name         AI Studio Workspace Manager (v2.0)
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Full Project Management: Multi-root support, Collapsible UI, Godot support, File Creation.
// @author       Gemini 3 Architect
// @match        https://aistudio.google.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        API_BASE: 'http://localhost:3000',
        POLL_INTERVAL: 1000,
        COLORS: {
            bg: '#121212',
            bgHeader: '#1e1e1e',
            border: '#333',
            accent: '#0d96f2',
            success: '#4caf50',
            create: '#9c27b0', // Purple for new files
            error: '#f44336',
            text: '#e0e0e0',
            subtext: '#888'
        }
    };

    // --- STATE MANAGEMENT ---
    const State = {
        isCollapsed: localStorage.getItem('ai_bridge_collapsed') === 'true',
        serverConnected: false,
        currentCwd: '...',
        history: [],
        files: [],
        hasFence: false
    };

    // --- DOM HELPERS ---
    function el(tag, style = {}, props = {}) {
        const elem = document.createElement(tag);
        Object.assign(elem.style, style);
        for (const [k, v] of Object.entries(props)) {
            if (k === 'onclick') elem.onclick = v;
            else if (k === 'placeholder') elem.placeholder = v;
            else if (k === 'value') elem.value = v;
            else if (k === 'title') elem.title = v;
            else elem.textContent = v; // Default to textContent
        }
        return elem;
    }

    // --- UI COMPONENTS ---
    const UI = {
        root: null,
        header: null,
        body: null,
        pathInput: null,
        historySelect: null,
        statusLabel: null,
        fileList: null,
        syncBtn: null,
        toggleBtn: null,

        init() {
            // Remove old instances
            const old = document.getElementById('ai-bridge-v2');
            if (old) old.remove();

            // Root Container
            this.root = el('div', {
                position: 'fixed', bottom: '20px', right: '20px',
                width: State.isCollapsed ? '180px' : '340px',
                backgroundColor: CONFIG.COLORS.bg,
                border: `1px solid ${CONFIG.COLORS.border}`,
                borderRadius: '8px',
                fontFamily: 'Consolas, monospace',
                fontSize: '12px',
                color: CONFIG.COLORS.text,
                zIndex: '999999',
                boxShadow: '0 10px 30px rgba(0,0,0,0.8)',
                transition: 'width 0.3s ease, height 0.3s ease',
                display: 'flex', flexDirection: 'column', overflow: 'hidden'
            });
            this.root.id = 'ai-bridge-v2';

            // 1. Header (Always visible)
            this.header = el('div', {
                padding: '10px', backgroundColor: CONFIG.COLORS.bgHeader,
                borderBottom: State.isCollapsed ? 'none' : `1px solid ${CONFIG.COLORS.border}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                cursor: 'pointer', userSelect: 'none'
            });

            const titleRow = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
            const statusDot = el('div', {
                width: '8px', height: '8px', borderRadius: '50%',
                backgroundColor: '#555', transition: 'background 0.3s'
            });
            statusDot.id = 'bridge-status-dot';

            const title = el('span', { fontWeight: 'bold' }, 'AI WORKSPACE');
            titleRow.append(statusDot, title);

            this.toggleBtn = el('button', {
                background: 'transparent', border: 'none', color: '#888',
                cursor: 'pointer', fontSize: '14px', fontWeight: 'bold'
            }, State.isCollapsed ? 'MAX' : 'MIN');

            this.header.append(titleRow, this.toggleBtn);

            // Header click toggles collapse
            this.header.onclick = (e) => {
                if (e.target !== this.toggleBtn) this.toggleCollapse();
            };
            this.toggleBtn.onclick = () => this.toggleCollapse();

            // 2. Body (Hidden when collapsed)
            this.body = el('div', {
                display: State.isCollapsed ? 'none' : 'flex',
                flexDirection: 'column', padding: '10px', gap: '10px'
            });

            // -- Settings Section --
            const settingsBox = el('div', { display: 'flex', flexDirection: 'column', gap: '5px' });
            const label = el('span', { color: CONFIG.COLORS.subtext, fontSize: '10px' }, 'PROJECT ROOT:');

            const inputRow = el('div', { display: 'flex', gap: '5px' });

            this.pathInput = el('input', {
                flex: '1', background: '#222', border: '1px solid #444', color: '#fff',
                padding: '4px', fontSize: '11px', borderRadius: '4px'
            }, { placeholder: 'Connecting...' });

            // Add Datalist for history
            const dataListId = 'bridge-history-list';
            const dataList = document.createElement('datalist');
            dataList.id = dataListId;
            document.body.appendChild(dataList); // Datalist must be in body
            this.historySelect = dataList;
            this.pathInput.setAttribute('list', dataListId);

            const applyBtn = el('button', {
                background: '#333', color: '#fff', border: 'none', borderRadius: '4px',
                cursor: 'pointer', padding: '0 8px', fontSize: '10px'
            }, { title: 'Set Project Root', textContent: 'SET' });

            applyBtn.onclick = Logic.setProjectRoot;
            // Also apply on Enter key
            this.pathInput.onkeydown = (e) => { if(e.key === 'Enter') Logic.setProjectRoot(); };

            inputRow.append(this.pathInput, applyBtn);
            settingsBox.append(label, inputRow);

            // -- Status Section --
            this.statusLabel = el('div', {
                textAlign: 'center', color: CONFIG.COLORS.subtext, margin: '5px 0'
            }, { textContent: 'Waiting for model response...' });

            // -- File List --
            this.fileList = el('div', {
                maxHeight: '150px', overflowY: 'auto', background: '#080808',
                border: '1px solid #333', borderRadius: '4px', padding: '5px',
                display: 'flex', flexDirection: 'column', gap: '2px'
            });

            // -- Sync Button --
            this.syncBtn = el('button', {
                padding: '12px', background: '#222', color: '#555',
                border: 'none', borderRadius: '4px', fontWeight: 'bold',
                textTransform: 'uppercase', cursor: 'not-allowed', transition: 'all 0.2s'
            }, { textContent: 'NO FILES' });
            this.syncBtn.disabled = true;
            this.syncBtn.onclick = Logic.syncFiles;

            this.body.append(settingsBox, this.statusLabel, this.fileList, this.syncBtn);

            this.root.append(this.header, this.body);
            document.body.appendChild(this.root);
        },

        toggleCollapse() {
            State.isCollapsed = !State.isCollapsed;
            localStorage.setItem('ai_bridge_collapsed', State.isCollapsed);

            this.root.style.width = State.isCollapsed ? '180px' : '340px';
            this.body.style.display = State.isCollapsed ? 'none' : 'flex';
            this.header.style.borderBottom = State.isCollapsed ? 'none' : `1px solid ${CONFIG.COLORS.border}`;
            this.toggleBtn.textContent = State.isCollapsed ? 'MAX' : 'MIN';
        },

        updateConnection(connected, cwd, history) {
            State.serverConnected = connected;
            const dot = document.getElementById('bridge-status-dot');
            if (dot) dot.style.backgroundColor = connected ? CONFIG.COLORS.success : CONFIG.COLORS.error;

            if (connected && cwd !== State.currentCwd) {
                State.currentCwd = cwd;
                if (this.pathInput) this.pathInput.value = cwd;
            }

            // Update History Datalist
            if (connected && history && this.historySelect) {
                this.historySelect.innerHTML = ''; // Clear
                history.forEach(path => {
                    const opt = document.createElement('option');
                    opt.value = path;
                    this.historySelect.appendChild(opt);
                });
            }
        },

        renderFiles(files, hasFence) {
            if (!this.fileList) return;

            State.files = files;
            State.hasFence = hasFence;

            // Clear list
            while (this.fileList.firstChild) this.fileList.removeChild(this.fileList.firstChild);

            if (!hasFence) {
                this.statusLabel.textContent = "Waiting for User Prompt...";
                this.statusLabel.style.color = CONFIG.COLORS.subtext;
            } else if (files.length === 0) {
                this.statusLabel.textContent = "No code blocks found.";
                this.statusLabel.style.color = CONFIG.COLORS.subtext;
            } else {
                this.statusLabel.textContent = `Ready to sync ${files.length} file(s)`;
                this.statusLabel.style.color = CONFIG.COLORS.success;
            }

            files.forEach(f => {
                const row = el('div', {
                    display: 'flex', justifyContent: 'space-between', padding: '4px',
                    borderBottom: '1px solid #222', fontSize: '11px'
                });

                // Highlight Godot/Special paths
                let color = '#aaa';
                if (f.path.includes('res://')) color = '#ffecb3'; // Yellowish for Godot

                const name = el('span', { color: color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '240px' }, { textContent: f.path, title: f.path });
                const size = el('span', { color: '#555' }, { textContent: `${f.content.length}b` });

                row.append(name, size);
                this.fileList.appendChild(row);
            });

            // Update Button
            if (files.length > 0 && hasFence) {
                this.syncBtn.disabled = false;
                this.syncBtn.textContent = "SYNC TO DISK";
                this.syncBtn.style.background = CONFIG.COLORS.accent;
                this.syncBtn.style.color = '#fff';
                this.syncBtn.style.cursor = 'pointer';
            } else {
                this.syncBtn.disabled = true;
                this.syncBtn.textContent = "NO FILES";
                this.syncBtn.style.background = '#222';
                this.syncBtn.style.color = '#555';
                this.syncBtn.style.cursor = 'not-allowed';
            }
        }
    };

    // --- LOGIC & NETWORK ---
    const Logic = {
        async checkServer() {
            try {
                const res = await fetch(`${CONFIG.API_BASE}/status`);
                const data = await res.json();
                UI.updateConnection(true, data.cwd, data.history);
            } catch (e) {
                UI.updateConnection(false);
            }
        },

        async setProjectRoot() {
            const newPath = UI.pathInput.value.trim();
            if (!newPath) return;

            UI.pathInput.style.opacity = '0.5';

            try {
                const res = await fetch(`${CONFIG.API_BASE}/config/root`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: newPath })
                });
                const data = await res.json();

                if (data.success) {
                    UI.updateConnection(true, data.cwd);
                    alert(`Root switched to: ${data.cwd}`);
                } else {
                    alert(`Error: ${data.error}`);
                }
            } catch (e) {
                alert("Connection failed");
            } finally {
                UI.pathInput.style.opacity = '1';
            }
        },

        async syncFiles() {
            if (State.files.length === 0) return;

            UI.syncBtn.textContent = "WRITING...";
            UI.syncBtn.disabled = true;

            try {
                const res = await fetch(`${CONFIG.API_BASE}/sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ files: State.files })
                });
                const data = await res.json();

                if (data.success) {
                    // Visual Feedback
                    let created = 0;
                    let updated = 0;
                    data.results.forEach(r => r.status === 'CREATED' ? created++ : updated++);

                    UI.syncBtn.textContent = `DONE (${created} NEW, ${updated} UPD)`;
                    UI.syncBtn.style.background = CONFIG.COLORS.success;

                    setTimeout(() => Scanner.scan(), 3000);
                } else {
                    throw new Error("API Error");
                }
            } catch (e) {
                console.error(e);
                UI.syncBtn.textContent = "FAILED";
                UI.syncBtn.style.background = CONFIG.COLORS.error;
                setTimeout(() => Scanner.scan(), 3000);
            }
        }
    };

    // --- SCANNER (From v11, Enhanced Regex) ---
    const Scanner = {
        // Updated Regex to allow 'res://', 'user://', 'C:/' etc.
        // It allows colons ':' and mostly alphanumeric characters
        PATH_REGEX: /([a-zA-Z0-9_\-./\\:]+\.[a-zA-Z0-9]+)/,

        cleanPath(text) {
            if (!text) return null;
            // First check if it looks roughly like a file
            if (!/\.[a-zA-Z0-9]+$/.test(text.trim())) return null;

            const match = text.match(this.PATH_REGEX);
            if (match) {
                let p = match[1];
                // Note: We DO NOT strip 'res://' here.
                // We send it to server as is. Server handles resolution.
                // We only fix windows slashes for display consistency
                p = p.replace(/\\/g, '/');
                return p;
            }
            return null;
        },

        getPrecedingHeader(codeBlock) {
            let current = codeBlock.previousElementSibling;
            let attempts = 0;
            while (current && attempts < 5) {
                const text = current.innerText ? current.innerText.trim() : '';
                if (text.length > 0) {
                    if (text.includes('###')) {
                        const path = this.cleanPath(text);
                        if (path) return path;
                    }
                    const path = this.cleanPath(text);
                    if (path && text.length < 150) return path;
                    attempts++;
                }
                current = current.previousElementSibling;
            }
            // Fallback for nested
            if (codeBlock.parentElement && codeBlock.parentElement.previousElementSibling) {
                const pText = codeBlock.parentElement.previousElementSibling.innerText;
                if (pText && pText.includes('###')) return this.cleanPath(pText);
            }
            return null;
        },

        findLastUserFence() {
            const icons = Array.from(document.querySelectorAll('mat-icon, i.google-material-icons, span.material-symbols-outlined'));
            const editIcons = icons.filter(icon => {
                const text = icon.innerText.trim().toLowerCase();
                return text === 'edit' || text === 'mode_edit';
            });
            return editIcons.length > 0 ? editIcons[editIcons.length - 1] : null;
        },

        scan() {
            const fence = this.findLastUserFence();
            const allBlocks = Array.from(document.querySelectorAll('ms-code-block'));

            let activeBlocks = [];
            if (fence) {
                activeBlocks = allBlocks.filter(block =>
                    (fence.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING)
                );
            }

            const fileMap = new Map();
            activeBlocks.forEach(block => {
                const codeEl = block.querySelector('code');
                if (!codeEl) return;

                const path = this.getPrecedingHeader(block);
                if (path) {
                    fileMap.set(path, { path, content: codeEl.innerText });
                }
            });

            UI.renderFiles(Array.from(fileMap.values()), !!fence);
        }
    };

    // --- BOOTSTRAP ---
    setTimeout(() => {
        UI.init();
        Logic.checkServer(); // Initial ping

        // Loop
        setInterval(() => {
            Scanner.scan();
        }, 800);

        // Slower loop for server status
        setInterval(() => {
            Logic.checkServer();
        }, 5000);

    }, 1500);

})();