const express = require('express');
const { Pool } = require('pg');
const os = require('os');
const https = require('https');
const fs = require('fs');

const app = express();
app.use(express.json());
const port = process.env.PORT || 5000;
const appVersion = process.env.APP_VERSION || 'v1-stable';

// Configure Kubernetes API access
let token = '';
let ca = '';
let namespace = 'staging';

try {
  if (fs.existsSync('/var/run/secrets/kubernetes.io/serviceaccount/token')) {
    token = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8').trim();
  }
  if (fs.existsSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt')) {
    ca = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt');
  }
  if (fs.existsSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace')) {
    namespace = fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/namespace', 'utf8').trim();
  }
} catch (err) {
  console.warn('Kubernetes API service account credentials not found:', err.message);
}

// Helper to format age
function formatAge(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

// Mock data fallbacks for local/non-cluster execution
function getMockPods() {
  return [
    { name: `backend-stable-mock-pod-${os.hostname()}`, status: 'Running', readyContainers: 2, totalContainers: 2, restarts: 0, hasSidecar: true, age: '15m' },
    { name: 'backend-canary-mock-pod-xyz12', status: 'Running', readyContainers: 2, totalContainers: 2, restarts: 1, hasSidecar: true, age: '4m' },
    { name: 'frontend-mock-pod-ab45c', status: 'Running', readyContainers: 2, totalContainers: 2, restarts: 0, hasSidecar: true, age: '22m' },
    { name: 'postgres-db-mock-pod-df88b', status: 'Running', readyContainers: 2, totalContainers: 2, restarts: 0, hasSidecar: true, age: '22m' }
  ];
}

function getMockRollout() {
  return {
    name: 'backend',
    status: 'Progressing',
    currentStepIndex: 1,
    stepsCount: 5,
    stableWeight: 90,
    canaryWeight: 10
  };
}

// Helper to parse owner and repo from Git URL
function getRepoDetails(gitRepoUrl) {
  let owner = 'ofird167';
  let repo = 'GKE-GitOps-Progressive-Delivery';
  if (gitRepoUrl) {
    try {
      const parts = gitRepoUrl.replace('.git', '').split('/');
      repo = parts[parts.length - 1];
      let o = parts[parts.length - 2];
      if (o.includes(':')) {
        o = o.split(':').pop();
      }
      if (o) owner = o;
    } catch (e) {
      console.warn('Failed to parse owner/repo from URL:', gitRepoUrl, e.message);
    }
  }
  return { owner, repo };
}

// GitHub API query helper to fetch latest CI/CD workflow run
function getLatestGitHubRun() {
  return new Promise((resolve) => {
    const gitPat = process.env.GIT_PAT;
    const gitRepoUrl = process.env.GIT_REPO_URL;
    
    if (!gitPat || !gitRepoUrl) {
      return resolve({ runNumber: 21, status: 'success' }); // Fallback to mock if not configured
    }
    
    const { owner, repo } = getRepoDetails(gitRepoUrl);
    
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: `/repos/${owner}/${repo}/actions/runs?per_page=1`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${gitPat}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Node.js-Operations-Control-Panel'
      },
      timeout: 3000
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            if (parsed.workflow_runs && parsed.workflow_runs.length > 0) {
              const run = parsed.workflow_runs[0];
              resolve({
                runNumber: run.run_number,
                status: run.conclusion || run.status
              });
            } else {
              resolve({ runNumber: null, status: 'No runs found' });
            }
          } catch (e) {
            resolve({ runNumber: 21, status: 'success', error: 'Failed to parse JSON' });
          }
        } else {
          resolve({ runNumber: 21, status: 'success', error: `HTTP ${res.statusCode}` });
        }
      });
    });
    
    req.on('error', (err) => {
      resolve({ runNumber: 21, status: 'success', error: err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ runNumber: 21, status: 'success', error: 'Timeout' });
    });
    req.end();
  });
}

// Kubernetes API query helper
function queryK8s(path) {
  return new Promise((resolve, reject) => {
    if (!token || !ca) {
      return reject(new Error('Kubernetes credentials missing'));
    }
    const host = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
    const port = process.env.KUBERNETES_SERVICE_PORT || '443';
    
    const options = {
      hostname: host,
      port: port,
      path: path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      ca: ca,
      timeout: 5000
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(`API status ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timed out'));
    });
    req.end();
  });
}

function patchK8s(path, body) {
  return new Promise((resolve, reject) => {
    if (!token || !ca) {
      return reject(new Error('Kubernetes credentials missing'));
    }
    const host = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
    const port = process.env.KUBERNETES_SERVICE_PORT || '443';
    
    const options = {
      hostname: host,
      port: port,
      path: path,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json-patch+json'
      },
      ca: ca,
      timeout: 5000
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(`API status ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Connection timed out'));
    });
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Helper to parse cookies manually without external dependency
function getCookie(req, name) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(c => {
    const parts = c.split('=');
    return [parts[0].trim(), parts.slice(1).join('=')];
  });
  const match = cookies.find(c => c[0] === name);
  return match ? decodeURIComponent(match[1]) : null;
}

// Middleware for CORS and request logging
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cookie');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PATCH, PUT, DELETE');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Authentication middleware using Secure Session Cookies
app.use((req, res, next) => {
  // Only authenticate state-changing/administrative POST requests.
  // Exclude public endpoints (GET) and /login endpoint.
  if (req.method !== 'POST' || req.path === '/login') {
    return next();
  }

  const expectedKey = process.env.BACKEND_API_KEY;
  if (!expectedKey) {
    return next(); // Bypass if API key is not configured (fallback mode)
  }

  const token = getCookie(req, 'ops-token');
  if (!token) {
    console.warn(`[UNAUTHORIZED] Blocked administrative request to ${req.path} (missing cookie)`);
    return res.status(401).json({ error: 'Unauthorized: Missing session cookie' });
  }

  if (token !== expectedKey) {
    console.warn(`[UNAUTHORIZED] Blocked administrative request to ${req.path} (invalid cookie)`);
    return res.status(401).json({ error: 'Unauthorized: Invalid session' });
  }

  next();
});

// Authentication Session Login
app.post('/login', (req, res) => {
  const expectedKey = process.env.BACKEND_API_KEY;
  const { key } = req.body || {};

  if (!expectedKey) {
    return res.json({ message: 'Authentication bypassed (fallback mode).' });
  }

  if (!key || key !== expectedKey) {
    console.warn(`[UNAUTHORIZED] Failed login attempt from ${req.ip}`);
    return res.status(401).json({ error: 'Unauthorized: Invalid credentials' });
  }

  // TODO(security): In production HTTPS, use __Host- prefix and Secure flag.
  // Since GKE Ingress serves HTTP on app.local, we set Secure flag dynamically.
  const isLocalhost = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
  const secureCookie = req.secure || isLocalhost;
  
  res.setHeader(
    'Set-Cookie',
    `ops-token=${encodeURIComponent(key)}; Path=/; HttpOnly; SameSite=Lax${secureCookie ? '; Secure' : ''}`
  );
  res.json({ message: 'Authentication successful.' });
});

// Authentication Session Logout
app.post('/logout', (req, res) => {
  res.setHeader(
    'Set-Cookie',
    'ops-token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
  );
  res.json({ message: 'Logged out successfully.' });
});

// Authentication Status Check
app.get('/cluster/auth-check', (req, res) => {
  const expectedKey = process.env.BACKEND_API_KEY;
  if (!expectedKey) {
    return res.json({ authenticated: true, bypass: true });
  }

  const token = getCookie(req, 'ops-token');
  if (token && token === expectedKey) {
    return res.json({ authenticated: true });
  }

  return res.status(401).json({ authenticated: false });
});

// Configure PostgreSQL pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'dbadmin',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'app_db',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  connectionTimeoutMillis: 5000,
});

// Helper to initialize table
async function initDb() {
  let retries = 5;
  while (retries > 0) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS visits (
          id SERIAL PRIMARY KEY,
          visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          hostname VARCHAR(255)
        );
      `);
      await pool.query(`
        ALTER TABLE visits ADD COLUMN IF NOT EXISTS hostname VARCHAR(255);
      `);
      console.log('Database visits table initialized successfully.');
      break;
    } catch (err) {
      console.error(`Database initialization failed. Retries remaining: ${retries - 1}`, err.message);
      retries -= 1;
      await new Promise(res => setTimeout(res, 3000));
    }
  }
}

if (require.main === module) {
  initDb();
}

// 1. Healthcheck Endpoint
app.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT 1');
    if (result.rows.length > 0) {
      res.json({ status: 'healthy', database: 'connected' });
    } else {
      res.status(500).json({ status: 'unhealthy', database: 'unexpected response' });
    }
  } catch (err) {
    console.error('Healthcheck DB Error:', err.message);
    res.status(500).json({ status: 'unhealthy', database: 'disconnected', error: 'Internal Database Connection Error' });
  }
});

// 2. Status Endpoint
app.get('/status', async (req, res) => {
  let dbStatus = 'disconnected';
  try {
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch (err) {
    console.error('Status DB check failed:', err.message);
  }

  const isDbPasswordSet = !!process.env.DB_PASSWORD;
  const githubBuild = await getLatestGitHubRun();

  const gitRepoUrl = process.env.GIT_REPO_URL;
  const { repo: repoName } = getRepoDetails(gitRepoUrl);

  res.json({
    hostname: os.hostname(),
    version: appVersion,
    repoName,
    environment: {
      CONFIG_MAP_VAL: process.env.CONFIG_MAP_VAL || 'Default Config Value',
      INGRESS_IP: process.env.INGRESS_IP || '',
      SECRET_DB_PASSWORD_SET: isDbPasswordSet
    },
    githubBuild,
    database: {
      host: process.env.DB_HOST || 'localhost',
      name: process.env.DB_NAME || 'app_db',
      user: process.env.DB_USER || 'dbadmin',
      status: dbStatus
    }
  });
});

// 3. Cluster Pods Endpoint
app.get('/cluster/pods', async (req, res) => {
  try {
    const data = await queryK8s(`/api/v1/namespaces/${namespace}/pods`);
    const pods = data.items.map(pod => {
      const containerStatuses = pod.status.containerStatuses || [];
      const initContainerStatuses = pod.status.initContainerStatuses || [];
      
      const hasSidecar = initContainerStatuses.some(c => c.name === 'istio-proxy');
      const sidecarInitCount = initContainerStatuses.filter(c => c.name === 'istio-proxy').length;
      
      const totalCount = containerStatuses.length + sidecarInitCount;
      const readySidecarCount = initContainerStatuses.filter(c => c.name === 'istio-proxy' && c.ready).length;
      const readyCount = containerStatuses.filter(c => c.ready).length + readySidecarCount;
      
      const restarts = [...containerStatuses, ...initContainerStatuses].reduce((acc, c) => acc + c.restartCount, 0);

      return {
        name: pod.metadata.name,
        status: pod.status.phase,
        readyContainers: readyCount,
        totalContainers: totalCount,
        restarts: restarts,
        hasSidecar: hasSidecar,
        age: pod.status.startTime ? formatAge(new Date() - new Date(pod.status.startTime)) : '-'
      };
    });
    res.json({ pods, namespace });
  } catch (err) {
    res.json({ pods: getMockPods(), namespace, isMock: true });
  }
});

// 4. Cluster Rollout Endpoint
app.get('/cluster/rollout', async (req, res) => {
  try {
    const rollout = await queryK8s(`/apis/argoproj.io/v1alpha1/namespaces/${namespace}/rollouts/backend`);
    const steps = rollout.spec.strategy?.canary?.steps || [];
    const canaryWeights = rollout.status.canary?.weights;
    res.json({
      name: 'backend',
      status: rollout.status.phase || 'Unknown',
      currentStepIndex: rollout.status.currentStepIndex || 0,
      stepsCount: steps.length,
      stableWeight: canaryWeights?.stable?.weight ?? 100,
      canaryWeight: canaryWeights?.canary?.weight ?? 0
    });
  } catch (err) {
    res.json(getMockRollout());
  }
});

// 5. Visit Tracker
app.get('/visit', async (req, res) => {
  try {
    const hostname = os.hostname();
    await pool.query('INSERT INTO visits (hostname) VALUES ($1)', [hostname]);
    const result = await pool.query('SELECT COUNT(*) FROM visits');
    const count = result.rows[0].count;
    res.json({ count: parseInt(count, 10), version: appVersion, hostname: os.hostname() });
  } catch (err) {
    console.error('Database query error on /visit:', err.message);
    res.status(500).json({ error: 'Failed to record visit in the database' });
  }
});

// 6. Detailed Visits Log
app.get('/visits-log', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, visited_at, hostname FROM visits ORDER BY id DESC LIMIT 15');
    res.json({ logs: result.rows });
  } catch (err) {
    console.error('Database query error on /visits-log:', err.message);
    res.status(500).json({ error: 'Failed to fetch visits log' });
  }
});

// 7. Reset visits
app.post('/reset-visits', async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE visits');
    res.json({ message: 'Visit logs reset successfully.' });
  } catch (err) {
    console.error('Database query error on /reset-visits:', err.message);
    res.status(500).json({ error: 'Failed to reset visits' });
  }
});

// 8. Deploy Canary v2
app.post('/cluster/deploy-canary', async (req, res) => {
  try {
    const patchBody = [
      {
        op: 'replace',
        path: '/spec/template/spec/containers/0/env/0/value',
        value: 'v2-canary'
      }
    ];
    await patchK8s(`/apis/argoproj.io/v1alpha1/namespaces/${namespace}/rollouts/backend`, patchBody);
    res.json({ message: 'Canary v2 deployed successfully.' });
  } catch (err) {
    console.error('Failed to deploy canary v2:', err.message);
    res.status(500).json({ error: 'Failed to deploy canary v2', details: err.message });
  }
});

// 9. Rollback to Stable v1
app.post('/cluster/rollback-stable', async (req, res) => {
  try {
    const patchBody = [
      {
        op: 'replace',
        path: '/spec/template/spec/containers/0/env/0/value',
        value: 'v1-stable'
      }
    ];
    await patchK8s(`/apis/argoproj.io/v1alpha1/namespaces/${namespace}/rollouts/backend`, patchBody);
    res.json({ message: 'Rollback to v1 stable initiated successfully.' });
  } catch (err) {
    console.error('Failed to rollback rollout:', err.message);
    res.status(500).json({ error: 'Failed to rollback rollout', details: err.message });
  }
});

// 10. Promote Canary to Stable 100
app.post('/cluster/promote-canary', async (req, res) => {
  const { exec } = require('child_process');
  const cliPath = fs.existsSync('/app/kubectl-argo-rollouts') ? '/app/kubectl-argo-rollouts' : './kubectl-argo-rollouts-linux-amd64';
  
  exec(`${cliPath} promote backend -n ${namespace} --full`, (err, stdout, stderr) => {
    if (err) {
      console.error('Failed to promote rollout:', stderr || err.message);
      return res.status(500).json({ error: 'Failed to promote rollout', details: stderr || err.message });
    }
    res.json({ message: 'Rollout promoted to 100% stable successfully.', output: stdout });
  });
});

// 11. Rollback Rollout (Argo Rollouts Undo)
app.post('/cluster/rollback', async (req, res) => {
  const { exec } = require('child_process');
  const cliPath = fs.existsSync('/app/kubectl-argo-rollouts') ? '/app/kubectl-argo-rollouts' : './kubectl-argo-rollouts-linux-amd64';
  
  let cmd = `${cliPath} undo backend -n ${namespace}`;
  if (req.body && req.body.revision) {
    const revision = parseInt(req.body.revision, 10);
    if (!isNaN(revision) && revision > 0) {
      cmd += ` --to-revision=${revision}`;
    } else {
      return res.status(400).json({ error: 'Invalid revision number' });
    }
  }

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('Failed to rollback rollout:', stderr || err.message);
      return res.status(500).json({ error: 'Failed to rollback rollout', details: stderr || err.message });
    }
    res.json({ message: 'Rollout rollback (undo) initiated successfully.', output: stdout });
  });
});

// 12. Switch version / APP_VERSION environment variable
app.post('/cluster/switch-version', async (req, res) => {
  try {
    const version = req.body && req.body.version;
    if (!version) {
      return res.status(400).json({ error: 'Missing version parameter in request body' });
    }
    
    // Validate version string (alphanumeric and hyphens/dots only)
    if (!/^[a-zA-Z0-9.-]+$/.test(version)) {
      return res.status(400).json({ error: 'Invalid version string format' });
    }

    const patchBody = [
      {
        op: 'replace',
        path: '/spec/template/spec/containers/0/env/0/value',
        value: version
      }
    ];
    await patchK8s(`/apis/argoproj.io/v1alpha1/namespaces/${namespace}/rollouts/backend`, patchBody);
    res.json({ message: `Rollout version switch to ${version} initiated successfully.` });
  } catch (err) {
    console.error('Failed to switch rollout version:', err.message);
    res.status(500).json({ error: 'Failed to switch rollout version', details: err.message });
  }
});

// Fallback route: redirect unmatched paths to the root page (frontend)
app.use((req, res) => {
  res.redirect('/');
});

if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend API version ${appVersion} listening on port ${port}`);
  });
}

module.exports = { formatAge };
