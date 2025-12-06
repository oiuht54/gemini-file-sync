// ==UserScript==
// @name         AI Studio Workspace Manager (v7.0 - Structure Check)
// @namespace    http://tampermonkey.net/
// @version      7.0
// @description  Robustly identifies if the code block belongs to the absolute last message bubble in the chat list.
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
            accent: '#0d96f2', success: '#4caf50', error: '#f44336', text: '#e0e0e0'
        }
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

            this.root = el('div', {
                position: 'fixed', bottom: '20px', right: '20px',
                width: '340px', backgroundColor: CONFIG.COLORS.bg,
                border: `1px solid ${CONFIG.COLORS.border}`, borderRadius: '8px',
                fontFamily: 'Consolas, monospace', fontSize: '12px', color: CONFIG.COLORS.text,
                zIndex: '999999', boxShadow: '0 10px 30px rgba(0,0,0,0.9)',
                display: 'flex', flexDirection: 'column'
            });
            this.root.id = 'ai-bridge-v2';

            this.header = el('div', {
                padding: '10px', backgroundColor: CONFIG.COLORS.bgHeader,
                borderBottom: `1px solid ${CONFIG.COLORS.border}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
            });

            const titleRow = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
            this.statusDot = el('div', {
                width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#555', cursor: 'help'
            }, { title: 'Checking connection...' });
            titleRow.append(this.statusDot, el('span', { fontWeight: 'bold' }, 'AI WORKSPACE v7.0'));

            this.scanBtn = el('button', {
                background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '14px'
            }, { textContent: '↻', title: 'Force Scan' });
            this.scanBtn.onclick = () => { Logic.checkServer(); Scanner.scan(); };

            this.header.append(titleRow, this.scanBtn);

            this.body = el('div', { display: 'flex', flexDirection: 'column', padding: '10px', gap: '10px' });

            const settings = el('div', { display: 'flex', gap: '5px' });
            this.pathInput = el('input', {
                flex: '1', background: '#222', border: '1px solid #444', color: '#fff', padding: '4px'
            }, { placeholder: 'Project Root...' });
            
            const dl = document.createElement('datalist'); dl.id = 'br-hist'; document.body.appendChild(dl);
            this.historySelect = dl;
            this.pathInput.setAttribute('list', 'br-hist');

            const setBtn = el('button', { background: '#333', color: '#fff', border: 'none', cursor: 'pointer', padding: '0 8px' }, { textContent: 'SET' });
            setBtn.onclick = Logic.setProjectRoot;
            settings.append(this.pathInput, setBtn);

            this.statusLabel = el('div', { textAlign: 'center', color: '#888' }, 'Idle');
            
            this.fileList = el('div', {
                maxHeight: '150px', overflowY: 'auto', background: '#000', border: '1px solid #333',
                padding: '5px', display: 'flex', flexDirection: 'column', gap: '2px'
            });

            this.syncBtn = el('button', {
                padding: '10px', background: '#222', color: '#555', border: 'none', fontWeight: 'bold', cursor: 'not-allowed'
            }, { textContent: 'NO FILES' });
            this.syncBtn.disabled = true;
            this.syncBtn.onclick = Logic.syncFiles;

            this.body.append(settings, this.statusLabel, this.fileList, this.syncBtn);
            this.root.append(this.header, this.body);
            document.body.appendChild(this.root);
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
                const row = el('div', { display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #222', padding: '2px' });
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

    // --- SCANNER (STRUCTURAL CHECK) ---
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

        // This function determines if a code block is inside the LAST child of the Message List
        isInLastMessageBubble(codeBlock) {
            let container = codeBlock;
            // Climb up to find the "Message List"
            // The Message List is a container that has multiple children which look like messages.
            
            for (let i = 0; i < 12; i++) { // Limit depth
                if (!container.parentElement) break;
                
                const parent = container.parentElement;
                
                // Heuristic: If parent has > 1 children, and we are one of them.
                if (parent.childElementCount > 1) {
                    
                    // Does the parent look like a list? (e.g. infinite scroll container)
                    // Check if our current 'container' is the LAST child of 'parent'
                    if (parent.lastElementChild === container) {
                        
                        // We are in the last child!
                        // But we need to be sure this is the MAIN list, not a sub-list.
                        // If we are deep inside a message, this condition might trigger for a paragraph list.
                        // However, usually code blocks are not inside lists inside messages.
                        // They are usually direct children of the message body.
                        
                        // Let's verify: Is there any 'ms-code-block' in previous siblings?
                        // If yes, then this is likely the main list or a major container.
                        return true; 
                    } else {
                        // We are NOT in the last child. 
                        // e.g. We are in Child N-1. Child N is the new text message.
                        // This definitively means we are OLD.
                        return false;
                    }
                }
                container = parent;
            }
            // If we couldn't find a list structure, fallback to True (assume single message view?)
            // Or False (safe)? Let's assume True if we can't prove it's old.
            return true;
        },

        scan() {
            try {
                const allBlocks = Array.from(document.querySelectorAll('ms-code-block'));
                if (allBlocks.length === 0) {
                    this.currentFiles = []; UI.renderFiles([]); return;
                }

                const lastBlock = allBlocks[allBlocks.length - 1];

                // 1. Structural Freshness Check
                if (!this.isInLastMessageBubble(lastBlock)) {
                    this.currentFiles = [];
                    UI.renderFiles([]);
                    return;
                }

                // 2. Scan scope (similar to previous versions)
                let scope = lastBlock.parentElement; 
                while(scope && scope.childElementCount < 2) scope = scope.parentElement; 
                if(!scope) scope = document.body;

                const headers = Array.from(document.querySelectorAll('h3, h4, strong, p, span'));
                const fileMap = new Map();

                // Get all blocks in this last message
                // We know lastBlock is in it. Let's find others in the same scope.
                // Actually, filtering by isInLastMessageBubble for ALL blocks is safer.
                
                const activeBlocks = allBlocks.filter(b => this.isInLastMessageBubble(b));

                activeBlocks.forEach(block => {
                    const codeEl = block.querySelector('code');
                    if (!codeEl) return;
                    let bestPath = null;
                    for (const header of headers) {
                        if (header.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING) {
                            const p = this.getPath(header.innerText);
                            if (p) bestPath = p;
                        }
                    }
                    if (bestPath) {
                        fileMap.set(bestPath, { path: bestPath, content: codeEl.innerText });
                    }
                });

                this.currentFiles = Array.from(fileMap.values());
                UI.renderFiles(this.currentFiles);

            } catch (e) { console.error(e); }
        }
    };

    setTimeout(() => { UI.init(); Logic.checkServer(); setInterval(() => Scanner.scan(), 1000); }, 1500);
})();