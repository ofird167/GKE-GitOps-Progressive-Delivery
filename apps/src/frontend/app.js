// app.js: Redesigned Frontend Controller for GKE Ops Hub Control Panel

const API_BASE = (window.location.protocol === 'file:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://34.72.210.225/api'
    : '/api';

let backendVersion = '-';
let isAuthenticatedState = false;

// Unified API client supporting credentials & JSON payload mapping
async function fetchAPI(path, options = {}) {
    options.headers = options.headers || {};
    options.credentials = 'include';
    if (options.method === 'POST' && options.body && typeof options.body === 'object') {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
    }
    return fetch(`${API_BASE}${path}`, options);
}

function updateActionButtonsState(authenticated) {
    isAuthenticatedState = authenticated;
    const cardRollout = document.getElementById('card-rollout-control');
    if (cardRollout) {
        cardRollout.style.display = authenticated ? 'block' : 'none';
    }

    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
        logoutBtn.style.display = authenticated ? 'block' : 'none';
    }

    const buttons = [
        'btn-visit',
        'btn-reset-visits',
        'btn-run-canary',
        'btn-deploy-canary',
        'btn-promote-canary',
        'btn-rollback-stable',
        'btn-switch-version',
        'btn-rollback'
    ];
    buttons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.disabled = !authenticated;
        }
    });
}

// Initial state lock
updateActionButtonsState(false);

// Tab Navigation Logic
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');
const pageTitle = document.getElementById('page-title');

navItems.forEach(item => {
    item.addEventListener('click', () => {
        const targetTab = item.getAttribute('data-tab');
        
        // Remove active class from all items and tabs
        navItems.forEach(nav => nav.classList.remove('active'));
        tabContents.forEach(tab => tab.classList.remove('active'));
        
        // Add active class to clicked item and target tab
        item.classList.add('active');
        document.getElementById(targetTab).classList.add('active');
        
        // Update top bar title
        if (targetTab === 'status-tab') pageTitle.textContent = 'Operations Control Panel';
        if (targetTab === 'gitops-tab') pageTitle.textContent = 'GitOps & Delivery Pipeline';
        if (targetTab === 'db-tab') pageTitle.textContent = 'Database & Persistent Volume';
        if (targetTab === 'diagnostics-tab') pageTitle.textContent = 'Canary Routing & Network Playground';
        if (targetTab === 'console-tab') pageTitle.textContent = 'Traffic Console & Request Logs';
    });
});

// Helper for hosts file copying
function copyHostsText() {
    const codeElement = document.getElementById('hosts-code');
    navigator.clipboard.writeText(codeElement.textContent).then(() => {
        const copyBtn = document.querySelector('.copy-btn');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
}

// Fetch Status Dashboard metrics
async function fetchSystemStatus() {
    try {
        const response = await fetchAPI('/status');
        
        if (response.status === 401) {
            // Authentication Required
            document.getElementById('global-status-dot').className = 'pulse-indicator status-yellow';
            document.getElementById('global-status-text').textContent = 'Auth Required';
            
            document.getElementById('header-backend-version').textContent = 'Backend: Locked';
            document.getElementById('header-backend-version').style.backgroundColor = 'rgba(245, 158, 11, 0.1)';
            document.getElementById('header-backend-version').style.color = 'var(--color-yellow)';
            
            document.getElementById('header-frontend-status').textContent = 'Frontend: Online';
            document.getElementById('header-frontend-status').style.backgroundColor = 'rgba(6, 182, 212, 0.1)';
            document.getElementById('header-frontend-status').style.color = 'var(--color-cyan)';
            
            document.getElementById('stat-version').textContent = 'LOCKED';
            document.getElementById('stat-gateway-status').textContent = 'ONLINE';
            document.getElementById('stat-gateway-status').className = 'stat-value text-success';
            
            updateActionButtonsState(false);
            return;
        }
        
        if (!response.ok) throw new Error('API unreachable');
        const data = await response.json();
        
        // Update top status indicator
        document.getElementById('global-status-dot').className = 'pulse-indicator status-green';
        document.getElementById('global-status-text').textContent = 'Cluster Connected';
        
        backendVersion = data.version || 'v1-stable';
        document.getElementById('header-backend-version').textContent = `Backend: ${backendVersion}`;
        document.getElementById('header-backend-version').style.backgroundColor = 'rgba(139, 92, 246, 0.1)';
        document.getElementById('header-backend-version').style.color = 'var(--color-purple)';
        
        // Update stats cards
        document.getElementById('stat-version').textContent = backendVersion;
        document.getElementById('stat-gateway-status').textContent = 'ONLINE';
        document.getElementById('stat-gateway-status').className = 'stat-value text-success';
        
        // Update DB cards info
        document.getElementById('db-val-host').textContent = data.database.host || '-';
        document.getElementById('db-val-name').textContent = data.database.name || '-';
        document.getElementById('db-val-user').textContent = data.database.user || '-';

        // Check authentication state
        const authResponse = await fetchAPI('/cluster/auth-check');
        if (authResponse.ok) {
            updateActionButtonsState(true);
        } else {
            // Authentication Required
            document.getElementById('global-status-dot').className = 'pulse-indicator status-yellow';
            document.getElementById('global-status-text').textContent = 'Auth Required';
            
            document.getElementById('header-backend-version').textContent = 'Backend: Locked';
            document.getElementById('header-backend-version').style.backgroundColor = 'rgba(245, 158, 11, 0.1)';
            document.getElementById('header-backend-version').style.color = 'var(--color-yellow)';
            
            document.getElementById('header-frontend-status').textContent = 'Frontend: Online';
            document.getElementById('header-frontend-status').style.backgroundColor = 'rgba(6, 182, 212, 0.1)';
            document.getElementById('header-frontend-status').style.color = 'var(--color-cyan)';
            
            document.getElementById('stat-version').textContent = 'LOCKED';
            
            updateActionButtonsState(false);
        }

    } catch (err) {
        console.error('System status fetch failed:', err);
        document.getElementById('global-status-dot').className = 'pulse-indicator status-red';
        document.getElementById('global-status-text').textContent = 'Disconnected';
        document.getElementById('stat-gateway-status').textContent = 'OFFLINE';
        document.getElementById('stat-gateway-status').className = 'stat-value text-danger';
        
        document.getElementById('header-backend-version').textContent = 'Backend: Offline';
        document.getElementById('header-backend-version').style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
        document.getElementById('header-backend-version').style.color = 'var(--color-red)';
        
        document.getElementById('header-frontend-status').textContent = 'Frontend: Offline';
        document.getElementById('header-frontend-status').style.backgroundColor = 'rgba(239, 68, 68, 0.1)';
        document.getElementById('header-frontend-status').style.color = 'var(--color-red)';
        
        updateActionButtonsState(false);
    }
}

// Fetch and render GKE Pods Telemetry
async function fetchPodsTelemetry() {
    const tableBody = document.getElementById('pods-table-body');
    if (!tableBody) return;

    try {
        const response = await fetchAPI('/cluster/pods');
        if (!response.ok) throw new Error('Failed to fetch pods');
        const data = await response.json();
        
        // Update namespace badge in sidebar and title
        document.getElementById('sidebar-ns').textContent = data.namespace || 'staging';
        
        // Update header badges with pod counts
        const backendPodsCount = data.pods.filter(p => p.name.startsWith('backend-') && p.status === 'Running').length;
        const frontendPodsCount = data.pods.filter(p => p.name.startsWith('frontend-') && p.status === 'Running').length;
        
        document.getElementById('header-backend-version').textContent = `Backend: ${backendVersion} (${backendPodsCount} Pods)`;
        document.getElementById('header-frontend-status').textContent = `Frontend: Online (${frontendPodsCount} Pods)`;
        document.getElementById('header-frontend-status').style.backgroundColor = 'rgba(6, 182, 212, 0.1)';
        document.getElementById('header-frontend-status').style.color = 'var(--color-cyan)';
        
        // Clear table body securely (conforms to secure-web-skills element clearing)
        tableBody.replaceChildren();

        data.pods.forEach(pod => {
            const tr = document.createElement('tr');
            
            // Name
            const tdName = document.createElement('td');
            tdName.className = 'font-mono text-glow';
            tdName.textContent = pod.name;
            tr.appendChild(tdName);
            
            // Status
            const tdStatus = document.createElement('td');
            const statusSpan = document.createElement('span');
            statusSpan.className = `status-badge ${pod.status === 'Running' ? 'badge-green' : 'badge-yellow'}`;
            statusSpan.textContent = pod.status;
            tdStatus.appendChild(statusSpan);
            tr.appendChild(tdStatus);
            
            // Containers
            const tdContainers = document.createElement('td');
            tdContainers.className = 'font-mono';
            tdContainers.textContent = `${pod.readyContainers}/${pod.totalContainers}`;
            tr.appendChild(tdContainers);
            
            // Restarts
            const tdRestarts = document.createElement('td');
            tdRestarts.className = 'font-mono';
            tdRestarts.textContent = pod.restarts.toString();
            tr.appendChild(tdRestarts);
            
            // Istio Sidecar
            const tdSidecar = document.createElement('td');
            const sidecarSpan = document.createElement('span');
            sidecarSpan.className = pod.hasSidecar ? 'text-success' : 'text-danger';
            sidecarSpan.textContent = pod.hasSidecar ? '✔ Active' : '✘ Inactive';
            tdSidecar.appendChild(sidecarSpan);
            tr.appendChild(tdSidecar);
            
            // Age
            const tdAge = document.createElement('td');
            tdAge.className = 'font-mono';
            tdAge.textContent = pod.age;
            tr.appendChild(tdAge);
            
            tableBody.appendChild(tr);
        });

    } catch (err) {
        console.error('Pods fetch failed:', err);
    }
}

// Fetch and render Rollout status
async function fetchRolloutTelemetry() {
    try {
        const response = await fetchAPI('/cluster/rollout');
        if (!response.ok) throw new Error('Rollout fetch failed');
        const data = await response.json();
        
        const statusBadge = document.getElementById('rollout-status');
        statusBadge.textContent = data.status;
        statusBadge.className = `status-badge ${data.status === 'Healthy' ? 'badge-green' : 'badge-yellow'}`;
        
        document.getElementById('rollout-step').textContent = `${data.currentStepIndex}/${data.stepsCount}`;
        const stableWeight = data.stableWeight ?? 100;
        const canaryWeight = data.canaryWeight ?? 0;
        document.getElementById('rollout-weight-stable').textContent = `${stableWeight}%`;
        document.getElementById('rollout-weight-canary').textContent = `${canaryWeight}%`;

        // Dynamically align the split visualizer if a load test is not currently active
        const btnRun = document.getElementById('btn-run-canary');
        if (btnRun && !btnRun.disabled) {
            const barStable = document.getElementById('bar-stable');
            const barCanary = document.getElementById('bar-canary');
            const lblStable = document.getElementById('lbl-stable');
            const lblCanary = document.getElementById('lbl-canary');
            if (barStable && barCanary && lblStable && lblCanary) {
                barStable.style.width = `${stableWeight}%`;
                barCanary.style.width = `${canaryWeight}%`;
                lblStable.textContent = `${stableWeight}%`;
                lblCanary.textContent = `${canaryWeight}%`;
            }
        }
    } catch (err) {
        console.error('Rollout telemetry failed:', err);
    }
}

// Fetch PostgreSQL visits count
async function fetchVisitsCount() {
    try {
        const response = await fetchAPI('/visit');
        if (!response.ok) throw new Error('Visits fetch failed');
        const data = await response.json();
        document.getElementById('visit-counter').textContent = data.count.toString();
    } catch (err) {
        console.error('Visits count failed:', err);
    }
}

// Fetch and render PostgreSQL Transaction logs
async function fetchVisitsLog() {
    const logsBody = document.getElementById('db-logs-body');
    if (!logsBody) return;

    try {
        const response = await fetchAPI('/visits-log');
        if (!response.ok) throw new Error('Visits log failed');
        const data = await response.json();
        
        logsBody.replaceChildren();

        if (data.logs.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.setAttribute('colspan', '3');
            td.className = 'text-center text-secondary';
            td.textContent = 'No database logs found. Register a new visit to write transactions.';
            tr.appendChild(td);
            logsBody.appendChild(tr);
            return;
        }

        data.logs.forEach(log => {
            const tr = document.createElement('tr');
            
            const tdId = document.createElement('td');
            tdId.className = 'font-mono text-glow';
            tdId.textContent = `#${log.id}`;
            tr.appendChild(tdId);
            
            const tdTime = document.createElement('td');
            tdTime.textContent = new Date(log.visited_at).toLocaleString();
            tr.appendChild(tdTime);
            
            const tdHost = document.createElement('td');
            tdHost.className = 'font-mono text-glow';
            tdHost.textContent = log.hostname || 'unknown-pod';
            tr.appendChild(tdHost);
            
            logsBody.appendChild(tr);
        });

    } catch (err) {
        console.error('Visits log render failed:', err);
    }
}

// Register visit click handler
document.getElementById('btn-visit').addEventListener('click', async () => {
    const btn = document.getElementById('btn-visit');
    btn.disabled = true;
    btn.textContent = 'Registering...';
    
    try {
        const response = await fetchAPI('/visit');
        if (!response.ok) throw new Error('Registration failed');
        await fetchVisitsCount();
        await fetchVisitsLog();
    } catch (e) {
        console.error(e);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Register New Visit';
    }
});

// Reset visits click handler
document.getElementById('btn-reset-visits').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear visit history from PostgreSQL?')) return;
    
    try {
        const response = await fetchAPI('/reset-visits', { method: 'POST' });
        if (!response.ok) throw new Error('Reset failed');
        document.getElementById('visit-counter').textContent = '0';
        await fetchVisitsLog();
    } catch (err) {
        console.error('Reset visits failed:', err);
    }
});

// Canary Test Runner (Fires 100 requests & appends telemetry lines to the custom console)
document.getElementById('btn-run-canary').addEventListener('click', async () => {
    const btn = document.getElementById('btn-run-canary');
    const statusMsg = document.getElementById('canary-status');
    const barStable = document.getElementById('bar-stable');
    const barCanary = document.getElementById('bar-canary');
    const lblStable = document.getElementById('lbl-stable');
    const lblCanary = document.getElementById('lbl-canary');
    const consoleContainer = document.getElementById('request-console');

    btn.disabled = true;
    statusMsg.textContent = 'Executing load test (100 parallel requests)...';

    // Clear previous console logs
    consoleContainer.replaceChildren();
    const initLine = document.createElement('div');
    initLine.className = 'console-line system-line';
    initLine.textContent = `[SYSTEM] Generating load. Target router: http://app.local${API_BASE}/visit`;
    consoleContainer.appendChild(initLine);

    let stableCount = 0;
    let canaryCount = 0;
    let failedCount = 0;

    const requests = Array.from({ length: 100 }).map(async (_, idx) => {
        const start = performance.now();
        const rand = Math.random();
        try {
            const forceCanary = document.getElementById('chk-force-canary')?.checked;
            const options = {};
            if (forceCanary) {
                options.headers = { 'X-Canary': 'true' };
            }
            const response = await fetchAPI(`/visit?nocache=${rand}`, options);
            const latency = (performance.now() - start).toFixed(1);
            
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            const logLine = document.createElement('div');
            
            if (data.version === 'v2-canary') {
                canaryCount++;
                logLine.className = 'console-line canary-line';
                logLine.textContent = `[${new Date().toLocaleTimeString()}] [#${idx+1}] GET /api/visit - 200 OK (v2-canary, latency: ${latency}ms, pod: ${data.hostname})`;
            } else {
                stableCount++;
                logLine.className = 'console-line stable-line';
                logLine.textContent = `[${new Date().toLocaleTimeString()}] [#${idx+1}] GET /api/visit - 200 OK (v1-stable, latency: ${latency}ms, pod: ${data.hostname})`;
            }
            consoleContainer.appendChild(logLine);
        } catch (err) {
            failedCount++;
            const logLine = document.createElement('div');
            logLine.className = 'console-line error-line';
            logLine.textContent = `[${new Date().toLocaleTimeString()}] [#${idx+1}] GET /api/visit - FAILED (${err.message})`;
            consoleContainer.appendChild(logLine);
        }
        
        // Auto-scroll to bottom as elements append
        consoleContainer.scrollTop = consoleContainer.scrollHeight;
    });

    await Promise.all(requests);

    const totalSuccess = stableCount + canaryCount;
    if (totalSuccess === 0) {
        statusMsg.textContent = 'Error: 100% of routing requests failed.';
        btn.disabled = false;
        return;
    }

    const stablePercent = Math.round((stableCount / totalSuccess) * 100);
    const canaryPercent = Math.round((canaryCount / totalSuccess) * 100);

    // Update split progress bars
    barStable.style.width = `${stablePercent}%`;
    barCanary.style.width = `${canaryPercent}%`;
    lblStable.textContent = `${stablePercent}% (${stableCount})`;
    lblCanary.textContent = `${canaryPercent}% (${canaryCount})`;

    statusMsg.textContent = `Load test complete. Success: ${totalSuccess}, Failures: ${failedCount}.`;
    
    // Append summary line
    const summaryLine = document.createElement('div');
    summaryLine.className = 'console-line system-line';
    summaryLine.textContent = `[SYSTEM] Finished. Stable: ${stablePercent}%, Canary: ${canaryPercent}%, Failures: ${failedCount}.`;
    consoleContainer.appendChild(summaryLine);
    consoleContainer.scrollTop = consoleContainer.scrollHeight;

    btn.disabled = false;
    
    // Refresh stats
    fetchVisitsCount();
    fetchVisitsLog();
});

// Deploy Canary v2 click handler
document.getElementById('btn-deploy-canary').addEventListener('click', async () => {
    const consoleContainer = document.getElementById('request-console');
    const logLine = document.createElement('div');
    logLine.className = 'console-line system-line';
    logLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] Requesting deploy of v2-canary (20% traffic split)...`;
    consoleContainer.appendChild(logLine);
    consoleContainer.scrollTop = consoleContainer.scrollHeight;

    try {
        const response = await fetchAPI('/cluster/deploy-canary', { method: 'POST' });
        if (!response.ok) throw new Error('Deploy failed');
        const res = await response.json();
        
        const successLine = document.createElement('div');
        successLine.className = 'console-line success-line';
        successLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] SUCCESS: ${res.message}`;
        consoleContainer.appendChild(successLine);
        
        await fetchRolloutTelemetry();
        await fetchPodsTelemetry();
    } catch (err) {
        const errLine = document.createElement('div');
        errLine.className = 'console-line error-line';
        errLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] ERROR: Failed to deploy v2-canary (${err.message})`;
        consoleContainer.appendChild(errLine);
    }
    consoleContainer.scrollTop = consoleContainer.scrollHeight;
});

// Promote Canary to Stable click handler
document.getElementById('btn-promote-canary').addEventListener('click', async () => {
    const consoleContainer = document.getElementById('request-console');
    const logLine = document.createElement('div');
    logLine.className = 'console-line system-line';
    logLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] Requesting promotion of canary to 100% stable...`;
    consoleContainer.appendChild(logLine);
    consoleContainer.scrollTop = consoleContainer.scrollHeight;

    try {
        const response = await fetchAPI('/cluster/promote-canary', { method: 'POST' });
        if (!response.ok) throw new Error('Promotion failed');
        const res = await response.json();
        
        const successLine = document.createElement('div');
        successLine.className = 'console-line success-line';
        successLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] SUCCESS: ${res.message}`;
        consoleContainer.appendChild(successLine);
        
        await fetchRolloutTelemetry();
        await fetchPodsTelemetry();
    } catch (err) {
        const errLine = document.createElement('div');
        errLine.className = 'console-line error-line';
        errLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] ERROR: Failed to promote rollout (${err.message})`;
        consoleContainer.appendChild(errLine);
    }
    consoleContainer.scrollTop = consoleContainer.scrollHeight;
});

// Rollback to Stable v1 click handler
document.getElementById('btn-rollback-stable').addEventListener('click', async () => {
    const consoleContainer = document.getElementById('request-console');
    const logLine = document.createElement('div');
    logLine.className = 'console-line system-line';
    logLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] Requesting rollback to v1-stable (100% split)...`;
    consoleContainer.appendChild(logLine);
    consoleContainer.scrollTop = consoleContainer.scrollHeight;

    try {
        const response = await fetchAPI('/cluster/rollback-stable', { method: 'POST' });
        if (!response.ok) throw new Error('Rollback failed');
        const res = await response.json();
        
        const successLine = document.createElement('div');
        successLine.className = 'console-line success-line';
        successLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] SUCCESS: ${res.message}`;
        consoleContainer.appendChild(successLine);
        
        await fetchRolloutTelemetry();
        await fetchPodsTelemetry();
    } catch (err) {
        const errLine = document.createElement('div');
        errLine.className = 'console-line error-line';
        errLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] ERROR: Failed to rollback rollout (${err.message})`;
        consoleContainer.appendChild(errLine);
    }
    consoleContainer.scrollTop = consoleContainer.scrollHeight;
});

// Setup continuous telemetry updates
async function initTelemetry() {
    await fetchSystemStatus();
    await fetchPodsTelemetry();
    await fetchRolloutTelemetry();
    await fetchVisitsCount();
    await fetchVisitsLog();
    
    // Continuous polling: status, pods, and rollout every 4 seconds
    setInterval(fetchSystemStatus, 4000);
    setInterval(fetchPodsTelemetry, 4000);
    setInterval(fetchRolloutTelemetry, 4000);
}

// Auth UI Handlers: Login & Logout
const tokenInput = document.getElementById('api-token-input');
const saveTokenBtn = document.getElementById('btn-save-token');
const logoutBtn = document.getElementById('btn-logout');

if (saveTokenBtn && tokenInput) {
    saveTokenBtn.addEventListener('click', async () => {
        const key = tokenInput.value.trim();
        if (!key) return;
        
        saveTokenBtn.disabled = true;
        saveTokenBtn.textContent = 'Authenticating...';
        
        try {
            const response = await fetchAPI('/login', {
                method: 'POST',
                body: { key }
            });
            
            if (!response.ok) throw new Error('Unauthorized');
            
            saveTokenBtn.textContent = 'Authenticated!';
            saveTokenBtn.style.backgroundColor = 'var(--color-green)';
            tokenInput.value = '';
            
            setTimeout(() => {
                saveTokenBtn.textContent = 'Authenticate';
                saveTokenBtn.style.backgroundColor = 'var(--color-purple)';
                saveTokenBtn.disabled = false;
            }, 1500);

            // Immediate reload of telemetry
            await initTelemetry();
        } catch (err) {
            console.error(err);
            saveTokenBtn.textContent = 'Failed!';
            saveTokenBtn.style.backgroundColor = 'var(--color-red)';
            setTimeout(() => {
                saveTokenBtn.textContent = 'Authenticate';
                saveTokenBtn.style.backgroundColor = 'var(--color-purple)';
                saveTokenBtn.disabled = false;
            }, 1500);
        }
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        try {
            await fetchAPI('/logout', { method: 'POST' });
            updateActionButtonsState(false);
            window.location.reload();
        } catch (err) {
            console.error('Logout failed:', err);
        }
    });
}

// Switch Version Click Handler
const switchVersionBtn = document.getElementById('btn-switch-version');
const switchVersionInput = document.getElementById('switch-version-input');

if (switchVersionBtn && switchVersionInput) {
    switchVersionBtn.addEventListener('click', async () => {
        const version = switchVersionInput.value.trim();
        if (!version) return;
        
        switchVersionBtn.disabled = true;
        const consoleContainer = document.getElementById('request-console');
        const logLine = document.createElement('div');
        logLine.className = 'console-line system-line';
        logLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] Requesting switch of rollout version to "${version}"...`;
        consoleContainer.appendChild(logLine);
        consoleContainer.scrollTop = consoleContainer.scrollHeight;

        try {
            const response = await fetchAPI('/cluster/switch-version', {
                method: 'POST',
                body: { version }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const res = await response.json();
            
            const successLine = document.createElement('div');
            successLine.className = 'console-line success-line';
            successLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] SUCCESS: ${res.message}`;
            consoleContainer.appendChild(successLine);
            
            switchVersionInput.value = '';
            await fetchRolloutTelemetry();
            await fetchPodsTelemetry();
        } catch (err) {
            const errLine = document.createElement('div');
            errLine.className = 'console-line error-line';
            errLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] ERROR: Failed to switch rollout version (${err.message})`;
            consoleContainer.appendChild(errLine);
        } finally {
            switchVersionBtn.disabled = false;
            consoleContainer.scrollTop = consoleContainer.scrollHeight;
        }
    });
}

// Undo Rollback Click Handler
const rollbackBtn = document.getElementById('btn-rollback');
if (rollbackBtn) {
    rollbackBtn.addEventListener('click', async () => {
        const revisionStr = prompt('Enter target rollout revision number to undo to (leave blank for last revision):');
        const body = {};
        if (revisionStr && revisionStr.trim() !== '') {
            const revVal = parseInt(revisionStr.trim(), 10);
            if (isNaN(revVal) || revVal <= 0) {
                alert('Invalid revision number.');
                return;
            }
            body.revision = revVal;
        }

        rollbackBtn.disabled = true;
        const consoleContainer = document.getElementById('request-console');
        const logLine = document.createElement('div');
        logLine.className = 'console-line system-line';
        logLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] Requesting rollout undo rollback (to revision ${body.revision || 'last'})...`;
        consoleContainer.appendChild(logLine);
        consoleContainer.scrollTop = consoleContainer.scrollHeight;

        try {
            const response = await fetchAPI('/cluster/rollback', {
                method: 'POST',
                body: body
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const res = await response.json();
            
            const successLine = document.createElement('div');
            successLine.className = 'console-line success-line';
            successLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] SUCCESS: ${res.message}`;
            consoleContainer.appendChild(successLine);
            
            await fetchRolloutTelemetry();
            await fetchPodsTelemetry();
        } catch (err) {
            const errLine = document.createElement('div');
            errLine.className = 'console-line error-line';
            errLine.textContent = `[${new Date().toLocaleTimeString()}] [SYSTEM] ERROR: Failed to rollback rollout (${err.message})`;
            consoleContainer.appendChild(errLine);
        } finally {
            rollbackBtn.disabled = false;
            consoleContainer.scrollTop = consoleContainer.scrollHeight;
        }
    });
}

initTelemetry();
