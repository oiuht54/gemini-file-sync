// ==UserScript==
// @name         AI Studio Workspace Manager (v12.1 - Visual Feedback)
// @namespace    http://tampermonkey.net/
// @version      12.1
// @description  Adds visual feedback to the SET button. Includes Target Mode & Instant Undo.
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
            accent: '#0d96f2', success: '#4caf50', error: '#f44336', warn: '#ff9800',
            text: '#e0e0e0', btnBg: '#333', btnHover: '#444',
            highlight: 'rgba(13, 150, 242, 0.2)', highlightBorder: '#0d96f2'
        }
    };

    const State = {
        isCollapsed: localStorage.getItem('ai_bridge_collapsed') === 'true',
        serverConnected: false,
        manualScope: null,
        isSelecting: false
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
        overlay: null,
        hoveredElement: null,

        init() {
            const style = document.createElement('style');
            style.textContent = `
                .ai-bridge-target-hover {
                    outline: 2px solid ${CONFIG.COLORS.highlightBorder} !important;
                    background-color: ${CONFIG.COLORS.highlight} !important;
                    cursor: crosshair !important;
                }
            `;
            document.head.appendChild(style);
        },

        toggle() {
            if (State.isSelecting) this.disable();
            else this.enable();
        },

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
            if (this.hoveredElement) {
                this.hoveredElement.classList.remove('ai-bridge-target-hover');
                this.hoveredElement = null;
            }
            document.removeEventListener('mouseover', this.handleHover, true);
            document.removeEventListener('click', this.handleClick, true);
            document.removeEventListener('keydown', this.handleKey);
        },

        getContainer(target) {
            let curr = target;
            for (let i = 0; i < 8; i++) {
                if (!curr || curr === document.body) return null;
                if (curr.querySelector('ms-code-block') || curr.tagName === 'MS-CODE-BLOCK') {
                     if (curr.parentElement && curr.parentElement.childElementCount > 1) {
                         return curr.parentElement;
                     }
                }
                curr = curr.parentElement;
            }
            return target;
        },

        handleHover: (e) => {
            e.stopPropagation();
            if (Selector.hoveredElement) {
                Selector.hoveredElement.classList.remove('ai-bridge-target-hover');
            }
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
        pathInput: null, historySelect: null, activeRootLabel: null, statusLabel: null,
        fileList: null, syncBtn: null, undoBtn: null, scanBtn: null, toggleBtn: null, targetBtn: null, setBtn: null,

        init() {
            Selector.init();
            const old = document.getElementById('ai-bridge-v2');
            if (old) old.remove();

            // Root
            this.root = el('div', {
                position: 'fixed', bottom: '20px', right: '20px',
                width: State.isCollapsed ? '260px' : '340px',
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
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: '40px'
            });

            const titleRow = el('div', { display: 'flex', alignItems: 'center', gap: '10px' });
            this.statusDot = el('div', {
                width: '12px', height: '12px', borderRadius: '50%', backgroundColor: '#555', cursor: 'help'
            }, { title: 'Checking connection...' });
            titleRow.append(this.statusDot, el('span', { fontWeight: 'bold', fontSize: '13px' }, 'AI BRIDGE'));

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
                this.scanBtn.style.transform = 'rotate(360deg)';
                this.scanBtn.style.transition = 'transform 0.4s';
                setTimeout(() => { this.scanBtn.style.transform = 'none'; this.scanBtn.style.transition = ''; }, 400);
                Logic.checkServer(); Scanner.scan(); 
            };

            this.toggleBtn = el('button', btnStyle, { textContent: State.isCollapsed ? '+' : '−', title: 'Minimize' });
            this.toggleBtn.onclick = (e) => { e.stopPropagation(); this.toggleCollapse(); };

            controlsRow.append(this.targetBtn, this.scanBtn, this.toggleBtn);
            this.header.append(titleRow, controlsRow);
            this.header.onclick = (e) => { if (e.target.tagName !== 'BUTTON') this.toggleCollapse(); };

            // Body
            this.body = el('div', { 
                display: State.isCollapsed ? 'none' : 'flex', flexDirection: 'column', padding: '12px', gap: '10px' 
            });

            const settings = el('div', { display: 'flex', gap: '5px' });
            this.pathInput = el('input', {
                flex: '1', background: '#222', border: '1px solid #444', color: '#fff', padding: '8px', borderRadius: '4px'
            }, { placeholder: 'Project Root...' });
            
            const dl = document.createElement('datalist'); dl.id = 'br-hist'; document.body.appendChild(dl);
            this.historySelect = dl;
            this.pathInput.setAttribute('list', 'br-hist');

            this.setBtn = el('button', { 
                background: '#333', color: '#fff', border: 'none', cursor: 'pointer', padding: '0 12px', borderRadius: '4px', fontWeight: 'bold', transition: 'background 0.2s' 
            }, { textContent: 'SET' });
            this.setBtn.onclick = Logic.setProjectRoot;
            settings.append(this.pathInput, this.setBtn);

            this.activeRootLabel = el('div', {
                fontSize: '10px', color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                padding: '0 2px', cursor: 'help'
            }, { textContent: '📂 Connecting...' });

            this.statusLabel = el('div', { textAlign: 'center', color: '#888', padding: '4px' }, 'Idle');
            
            this.fileList = el('div', {
                maxHeight: '180px', overflowY: 'auto', background: '#000', border: '1px solid #333',
                padding: '5px', display: 'flex', flexDirection: 'column', gap: '2px', borderRadius: '4px'
            });

            const actionsRow = el('div', { display: 'flex', gap: '5px' });

            this.syncBtn = el('button', {
                flex: '2', padding: '14px', background: '#222', color: '#555', border: 'none', fontWeight: 'bold', 
                cursor: 'not-allowed', borderRadius: '4px', fontSize: '13px'
            }, { textContent: 'NO FILES' });
            this.syncBtn.disabled = true;
            this.syncBtn.onclick = Logic.syncFiles;

            this.undoBtn = el('button', {
                flex: '1', padding: '14px', background: '#222', color: '#555', border: 'none', fontWeight: 'bold', 
                cursor: 'not-allowed', borderRadius: '4px', fontSize: '13px'
            }, { textContent: 'UNDO', title: 'Instant Rollback' });
            this.undoBtn.disabled = true;
            this.undoBtn.onclick = Logic.rollback;

            actionsRow.append(this.syncBtn, this.undoBtn);

            this.body.append(settings, this.activeRootLabel, this.statusLabel, this.fileList, actionsRow);
            this.root.append(this.header, this.body);
            document.body.appendChild(this.root);
        },

        toggleCollapse() {
            State.isCollapsed = !State.isCollapsed;
            localStorage.setItem('ai_bridge_collapsed', State.isCollapsed);
            this.root.style.width = State.isCollapsed ? '260px' : '340px';
            this.body.style.display = State.isCollapsed ? 'none' : 'flex';
            this.header.style.borderBottom = State.isCollapsed ? 'none' : `1px solid ${CONFIG.COLORS.border}`;
            this.toggleBtn.textContent = State.isCollapsed ? '+' : '−';
        },

        updateStatus(connected, data) {
            this.statusDot.style.backgroundColor = connected ? CONFIG.COLORS.success : CONFIG.COLORS.error;
            if (connected && data) {
                if (data.cwd) {
                    this.activeRootLabel.textContent = `📂 ${data.cwd}`;
                    this.activeRootLabel.title = data.cwd;
                    this.activeRootLabel.style.color = '#aaa';
                }
                if (this.pathInput.value === '') this.pathInput.value = data.cwd;
                if (data.history) {
                    clearChildren(this.historySelect);
                    data.history.forEach(p => this.historySelect.appendChild(el('option', { value: p })));
                }
            } else {
                this.activeRootLabel.textContent = '🔌 Disconnected';
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

            if (files.length === 0) {
                this.syncBtn.disabled = true;
                this.syncBtn.textContent = "NO FILES";
                this.syncBtn.style.background = '#222';
                this.syncBtn.style.color = '#555';
                this.syncBtn.style.cursor = 'not-allowed';
            } else {
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
            
            const btn = UI.setBtn;
            const originalText = btn.textContent;
            const originalBg = btn.style.background;

            btn.disabled = true;
            btn.textContent = '...';

            try {
                const res = await fetch(`${CONFIG.API_BASE}/config/root`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path})
                });
                const data = await res.json();
                
                if(data.success) {
                    UI.pathInput.value = ''; 
                    UI.updateStatus(true, data);
                    
                    // Success Flash
                    btn.textContent = 'OK';
                    btn.style.background = CONFIG.COLORS.success;
                    
                    setTimeout(() => {
                        btn.textContent = originalText;
                        btn.style.background = originalBg;
                        btn.disabled = false;
                    }, 1000);
                } else { throw new Error(data.error); }
            } catch(e) { 
                // Error Flash
                btn.textContent = 'ERR';
                btn.style.background = CONFIG.COLORS.error;
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.style.background = originalBg;
                    btn.disabled = false;
                }, 1000);
            }
        },
        async syncFiles() {
            const files = Scanner.currentFiles;
            if(!files || !files.length) return;
            UI.syncBtn.textContent = "WRITING...";
            UI.syncBtn.disabled = true;
            try {
                const res = await fetch(`${CONFIG.API_BASE}/sync`, {
                    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({files})
                });
                const data = await res.json();
                if(data.success) {
                    UI.syncBtn.textContent = "DONE ✓";
                    UI.syncBtn.style.background = CONFIG.COLORS.success;
                    UI.enableUndo(true);
                    if (!State.manualScope) setTimeout(() => Scanner.scan(), 3000);
                }
            } catch { 
                UI.syncBtn.textContent = "ERROR"; 
                UI.syncBtn.style.background = CONFIG.COLORS.error; 
            }
        },
        async rollback() {
            UI.undoBtn.textContent = "...";
            try {
                const res = await fetch(`${CONFIG.API_BASE}/rollback`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    UI.undoBtn.textContent = "REVERTED";
                    setTimeout(() => {
                        UI.undoBtn.textContent = "UNDO";
                        UI.enableUndo(false);
                    }, 1500);
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
            if (!text || text.length > 200) return null;
            const match = text.match(/([a-zA-Z0-9_\-./\\:]+\.[a-zA-Z0-9]+)/);
            if (!match) return null;
            let p = match[1].replace(/\\/g, '/');
            const isValid = p.includes('/') || p.startsWith('res://') || text.includes('###');
            return isValid ? p : null;
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

                const activeBlocks = Array.from(scope.querySelectorAll('ms-code-block'));
                const headers = Array.from(scope.querySelectorAll('h3, h4, strong, p, span'));
                const fileMap = new Map();

                activeBlocks.forEach(block => {
                    const codeEl = block.querySelector('code');
                    if (!codeEl) return;
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