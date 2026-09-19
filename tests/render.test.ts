import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSite } from '../agents/shopify/render.ts';
import { candidate } from './helpers.ts';
import type { Offer, Storefront } from '../core/types/index.ts';

function storefront(pages: Storefront['pages']): Storefront {
  return { productId: 'p1', pages, productPageSections: [], generatedAt: new Date().toISOString() };
}

const offer: Offer = {
  tier: 'STARTER',
  name: 'Single',
  contents: ['1 × Chair'],
  price: 179.99,
  currency: 'USD',
  contribution: 100,
  rationale: 'Entry price at the researched market level.',
};

test('every storefront page becomes a file, with home as the index', () => {
  const files = renderSite(
    candidate({ name: 'Chair' }),
    storefront([
      { slug: 'home', title: 'Home', body: '# Chair', flags: [] },
      { slug: 'faq', title: 'FAQ', body: '## FAQ', flags: [] },
    ]),
    [],
  );
  const paths = files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['faq.html', 'index.html', 'styles.css']);
});

test('a flagged page says so on the page itself', () => {
  const files = renderSite(
    candidate({ name: 'Chair' }),
    storefront([{ slug: 'privacy', title: 'Privacy', body: '## Privacy', flags: ['Requires legal review; this is a placeholder, not a policy.'] }]),
    [],
  );
  const html = files.find((f) => f.path === 'privacy.html')?.content ?? '';
  assert.match(html, /Not ready to publish/);
  assert.match(html, /placeholder, not a policy/);
});

test('an unflagged page carries no review notice', () => {
  const files = renderSite(
    candidate({ name: 'Chair' }),
    storefront([{ slug: 'home', title: 'Home', body: '# Chair', flags: [] }]),
    [],
  );
  assert.doesNotMatch(files.find((f) => f.path === 'index.html')?.content ?? '', /Not ready to publish/);
});

test('offers are rendered at their real price and currency, on the product page only', () => {
  const files = renderSite(
    candidate({ name: 'Chair' }),
    storefront([
      { slug: 'product', title: 'Chair', body: '# Chair', flags: [] },
      { slug: 'home', title: 'Home', body: '# Chair', flags: [] },
    ]),
    [offer],
  );
  assert.match(files.find((f) => f.path === 'product.html')?.content ?? '', /USD 179\.99/);
  assert.doesNotMatch(files.find((f) => f.path === 'index.html')?.content ?? '', /179\.99/);
});

test('copy is escaped, so page text can never inject markup', () => {
  const files = renderSite(
    candidate({ name: 'Chair' }),
    storefront([{ slug: 'home', title: 'Home', body: 'A <script>alert(1)</script> claim', flags: [] }]),
    [],
  );
  const html = files.find((f) => f.path === 'index.html')?.content ?? '';
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('the stylesheet is built from the brand, not from a fixed theme', () => {
  const c = candidate({ name: 'Chair' });
  c.brand = {
    name: 'Meridian',
    rationale: '',
    positioning: '',
    audience: '',
    tone: [],
    typography: { display: 'Fraunces', body: 'Karla', rationale: '' },
    palette: [{ name: 'Slate', hex: '#123456', use: 'accent' }],
    packaging: '',
    productNaming: [],
    slogan: 'Sit well.',
    story: '',
    photographyDirection: '',
    videoDirection: '',
  };
  const css = renderSite(c, storefront([{ slug: 'home', title: 'Home', body: '# Meridian', flags: [] }]), []).find((f) => f.path === 'styles.css')?.content ?? '';
  assert.match(css, /#123456/);
  assert.match(css, /Fraunces/);
  assert.match(css, /Karla/);
});

test('the home page leads with the brand, and its heading is not repeated below', () => {
  const c = candidate({ name: 'Chair' });
  c.brand = {
    name: 'Meridian', rationale: '', positioning: 'Built for people who sit all day.', audience: '', tone: [],
    typography: { display: 'Fraunces', body: 'Karla', rationale: '' },
    palette: [{ name: 'Slate', hex: '#123456', use: 'accent' }],
    packaging: '', productNaming: [], slogan: 'Sit well.', story: '', photographyDirection: '', videoDirection: '',
  };
  const html = renderSite(c, storefront([{ slug: 'home', title: 'Home', body: '# Meridian\n\nBuilt for people who sit all day.\n\n## What it does\n\nIt holds your back.', flags: [] }]), [])
    .find((f) => f.path === 'index.html')?.content ?? '';
  assert.equal(html.match(/<h1>/g)?.length, 1, 'one h1 only');
  assert.match(html, /Sit well\./);
  assert.match(html, /What it does/);
  assert.match(html, /fonts\.googleapis\.com/, 'the named typefaces are actually loaded');
});
