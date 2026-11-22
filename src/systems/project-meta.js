import pkg from '../../package.json' with { type: 'json' };

const FALLBACK_REPO = 'https://github.com/fomalhaut1998/taohuayuan';

function normalizeRepoUrl(repo) {
  const raw = typeof repo === 'string' ? repo : repo?.url;
  const cleaned = String(raw || FALLBACK_REPO)
    .trim()
    .replace(/^git\+/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  return cleaned || FALLBACK_REPO;
}

function extractRepoSlug(repoUrl) {
  try {
    const slug = new URL(repoUrl).pathname.replace(/^\/+|\/+$/g, '');
    return slug || 'fomalhaut1998/taohuayuan';
  } catch {
    return 'fomalhaut1998/taohuayuan';
  }
}

const version = String(pkg?.version || '1.0.0').trim();
const repoUrl = normalizeRepoUrl(pkg?.repository);
const repoSlug = extractRepoSlug(repoUrl);
const license = String(pkg?.license || 'MIT').trim();

/**
 * 项目版本与开源仓库元信息（Node 测试直读 package.json；Vite 开发/构建由 vite.config.js 注入精简投影）。
 */
export const PROJECT_META = Object.freeze({
  version,
  versionLabel: `v${version}`,
  repoUrl,
  repoSlug,
  releasesUrl: `${repoUrl}/releases`,
  license,
  licenseUrl: `${repoUrl}/blob/main/LICENSE`
});
