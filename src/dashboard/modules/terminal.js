/**
 * DASHBOARD — Terminal & WebSocket
 * 
 * Connessione WebSocket, output terminale, job containers.
 */

// ── State ──
let ws = null;
let reconnectTimeout = null;
let terminalPinned = localStorage.getItem('terminalPinned') === 'true';
let terminalAutoCollapseTimer = null;
let terminalLineCount = 0;

/** WS message handler — verrà esteso dall'orchestratore */
let wsMessageHandler = null;

export function setWsMessageHandler(handler) {
    wsMessageHandler = handler;
}

// ── WebSocket Connection ──
export function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onopen = () => {
        document.querySelector('.status-dot').classList.add('connected');
        document.querySelector('.api-status span').textContent = 'Connesso';
        appendTerminal('✅ WebSocket connesso', 'success');
    };

    ws.onclose = () => {
        document.querySelector('.status-dot').classList.remove('connected');
        document.querySelector('.api-status span').textContent = 'Disconnesso';
        reconnectTimeout = setTimeout(connectWebSocket, 3000);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
    };
}

export function handleWsMessage(data) {
    switch (data.type) {
        case 'connected':
            // Il fetchStatus verrà chiamato dall'orchestratore
            if (wsMessageHandler) wsMessageHandler(data);
            break;
        case 'job:start':
            getOrCreateJobContainer(data.jobId, data.name);
            break;
        case 'job:output':
            appendTerminal(data.text, data.stream, data.jobId);
            break;
        case 'job:end':
            finishJob(data.jobId, data.success);
            if (data.success) {
                window.imageCacheBuster = Date.now();
            }
            if (wsMessageHandler) wsMessageHandler(data);
            break;
    }
}

// ── Job Containers ──
function getOrCreateJobContainer(jobId, jobName) {
    if (!jobId) return document.getElementById('terminal');
    
    let jobWrap = document.getElementById(`job-wrap-${jobId}`);
    if (!jobWrap) {
        const terminal = document.getElementById('terminal');
        jobWrap = document.createElement('div');
        jobWrap.id = `job-wrap-${jobId}`;
        jobWrap.className = 'terminal-job running';
        
        jobWrap.innerHTML = `
            <div class="terminal-job-header" data-action="toggle-collapse">
                <div class="job-status-icon"><i data-lucide="loader-2" class="lucide-spin job-icon-running"></i></div>
                <div class="job-name">${jobName || jobId}</div>
                <div class="job-badge">Running</div>
                <i data-lucide="chevron-down" class="job-chevron"></i>
            </div>
            <div class="terminal-job-logs" id="job-logs-${jobId}"></div>
        `;
        jobWrap.querySelector('[data-action="toggle-collapse"]').addEventListener('click', (e) => {
            e.currentTarget.parentElement.classList.toggle('collapsed');
        });
        terminal.appendChild(jobWrap);
        lucide?.createIcons?.({ nodes: [jobWrap] });
        terminal.scrollTop = terminal.scrollHeight;
    }
    return document.getElementById(`job-logs-${jobId}`);
}

function finishJob(jobId, success) {
    const wrap = document.getElementById(`job-wrap-${jobId}`);
    if (wrap) {
        wrap.classList.remove('running');
        wrap.classList.add(success ? 'success' : 'failed');
        wrap.querySelector('.job-status-icon').innerHTML = success ? '<i data-lucide="check-circle-2" class="job-icon-success"></i>' : '<i data-lucide="x-circle" class="job-icon-error"></i>';
        wrap.querySelector('.job-badge').textContent = success ? 'Done' : 'Error';
        
        if (success) {
            wrap.classList.add('collapsed');
        }
        lucide?.createIcons?.({ nodes: [wrap] });
    } else {
        appendTerminal(`${success ? '✅' : '❌'} Job completato`, success ? 'success' : 'stderr');
    }
}

// ── Terminal Output ──
export function appendTerminal(text, type = 'stdout', jobId = null) {
    const parent = jobId ? getOrCreateJobContainer(jobId, 'Job...') : document.getElementById('terminal');
    const terminal = document.getElementById('terminal');
    const line = document.createElement('div');
    line.className = `terminal-line ${type}`;
    line.textContent = text;
    const isAtBottom = (terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight) < 50;

    parent.appendChild(line);
    
    if (isAtBottom) {
        terminal.scrollTop = terminal.scrollHeight;
    }
    
    terminalLineCount++;
    updateTerminalBadge();
}

export function clearTerminal() {
    document.getElementById('terminal').innerHTML =
        '<div class="terminal-line system">🔥 Terminal pulito.</div>';
    terminalLineCount = 0;
    updateTerminalBadge();
}

export function expandTerminal() {
    const container = document.getElementById('terminalContainer');
    container.classList.remove('minimized');
    updateToggleIcon(false);
}

function collapseTerminal() {
    if (terminalPinned) return;
    const container = document.getElementById('terminalContainer');
    container.classList.add('minimized');
    updateToggleIcon(true);
}

export function toggleTerminal() {
    const container = document.getElementById('terminalContainer');
    const isMinimized = container.classList.contains('minimized');
    if (isMinimized) {
        expandTerminal();
        clearTimeout(terminalAutoCollapseTimer);
        if (!terminalPinned) {
            terminalAutoCollapseTimer = setTimeout(() => collapseTerminal(), 10000);
        }
    } else {
        collapseTerminal();
        clearTimeout(terminalAutoCollapseTimer);
    }
}

export function toggleTerminalPin() {
    terminalPinned = !terminalPinned;
    localStorage.setItem('terminalPinned', terminalPinned);
    const pinBtn = document.getElementById('terminalPinBtn');
    pinBtn.classList.toggle('active', terminalPinned);
    pinBtn.title = terminalPinned ? 'Sblocca' : 'Blocca aperto';
    if (terminalPinned) {
        clearTimeout(terminalAutoCollapseTimer);
        expandTerminal();
    }
}

export function toggleExpandTerminal() {
    const container = document.getElementById('terminalContainer');
    
    if (container.classList.contains('minimized')) {
        expandTerminal();
    }
    
    container.classList.toggle('expanded');
    
    const expandBtn = document.querySelector('button[title="Espandi"], button[title="Riduci"]');
    if (expandBtn) {
        const isExpanded = container.classList.contains('expanded');
        expandBtn.title = isExpanded ? 'Riduci' : 'Espandi';
        expandBtn.innerHTML = isExpanded ? '<i data-lucide="minimize-2"></i>' : '<i data-lucide="maximize-2"></i>';
        lucide?.createIcons?.();
    }
}

function updateToggleIcon(minimized) {
    const btn = document.getElementById('terminalToggle');
    if (btn) btn.innerHTML = minimized ? '<i data-lucide="chevron-up"></i>' : '<i data-lucide="chevron-down"></i>';
    lucide?.createIcons?.();
}

function updateTerminalBadge() {
    const badge = document.getElementById('terminalBadge');
    if (badge) {
        badge.textContent = terminalLineCount > 0 ? terminalLineCount : '';
        badge.classList.toggle('visible', terminalLineCount > 0);
    }
}

// Ripristina stato pin
export function restoreTerminalState() {
    if (terminalPinned) {
        requestAnimationFrame(() => {
            const pinBtn = document.getElementById('terminalPinBtn');
            if (pinBtn) {
                pinBtn.classList.add('active');
                pinBtn.title = 'Sblocca';
            }
            expandTerminal();
        });
    }
}

// Expose globally — only for functions used by other modules
window.expandTerminal = expandTerminal;
window.appendTerminal = appendTerminal;

