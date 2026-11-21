// Ship code to GitHub from an agent task (the Janitor / Auditor idea): Codestral writes the
// files, the agent opens a pull request for review, and merging ("deploy") is a Raise Hand
// step the host approves. Guard rails:
//  - files only go under agent-builds/ (agents can't touch the app's own code),
//  - only branches Atelier created (atelier/...) can be merged,
//  - the token decides which repos are reachable (GITHUB_TOKEN, fine-grained, repo-scoped).
import { chat } from './mistral.js';

const TOKEN = process.env.GITHUB_TOKEN || '';
export const GITHUB_ON = !!TOKEN;
export const DEFAULT_REPO = process.env.GITHUB_REPO || 'belulok/atelier';
const CODE_MODEL = process.env.MISTRAL_CODE_MODEL || 'codestral-latest';
const ROOT = 'agent-builds';

async function gh(method, path, body) {
  const res = await fetch('https://api.github.com' + path, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'atelier-agent', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]} ${res.status}: ${data.message || 'error'}`);
  return data;
}

// "https://github.com/owner/repo(.git)", "github.com/owner/repo" or "owner/repo"
export function parseRepo(input) {
  const m = String(input || DEFAULT_REPO).trim().match(/(?:github\.com[/:])?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/);
  if (!m) throw new Error(`Not a GitHub repo: "${input}"`);
  return `${m[1]}/${m[2]}`;
}
const slug = (s) => String(s || 'build').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'build';
// Keep every file inside agent-builds/<slug>/ whatever path the model asks for.
function safePath(dir, p) {
  const clean = String(p || 'index.html').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.' && x !== '..').join('/');
  const rel = clean.replace(new RegExp(`^${ROOT}/`), '').replace(new RegExp(`^${dir}/`), '');
  return `${ROOT}/${dir}/${rel || 'index.html'}`;
}

async function writeFile(spec, what) {
  const msg = await chat({ model: CODE_MODEL, messages: [
    { role: 'system', content: 'You write complete, working source files. Reply with the file contents only: no explanations, no markdown fences.' },
    { role: 'user', content: `Project: ${what}\nFile: ${spec.path}\nWhat this file does: ${spec.what_it_does || spec.description || what}\nKeep it small, self-contained and readable. No secrets or API keys: read them from environment variables or leave a clear TODO for IT.` },
  ] });
  return String(msg.content || '').replace(/^```[\w-]*\n?/, '').replace(/\n?```\s*$/, '');
}

// Branch → Codestral writes each file → commit → pull request. `log` gets terminal lines.
export async function openPullRequest({ repo, title, description, files }, log = () => {}) {
  if (!GITHUB_ON) throw new Error('GitHub is not connected (no GITHUB_TOKEN on the server).');
  const full = parseRepo(repo);
  const info = await gh('GET', `/repos/${full}`);
  const base = info.default_branch;
  const dir = slug(title);
  const branch = `atelier/${dir}-${Date.now().toString(36).slice(-4)}`;
  log('cmd', `$ git clone https://github.com/${full} && cd ${full.split('/')[1]}`);
  const ref = await gh('GET', `/repos/${full}/git/ref/heads/${base}`);
  await gh('POST', `/repos/${full}/git/refs`, { ref: `refs/heads/${branch}`, sha: ref.object.sha });
  log('cmd', `$ git checkout -b ${branch}`);
  const list = (Array.isArray(files) && files.length ? files : [{ path: 'index.html', what_it_does: description }]).slice(0, 4);
  const written = [];
  for (const f of list) {
    const path = safePath(dir, f.path);
    const content = await writeFile({ ...f, path }, `${title}. ${description || ''}`);
    log('out', `  codestral wrote ${path} (${(Buffer.byteLength(content) / 1024).toFixed(1)} KB)`);
    await gh('PUT', `/repos/${full}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      message: `${title}: add ${path.split('/').pop()}`, content: Buffer.from(content).toString('base64'), branch,
    });
    written.push(path);
  }
  log('cmd', `$ git commit -m "${title.replace(/"/g, "'")}" && git push origin ${branch}`);
  const pr = await gh('POST', `/repos/${full}/pulls`, {
    title: `[Atelier] ${title}`, head: branch, base,
    body: `${description || title}\n\nOpened by an Atelier agent. Files:\n${written.map((p) => `- \`${p}\``).join('\n')}\n\nMerging happens only after the host approves it in Atelier.`,
  });
  log('done', `  ✓ pull request #${pr.number} opened: ${pr.html_url}`);
  return { ok: true, repo: full, pr_number: pr.number, pr_url: pr.html_url, branch, base, files: written };
}

// Merge (deploy) an Atelier pull request. Called only from an approved 'deploy' approval.
export async function mergePullRequest({ repo, pr_number }) {
  if (!GITHUB_ON) throw new Error('GitHub is not connected.');
  const full = parseRepo(repo);
  const pr = await gh('GET', `/repos/${full}/pulls/${Number(pr_number)}`);
  if (!pr.head?.ref?.startsWith('atelier/')) throw new Error(`PR #${pr_number} was not opened by Atelier, so it can't be merged from here.`);
  if (pr.merged) return { merged: true, sha: pr.merge_commit_sha, url: pr.html_url, already: true };
  const r = await gh('PUT', `/repos/${full}/pulls/${pr.number}/merge`, { merge_method: 'squash', commit_title: pr.title });
  return { merged: !!r.merged, sha: r.sha, url: pr.html_url };
}

export async function pullRequestStatus({ repo, pr_number }) {
  const pr = await gh('GET', `/repos/${parseRepo(repo)}/pulls/${Number(pr_number)}`);
  return { pr_number: pr.number, state: pr.state, merged: pr.merged, url: pr.html_url, merge_commit_sha: pr.merge_commit_sha };
}

// What happened to a pull request on GitHub itself: merged, closed, or approved in a review.
// Polled every 2 s while a deploy step waits (two API calls; well inside GitHub's rate limit).
export async function watchPullRequest({ repo, pr_number }) {
  const full = parseRepo(repo);
  const n = Number(pr_number);
  const pr = await gh('GET', `/repos/${full}/pulls/${n}`);
  let approvedBy = null;
  if (!pr.merged && pr.state === 'open') {
    const latest = {}; // each reviewer's latest review decides
    for (const r of await gh('GET', `/repos/${full}/pulls/${n}/reviews?per_page=100`)) if (r.user?.login) latest[r.user.login] = r.state;
    approvedBy = Object.keys(latest).find((u) => latest[u] === 'APPROVED') || null;
  }
  return { merged: !!pr.merged, state: pr.state, merged_by: pr.merged_by?.login || null, sha: pr.merge_commit_sha, url: pr.html_url, approvedBy };
}

export const GITHUB_TOOLS = [
  { type: 'function', function: { name: 'github_open_pr', description: `Ship code: Codestral writes the files, then a branch and a pull request are opened on GitHub for review (no approval needed to open it). Files go under ${ROOT}/. Default repo: ${DEFAULT_REPO}. Merging it is a separate step that needs the host's approval (request_approval type "deploy").`,
    parameters: { type: 'object', properties: {
      repo: { type: 'string', description: 'GitHub repo URL or owner/name (use the one the host gave)' },
      title: { type: 'string', description: 'Short title of the change' },
      description: { type: 'string', description: 'What it is and why, 1-3 sentences' },
      files: { type: 'array', description: '1-4 files to create', items: { type: 'object', properties: { path: { type: 'string', description: 'e.g. index.html or src/payment.js' }, what_it_does: { type: 'string' } }, required: ['path', 'what_it_does'] } },
    }, required: ['title', 'description', 'files'] } } },
  { type: 'function', function: { name: 'github_pr_status', description: 'Check a pull request: open, merged or closed.',
    parameters: { type: 'object', properties: { repo: { type: 'string' }, pr_number: { type: 'number' } }, required: ['pr_number'] } } },
];
