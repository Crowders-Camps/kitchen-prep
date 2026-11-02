/**
 * Kitchen Prep Builder: save relay.
 *
 * The prep site is a static page, so it can't hold a GitHub key safely.
 * This small Cloudflare Worker holds the key and does the saving: every
 * "Push live" becomes a commit to data/live.json on the `live-data` branch
 * of your repo. The branch keeps the full history of every version.
 *
 * Settings (Cloudflare dashboard → your worker → Settings → Variables):
 *   GITHUB_TOKEN   (Secret)  fine-grained token: this repo only, Contents read & write
 *   REPO           Crowders-Camps/kitchen-prep
 *   BRANCH         live-data          (kept separate so saves don't rebuild the website)
 *   DATA_PATH      data/live.json
 *   ALLOWED_ORIGIN https://crowders-camps.github.io   (comma-separate several; add your own domain later)
 */

const MAX_BODY = 900 * 1024;          // GitHub's contents API tops out near 1 MB
const WRITES_PER_MINUTE = 20;          // per visitor, best effort
const recent = new Map();

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    const okOrigin = !allowed.length || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin && origin ? origin : (allowed[0] || '*'),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    // Guest menu: a trimmed copy of the live version, readable from any site, cached for a minute.
    if (request.method === 'GET' && new URL(request.url).pathname === '/public') {
      const cache = caches.default;
      const key = new Request(new URL('/public', request.url).toString());
      let res = await cache.match(key);
      if (!res) {
        try {
          const cur = await github(env).read(env.BRANCH);
          res = new Response(JSON.stringify(cur ? publicMenu(cur.doc) : {}), {
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' }
          });
          await cache.put(key, res.clone());
        } catch (e) {
          return new Response(JSON.stringify({ error: 'upstream' }), { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
        }
      }
      res = new Response(res.body, res);
      res.headers.set('Access-Control-Allow-Origin', '*');
      return res;
    }
    // Reading is open (the live version is public anyway); saving only from your site.
    if (!okOrigin && (origin || request.method !== 'GET')) return json({ error: 'origin_not_allowed' }, 403);

    const gh = github(env);
    const url = new URL(request.url);
    try {
      if (request.method === 'GET' && url.pathname === '/live') {
        const cur = await gh.read(env.BRANCH);
        return json(cur ? cur.doc : {});
      }
      if (request.method === 'GET' && url.pathname === '/history') {
        return json({ versions: await gh.history() });
      }
      if (request.method === 'GET' && url.pathname === '/version') {
        const sha = url.searchParams.get('sha') || '';
        if (!/^[0-9a-f]{7,40}$/i.test(sha)) return json({ error: 'bad_request' }, 400);
        const cur = await gh.read(sha);
        return json(cur ? cur.doc : {});
      }
      if (request.method === 'POST' && url.pathname === '/live') {
        const ip = request.headers.get('CF-Connecting-IP') || 'anon';
        if (!rateOk(ip)) return json({ error: 'busy' }, 429);
        const text = await request.text();
        if (text.length > MAX_BODY) return json({ error: 'too_large' }, 413);
        let body;
        try { body = JSON.parse(text); } catch (e) { return json({ error: 'bad_request' }, 400); }
        if (!body || typeof body.state !== 'object' || Array.isArray(body.state)) return json({ error: 'bad_request' }, 400);

        await gh.ensureBranch();
        const cur = await gh.read(env.BRANCH);
        const curV = (cur && cur.doc && cur.doc.v) || 0;
        if (curV !== Number(body.base || 0) && !body.force) {
          return json({ error: 'conflict', live: cur ? cur.doc : null });
        }
        const by = String(body.by || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 60);
        const doc = { v: curV + 1, at: new Date().toISOString(), by, state: body.state };
        const message = 'v' + doc.v + ': ' + (by || 'Someone') + ' pushed live';
        const res = await gh.write(doc, cur ? cur.sha : null, message);
        if (res === 'conflict') {
          const now = await gh.read(env.BRANCH);
          return json({ error: 'conflict', live: now ? now.doc : null });
        }
        return json({ ok: true, v: doc.v, at: doc.at, by });
      }
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: 'upstream', detail: String(e && e.message || e).slice(0, 200) }, 502);
    }
  }
};

// Only what guests see: items, allergens, diet tags, meal times. No kitchen notes or case counts.
function publicMenu(doc) {
  const st = doc.state || {};
  const used = new Set();
  const menus = {};
  Object.keys(st.menus || {}).forEach(k => {
    const lines = (st.menus[k] || []).map(l => ({ ref: l.ref ?? null, name: l.name || '', gf: !!l.gf }));
    if (lines.length) { menus[k] = lines; lines.forEach(l => { if (l.ref != null) used.add(l.ref); }); }
  });
  const catalog = (st.catalog || []).filter(it => used.has(it.id))
    .map(it => ({ id: it.id, name: it.name, al: it.al || [], veg: !!it.veg, vegan: !!it.vegan }));
  const mt = {};
  Object.keys(st.mt || {}).forEach(k => {
    const o = {}; Object.keys(st.mt[k] || {}).forEach(c => { if (st.mt[k][c] && st.mt[k][c].time) o[c] = { time: st.mt[k][c].time }; });
    mt[k] = o;
  });
  return { v: doc.v, at: doc.at, state: { week: st.week, menus, serve: st.serve || {}, off: st.off || {}, mt, catalog } };
}

function rateOk(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter(t => now - t < 60000);
  if (list.length >= WRITES_PER_MINUTE) { recent.set(ip, list); return false; }
  list.push(now); recent.set(ip, list);
  if (recent.size > 5000) recent.clear();
  return true;
}

function github(env) {
  const api = 'https://api.github.com/repos/' + env.REPO;
  const path = env.DATA_PATH || 'data/live.json';
  const branch = env.BRANCH || 'live-data';
  const headers = {
    'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'kitchen-prep-relay'
  };
  const call = async (method, p, body) => {
    const r = await fetch(api + p, { method, headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers, body: body ? JSON.stringify(body) : undefined });
    return r;
  };
  const encPath = path.split('/').map(encodeURIComponent).join('/');

  return {
    async read(ref) {
      const r = await call('GET', '/contents/' + encPath + '?ref=' + encodeURIComponent(ref || branch));
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('GitHub read ' + r.status);
      const j = await r.json();
      let text;
      if (j.content && j.encoding === 'base64') text = fromB64(j.content);
      else {
        // files over 1 MB come back without inline content
        const raw = await fetch(api + '/contents/' + encPath + '?ref=' + encodeURIComponent(ref || branch), { headers: { ...headers, 'Accept': 'application/vnd.github.raw+json' } });
        if (!raw.ok) throw new Error('GitHub raw read ' + raw.status);
        text = await raw.text();
      }
      return { sha: j.sha, doc: JSON.parse(text) };
    },
    async write(doc, sha, message) {
      const body = { message, content: toB64(JSON.stringify(doc)), branch };
      if (sha) body.sha = sha;
      const r = await call('PUT', '/contents/' + encPath, body);
      if (r.status === 409 || r.status === 422) return 'conflict';
      if (!r.ok) throw new Error('GitHub write ' + r.status);
      return 'ok';
    },
    async ensureBranch() {
      const r = await call('GET', '/git/ref/heads/' + encodeURIComponent(branch));
      if (r.ok) return;
      if (r.status !== 404) throw new Error('GitHub branch check ' + r.status);
      const repo = await call('GET', '');
      if (!repo.ok) throw new Error('GitHub repo ' + repo.status);
      const def = (await repo.json()).default_branch || 'main';
      const head = await call('GET', '/git/ref/heads/' + encodeURIComponent(def));
      if (!head.ok) throw new Error('GitHub default branch ' + head.status);
      const sha = (await head.json()).object.sha;
      const mk = await call('POST', '/git/refs', { ref: 'refs/heads/' + branch, sha });
      if (!mk.ok && mk.status !== 422) throw new Error('GitHub create branch ' + mk.status);
    },
    async history() {
      const r = await call('GET', '/commits?sha=' + encodeURIComponent(branch) + '&path=' + encodeURIComponent(path) + '&per_page=40');
      if (r.status === 404 || r.status === 409) return [];
      if (!r.ok) throw new Error('GitHub history ' + r.status);
      const list = await r.json();
      return list.map(c => {
        const msg = (c.commit && c.commit.message) || '';
        const m = msg.match(/^v(\d+):\s*(.*?)\s+pushed live/);
        return { sha: c.sha, v: m ? Number(m[1]) : null, by: m ? (m[2] === 'Someone' ? '' : m[2]) : '', at: c.commit && c.commit.committer && c.commit.committer.date, message: msg };
      });
    }
  };
}

function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
