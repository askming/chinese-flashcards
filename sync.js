"use strict";

/* ============================================================
 * Family sync: learner profiles stored as JSON files in a private GitHub repo.
 *
 *   <owner>/<repo>/profiles/<id>.json   — one file per profile
 *
 * The browser talks to the GitHub REST API directly with a fine-grained personal
 * access token limited to that one repo (Contents: Read & write). The token is kept
 * in this device's localStorage only.
 * ============================================================ */

const Sync = (() => {
  const CONF_KEY = "hanzi-flashcards-sync-v1";      // {owner, repo, token}
  const API = "https://api.github.com";
  const DIR = "profiles";
  const shas = {};                                  // file path → last known blob sha

  let conf = null;
  try { conf = JSON.parse(localStorage.getItem(CONF_KEY)); } catch { conf = null; }

  // UTF-8 safe base64 (profile names and progress keys are Chinese)
  const encode = (obj) => {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const decode = (b64) => {
    const bin = atob(b64.replace(/\s/g, ""));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  };

  class SyncError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function gh(path, opts = {}, c = conf) {
    let res;
    try {
      // no trailing slash: GitHub redirects those, and browsers won't follow a redirect on an authorized CORS request
      res = await fetch(`${API}/repos/${c.owner}/${c.repo}${path ? "/" + path : ""}`, {
        cache: "no-store",
        ...opts,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${c.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(opts.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new SyncError("Offline — will sync when you're back online", 0);
    }
    if (res.status === 401) throw new SyncError("The token was rejected (expired or revoked?)", 401);
    if (res.status === 403) throw new SyncError("The token isn't allowed to write to this repo", 403);
    return res;
  }

  const fileOf = (id) => `${DIR}/${id}.json`;

  return {
    SyncError,
    get connected() { return !!conf?.token; },
    get repoName() { return conf ? `${conf.owner}/${conf.repo}` : ""; },
    get config() { return conf; },

    /** Check a repo + token pair and remember it. */
    async connect(repoFull, token) {
      const [owner, repo] = repoFull.trim().split("/");
      if (!owner || !repo || !token.trim()) throw new SyncError("Enter the repo as owner/name, and a token", 0);
      const c = { owner, repo, token: token.trim() };
      const res = await gh("", {}, c);
      if (res.status === 404) throw new SyncError("Repo not found — check the name, and that the token can access it", 404);
      if (!res.ok) throw new SyncError(`GitHub error ${res.status}`, res.status);
      conf = c;
      localStorage.setItem(CONF_KEY, JSON.stringify(conf));
    },

    disconnect() {
      conf = null;
      localStorage.removeItem(CONF_KEY);
      for (const k of Object.keys(shas)) delete shas[k];
    },

    /** All profiles stored in the repo. */
    async list() {
      const res = await gh(`contents/${DIR}`);
      if (res.status === 404) return [];              // no profiles yet
      if (!res.ok) throw new SyncError(`GitHub error ${res.status}`, res.status);
      const files = (await res.json()).filter((f) => f.type === "file" && f.name.endsWith(".json"));
      const out = [];
      for (const f of files) {
        const p = await this.get(f.name.replace(/\.json$/, ""));
        if (p) out.push(p);
      }
      return out;
    },

    async get(id) {
      const res = await gh(`contents/${fileOf(id)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new SyncError(`GitHub error ${res.status}`, res.status);
      const j = await res.json();
      shas[fileOf(id)] = j.sha;
      return decode(j.content);
    },

    /** Write a profile. Returns "ok", or "conflict" if the file changed elsewhere since we read it. */
    async put(profile) {
      const path = fileOf(profile.id);
      const res = await gh(`contents/${path}`, {
        method: "PUT",
        body: JSON.stringify({
          message: `${profile.name}: update progress`,
          content: encode(profile),
          ...(shas[path] ? { sha: shas[path] } : {}),
        }),
      });
      if (res.status === 409 || res.status === 422) return "conflict";
      if (!res.ok) throw new SyncError(`GitHub error ${res.status}`, res.status);
      shas[path] = (await res.json()).content.sha;
      return "ok";
    },

    async remove(id) {
      const path = fileOf(id);
      if (!shas[path] && !(await this.get(id))) return;   // already gone
      const res = await gh(`contents/${path}`, {
        method: "DELETE",
        body: JSON.stringify({ message: `Delete profile ${id}`, sha: shas[path] }),
      });
      if (!res.ok && res.status !== 404) throw new SyncError(`GitHub error ${res.status}`, res.status);
      delete shas[path];
    },

    /** A link that connects another device (contains the token — share privately). */
    setupLink() {
      const payload = btoa(JSON.stringify(conf));
      return `${location.origin}${location.pathname}#connect=${encodeURIComponent(payload)}`;
    },

    /** If the page was opened with a setup link, return its config and clean the URL. */
    takeSetupLink() {
      const m = location.hash.match(/^#connect=(.+)$/);
      if (!m) return null;
      history.replaceState(null, "", location.pathname + location.search);
      try {
        const c = JSON.parse(atob(decodeURIComponent(m[1])));
        return c?.owner && c?.repo && c?.token ? c : null;
      } catch { return null; }
    },
  };
})();
