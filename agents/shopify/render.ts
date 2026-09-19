import type { BrandProfile, Offer, ProductCandidate, Storefront, StorefrontPage } from '../../core/types/index.ts';

/**
 * Renders the storefront into a real, openable site.
 *
 * The pages are the ones the storefront agent wrote; this turns them into HTML
 * carrying the brand's own palette and typefaces, so what the operator opens is
 * the shop as it would look rather than a description of it.
 *
 * Two rules hold throughout. A page the storefront flagged for legal or factual
 * review is rendered with its flags visible at the top of the page, because a
 * placeholder privacy policy that looks finished is worse than no page at all.
 * And no figure is introduced here that the storefront did not already carry:
 * this is a renderer, not another author.
 */

export interface RenderedFile {
  path: string;
  content: string;
}

const FALLBACK = {
  ink: '#14181c',
  paper: '#fbfaf7',
  muted: '#6b7580',
  line: '#e4e0d8',
  accent: '#2f6f62',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** A deliberately small Markdown subset: what the storefront agent writes. */
function markdown(src: string): string {
  const lines = src.split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = (): void => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1]?.length ?? 1;
      out.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return out.join('\n');
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
}

function palette(brand: BrandProfile | null): typeof FALLBACK {
  if (!brand || brand.palette.length === 0) return FALLBACK;
  const find = (re: RegExp): string | null => brand.palette.find((p) => re.test(p.use) || re.test(p.name))?.hex ?? null;
  return {
    ink: find(/text|ink|dark|foreground/i) ?? FALLBACK.ink,
    paper: find(/background|paper|base|ground/i) ?? FALLBACK.paper,
    muted: find(/muted|secondary|support/i) ?? FALLBACK.muted,
    line: find(/line|border|rule/i) ?? FALLBACK.line,
    accent: find(/accent|primary|brand|highlight/i) ?? brand.palette[0]?.hex ?? FALLBACK.accent,
  };
}

function stylesheet(brand: BrandProfile | null): string {
  const c = palette(brand);
  const display = brand?.typography.display ?? 'Georgia';
  const body = brand?.typography.body ?? 'Inter';
  return `/* Generated from the brand profile: ${brand?.name ?? 'unnamed'} */
:root {
  --ink: ${c.ink};
  --paper: ${c.paper};
  --muted: ${c.muted};
  --line: ${c.line};
  --accent: ${c.accent};
  --display: "${display}", Georgia, "Times New Roman", serif;
  --body: "${body}", system-ui, -apple-system, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--body);
  font-size: 17px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 720px; margin: 0 auto; padding: 0 20px; }
header.site {
  border-bottom: 1px solid var(--line);
  padding: 22px 0;
  margin-bottom: 54px;
}
header.site .wrap { display: flex; align-items: baseline; gap: 26px; flex-wrap: wrap; }
.mark { font-family: var(--display); font-size: 21px; letter-spacing: -0.01em; text-decoration: none; color: var(--ink); }
nav { display: flex; gap: 18px; flex-wrap: wrap; font-size: 14px; }
nav a { color: var(--muted); text-decoration: none; }
nav a:hover, nav a:focus-visible { color: var(--accent); }
h1 { font-family: var(--display); font-size: clamp(32px, 6vw, 52px); line-height: 1.1; margin: 0 0 20px; text-wrap: balance; }
h2 { font-family: var(--display); font-size: clamp(22px, 3.4vw, 30px); line-height: 1.2; margin: 46px 0 14px; text-wrap: balance; }
h3 { font-size: 18px; margin: 30px 0 8px; }
p { margin: 0 0 16px; }
ul { padding-left: 20px; margin: 0 0 18px; }
li { margin-bottom: 7px; }
a { color: var(--accent); }
.hero { margin-bottom: 64px; }
.hero h1 { margin-bottom: 14px; }
.tagline { font-size: clamp(19px, 2.6vw, 23px); color: var(--ink); margin-bottom: 14px; }
.lede { font-size: 18px; color: var(--muted); max-width: 54ch; margin-bottom: 28px; }
.cta {
  display: inline-block;
  background: var(--accent);
  color: var(--paper);
  text-decoration: none;
  padding: 13px 26px;
  border-radius: 3px;
  font-size: 15px;
  letter-spacing: 0.02em;
}
.cta:hover, .cta:focus-visible { filter: brightness(1.08); }
.offers { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); margin: 26px 0 34px; }
.offer { border: 1px solid var(--line); border-radius: 4px; padding: 20px; background: #fff; }
.offer h3 { margin-top: 0; font-family: var(--display); font-size: 19px; }
.offer .price { font-size: 26px; font-variant-numeric: tabular-nums; margin: 10px 0 4px; }
.offer .unit { font-size: 13px; color: var(--muted); }
/*
 * A page the system flagged is shown as flagged. Publishing a placeholder
 * policy that looks finished is the failure this notice exists to prevent.
 */
.flags {
  border: 1px solid #c9873b;
  background: #fdf6ec;
  color: #7a4d12;
  border-radius: 4px;
  padding: 14px 16px;
  margin-bottom: 34px;
  font-size: 14px;
}
.flags strong { display: block; margin-bottom: 6px; }
.flags ul { margin: 0; }
footer.site { border-top: 1px solid var(--line); margin-top: 72px; padding: 26px 0 60px; font-size: 13px; color: var(--muted); }
footer.site nav { margin-bottom: 12px; }
@media (max-width: 520px) { body { font-size: 16px; } header.site { margin-bottom: 34px; } }
`;
}

/**
 * The brand agent names typefaces; without this they are names only and the
 * page silently falls back to a system face. Google Fonts is the one host that
 * serves them without a key, and if it cannot be reached the stack below holds.
 */
function fontLink(brand: BrandProfile | null): string {
  if (!brand) return '';
  const families = [brand.typography.display, brand.typography.body]
    .filter((f): f is string => Boolean(f && f.trim()))
    .map((f) => `family=${encodeURIComponent(f.trim()).replace(/%20/g, '+')}:wght@400;600;700`);
  if (!families.length) return '';
  return `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${[...new Set(families)].join('&')}&display=swap" />`;
}

function shell(opts: { title: string; brand: BrandProfile | null; pages: StorefrontPage[]; body: string }): string {
  const nav = opts.pages
    .filter((p) => !['home', 'product'].includes(p.slug))
    .map((p) => `<a href="${p.slug}.html">${escapeHtml(p.title)}</a>`)
    .join('\n      ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
${fontLink(opts.brand)}
<link rel="stylesheet" href="styles.css" />
</head>
<body>
<header class="site">
  <div class="wrap">
    <a class="mark" href="index.html">${escapeHtml(opts.brand?.name ?? 'Store')}</a>
    <nav>
      <a href="product.html">Product</a>
      ${nav}
    </nav>
  </div>
</header>
<main class="wrap">
${opts.body}
</main>
<footer class="site">
  <div class="wrap">
    <nav>${nav}</nav>
    <p>Generated by JARVIS ECOM from researched figures. Every page marked for review must be completed and checked before this site is published.</p>
  </div>
</footer>
</body>
</html>
`;
}

function flagBlock(page: StorefrontPage): string {
  if (page.flags.length === 0) return '';
  return `<div class="flags"><strong>Not ready to publish</strong><ul>${page.flags
    .map((f) => `<li>${escapeHtml(f)}</li>`)
    .join('')}</ul></div>`;
}

function offerBlock(offers: Offer[]): string {
  if (offers.length === 0) return '';
  return `<div class="offers">${offers
    .map(
      (o) => `<div class="offer">
  <h3>${escapeHtml(o.name)}</h3>
  <div class="price">${escapeHtml(o.currency)} ${o.price.toFixed(2)}</div>
  <div class="unit">${escapeHtml(o.tier.replace(/_/g, ' ').toLowerCase())}</div>
  <ul>${o.contents.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
  <p>${escapeHtml(o.rationale)}</p>
</div>`,
    )
    .join('\n')}</div>`;
}

export function renderSite(
  candidate: ProductCandidate,
  storefront: Storefront,
  offers: Offer[],
): RenderedFile[] {
  const brand = candidate.brand ?? null;
  const files: RenderedFile[] = [{ path: 'styles.css', content: stylesheet(brand) }];

  for (const page of storefront.pages) {
    const isProduct = page.slug === 'product';
    const isHome = page.slug === 'home';
    // The home page opens with the brand itself: name, line, and the one link
    // that matters. The rest of its copy follows underneath, unchanged.
    let copy = page.body;
    let hero = '';
    if (isHome) {
      const rest = copy.replace(/^#\s+.*$/m, '').trim();
      hero = [
        '<section class="hero">',
        `<h1>${escapeHtml(brand?.name ?? candidate.name)}</h1>`,
        brand?.slogan ? `<p class="tagline">${escapeHtml(brand.slogan)}</p>` : '',
        brand?.positioning ? `<p class="lede">${escapeHtml(brand.positioning)}</p>` : '',
        '<a class="cta" href="product.html">See the product</a>',
        '</section>',
      ]
        .filter(Boolean)
        .join('\n');
      copy = rest;
    }

    const body = [flagBlock(page), hero, markdown(copy), isProduct ? offerBlock(offers) : '']
      .filter(Boolean)
      .join('\n');

    files.push({
      path: page.slug === 'home' ? 'index.html' : `${page.slug}.html`,
      content: shell({
        title: page.slug === 'home' ? `${brand?.name ?? candidate.name}` : `${page.title} — ${brand?.name ?? candidate.name}`,
        brand,
        pages: storefront.pages,
        body,
      }),
    });
  }

  return files;
}
