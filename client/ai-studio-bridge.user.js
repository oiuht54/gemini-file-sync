// ==UserScript==
// @name         AI Studio Workspace Manager (v8.1 - Big Buttons)
// @namespace    http://tampermonkey.net/
// @version      8.1
// @description  Larger UI controls. Reads collapsed/hidden code blocks.
// @author       Gemini 3 Architect
// @match        https://aistudio.google.com/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        API_BASE: 'http://localhost:3000',
        COLORS: {
            bg: '#121212', bgHeader: '#1e1e1e', border: '#333',
            accent: '#0d96f2', success: '#4caf50', error: '#f44336', text: '#e0e0e0',
            btnBg: '#333', btnHover: '#444'
        }
    };

    const State = {
        isCollapsed: localStorage.getItem('ai_bridge_collapsed') === 'true',
        serverConnected: false
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

    // --- UI COMPONENTS ---
    const UI = {
        root: null, header: null, body: null, statusDot: null,
        pathInput: null, historySelect: null, statusLabel: null,
        fileList: null, syncBtn: null, scanBtn: null, toggleBtn: null,

        init() {
            const old = document.getElementById('ai-bridge-v2');
            if (old) old.remove();

            // Root Container
            this.root = el('div', {
                position: 'fixed', bottom: '20px', right: '20px',
                width: State.isCollapsed ? '220px' : '340px', // Slightly wider collapsed state for big buttons
                backgroundColor: CONFIG.COLORS.bg,
                border: `1px solid ${CONFIG.COLORS.border}`, borderRadius: '8px',
                fontFamily: 'Consolas, monospace', fontSize: '12px', color: CONFIG.COLORS.text,
                zIndex: '999999', boxShadow: '0 10px 30px rgba(0,0,0,0.9)',
                display: 'flex', flexDirection: 'column'
            });
            this.root.id = 'ai-bridge-v2';

            // Header
            this.header = el('div', {
                padding: '8px 12px', backgroundColor: CONFIG.COLORS.bgHeader,
                borderBottom: State.isCollapsed ? 'none' : `1px solid ${CONFIG.COLORS.border}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                height: '40px' // Fixed height for header
            });

            // Title
            const titleRow = el('div', { display: 'flex', alignItems: 'center', gap: '10px' });
            this.statusDot = el('div', {
                width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#555', cursor: 'help'
            }, { title: 'Checking connection...' });
            
            const titleText = el('span', { fontWeight: 'bold', fontSize: '13px' }, 'AI BRIDGE');
            titleRow.append(this.statusDot, titleText);

            // Controls (Scan + Minimize) - NOW BIGGER
            const controlsRow = el('div', { display: 'flex', gap: '8px' });
            
            const btnStyle = {
                background: CONFIG.COLORS.btnBg,
                border: '1px solid #444',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '0',
                width: '32px',
                height: '32px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s'
            };

            this.scanBtn = el('button', btnStyle, { textContent: '↻', title: 'Force Scan' });
            this.scanBtn.onmouseover = () => this.scanBtn.style.background = CONFIG.COLORS.btnHover;
            this.scanBtn.onmouseout = () => this.scanBtn.style.background = CONFIG.COLORS.btnBg;
            this.scanBtn.onclick = (e) => { 
                e.stopPropagation(); 
                this.scanBtn.style.transform = 'rotate(360deg)';
                this.scanBtn.style.transition = 'transform 0.4s';
                setTimeout(() => { this.scanBtn.style.transform = 'none'; this.scanBtn.style.transition = 'background 0.2s'; }, 400);
                Logic.checkServer(); 
                Scanner.scan(); 
            };

            this.toggleBtn = el('button', btnStyle, { textContent: State.isCollapsed ? '+' : '−', title: 'Minimize/Maximize' });
            this.toggleBtn.onmouseover = () => this.toggleBtn.style.background = CONFIG.COLORS.btnHover;
            this.toggleBtn.onmouseout = () => this.toggleBtn.style.background = CONFIG.COLORS.btnBg;
            this.toggleBtn.onclick = (e) => { e.stopPropagation(); this.toggleCollapse(); };

            controlsRow.append(this.scanBtn, this.toggleBtn);
            this.header.append(titleRow, controlsRow);

            // Click header to toggle (except buttons)
            this.header.onclick = (e) => {
                if (e.target !== this.scanBtn && e.target !== this.toggleBtn && e.target.parentNode !== this.scanBtn && e.target.parentNode !== this.toggleBtn) {
                    this.toggleCollapse();
                }
            };

            // Body
            this.body = el('div', { 
                display: State.isCollapsed ? 'none' : 'flex', 
                flexDirection: 'column', padding: '12px', gap: '10px' 
            });

            const settings = el('div', { display: 'flex', gap: '5px' });
            this.pathInput = el('input', {
                flex: '1', background: '#222', border: '1px solid #444', color: '#fff', padding: '8px', borderRadius: '4px'
            }, { placeholder: 'Project Root...' });
            
            const dl = document.createElement('datalist'); dl.id = 'br-hist'; document.body.appendChild(dl);
            this.historySelect = dl;
            this.pathInput.setAttribute('list', 'br-hist');

            const setBtn = el('button', { 
                background: '#333', color: '#fff', border: 'none', cursor: 'pointer', padding: '0 12px', borderRadius: '4px', fontWeight: 'bold' 
            }, { textContent: 'SET' });
            setBtn.onclick = Logic.setProjectRoot;
            settings.append(this.pathInput, setBtn);

            this.statusLabel = el('div', { textAlign: 'center', color: '#888', padding: '4px' }, 'Idle');
            
            this.fileList = el('div', {
                maxHeight: '180px', overflowY: 'auto', background: '#000', border: '1px solid #333',
                padding: '5px', display: 'flex', flexDirection: 'column', gap: '2px', borderRadius: '4px'
            });

            this.syncBtn = el('button', {
                padding: '14px', background: '#222', color: '#555', border: 'none', fontWeight: 'bold', cursor: 'not-allowed', borderRadius: '4px', fontSize: '13px'
            }, { textContent: 'NO FILES' });
            this.syncBtn.disabled = true;
            this.syncBtn.onclick = Logic.syncFiles;

            this.body.append(settings, this.statusLabel, this.fileList, this.syncBtn);
            this.root.append(this.header, this.body);
            document.body.appendChild(this.root);
        },

        toggleCollapse() {
            State.isCollapsed = !State.isCollapsed;
            localStorage.setItem('ai_bridge_collapsed', State.isCollapsed);
            
            this.root.style.width = State.isCollapsed ? '220px' : '340px';
            this.body.style.display = State.isCollapsed ? 'none' : 'flex';
            this.header.style.borderBottom = State.isCollapsed ? 'none' : `1px solid ${CONFIG.COLORS.border}`;
            this.toggleBtn.textContent = State.isCollapsed ? '+' : '−';
        },

        updateStatus(connected, data) {
            this.statusDot.style.backgroundColor = connected ? CONFIG.COLORS.success : CONFIG.COLORS.error;
            if (connected && data) {
                if (data.cwd && this.pathInput.value !== data.cwd) this.pathInput.value = data.cwd;
                if (data.history) {
                    clearChildren(this.historySelect);
                    data.history.forEach(p => this.historySelect.appendChild(el('option', { value: p })));
                }
            }
        },

        renderFiles(files) {
            if (!this.fileList) return; 
            clearChildren(this.fileList);
            
            if (files.length === 0) {
                this.statusLabel.textContent = "Latest message has no code.";
                this.syncBtn.disabled = true;
                this.syncBtn.textContent = "NO FILES";
                this.syncBtn.style.background = '#222';
                this.syncBtn.style.color = '#555';
                this.syncBtn.style.cursor = 'not-allowed';
            } else {
                this.statusLabel.textContent = `Found ${files.length} file(s) in last msg`;
                this.statusLabel.style.color = CONFIG.COLORS.success;
                
                this.syncBtn.disabled = false;
                this.syncBtn.textContent = "SYNC TO DISK";
                this.syncBtn.style.background = CONFIG.COLORS.accent;
                this.syncBtn.style.color = '#fff';
                this.syncBtn.style.cursor = 'pointer';
            }

            files.forEach(f => {
                const row = el('div', { display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #222', padding: '4px' });
                row.append(
                    el('span', { color: '#ddd' }, f.path),
                    el('span', { color: '#555' }, `${f.content.length}b`)
                );
                this.fileList.appendChild(row);
            });
        }
    };

    // --- LOGIC ---
    const Logic = {
        async checkServer() {
            try {
                const res = await fetch(`${CONFIG.API_BASE}/status`);
                if (res.ok) UI.updateStatus(true, await res.json());
                else throw new Error();
            } catch { UI.updateStatus(false); }
        },
        async setProjectRoot() {
            const path = UI.pathInput.value.trim();
            if(!path) return;
            try {
                const res = await fetch(`${CONFIG.API_BASE}/config/root`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path})
                });
                const data = await res.json();
                if(data.success) UI.updateStatus(true, data);
            } catch { alert("Connection Error"); }
        },
        async syncFiles() {
            const files = Scanner.currentFiles;
            if(!files || !files.length) return;
            UI.syncBtn.textContent = "WRITING...";
            try {
                const res = await fetch(`${CONFIG.API_BASE}/sync`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({files})
                });
                const data = await res.json();
                if(data.success) {
                    UI.syncBtn.textContent = "DONE ✓";
                    UI.syncBtn.style.background = CONFIG.COLORS.success;
                    setTimeout(() => Scanner.scan(), 3000);
                }
            } catch { UI.syncBtn.textContent = "ERROR"; UI.syncBtn.style.background = CONFIG.COLORS.error; }
        }
    };

    // --- SCANNER ---
    const Scanner = {
        currentFiles: [],

        getPath(text) {
            if (!text || text.length > 200) return null;
            const match = text.match(/([a-zA-Z0-9_\-./\\:]+\.[a-zA-Z0-9]+)/);
            if (!match) return null;
            let p = match[1].replace(/\\/g, '/');
            const isValid = p.includes('/') || p.startsWith('res://') || text.includes('###');
            return isValid ? p : null;
        },

        isInLastMessageBubble(codeBlock) {
            let container = codeBlock;
            for (let i = 0; i < 12; i++) {
                if (!container.parentElement) break;
                const parent = container.parentElement;
                if (parent.childElementCount > 1) {
                    if (parent.lastElementChild === container) {
                        return true; 
                    } else {
                        const last = parent.lastElementChild;
                        if (last.innerText.trim() === '' || last.tagName.includes('LOADER')) {
                            if (last.previousElementSibling === container) return true;
                        }
                        return false;
                    }
                }
                container = parent;
            }
            return true;
        },

        scan() {
            try {
                const allBlocks = Array.from(document.querySelectorAll('ms-code-block'));
                if (allBlocks.length === 0) {
                    this.currentFiles = []; UI.renderFiles([]); return;
                }

                const lastBlock = allBlocks[allBlocks.length - 1];

                if (!this.isInLastMessageBubble(lastBlock)) {
                    this.currentFiles = [];
                    UI.renderFiles([]);
                    return;
                }

                const activeBlocks = allBlocks.filter(b => this.isInLastMessageBubble(b));
                const headers = Array.from(document.querySelectorAll('h3, h4, strong, p, span'));
                const fileMap = new Map();

                activeBlocks.forEach(block => {
                    const codeEl = block.querySelector('code');
                    if (!codeEl) return;
                    
                    // Use textContent to read hidden/collapsed code
                    const content = codeEl.textContent; 
                    if (!content) return;

                    let bestPath = null;
                    for (const header of headers) {
                        if (header.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING) {
                            const p = this.getPath(header.innerText);
                            if (p) bestPath = p;
                        }
                    }
                    if (bestPath) {
                        fileMap.set(bestPath, { path: bestPath, content: content });
                    }
                });

                this.currentFiles = Array.from(fileMap.values());
                UI.renderFiles(this.currentFiles);

            } catch (e) { console.error(e); }
        }
    };

    setTimeout(() => { UI.init(); Logic.checkServer(); setInterval(() => Scanner.scan(), 1000); }, 1500);
})();