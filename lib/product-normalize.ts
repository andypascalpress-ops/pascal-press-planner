/**
 * Product name normalization + category inference.
 * Used to collapse noisy Stripe descriptions (e.g. "Subscription for a@b.com")
 * into canonical products, and to bucket products by a coarse category for filters.
 */

export type ProductBrand =
  | 'Pascal Press'
  | 'Blake Education'
  | 'Excel Test Zone'
  | 'Excel HSC Copilot';

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Long numeric / hex order & customer refs (5+ digits, or #1234, or hex ids)
const ORDER_REF_RE = /#?\b\d{5,}\b/g;
const HEX_ID_RE = /\b[a-f0-9]{12,}\b/gi;

/** Collapse whitespace and trim stray separators left after stripping. */
function tidy(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s*[-–—:•·|]\s*$/g, '')
    .replace(/^\s*[-–—:•·|]\s*/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+,/g, ',')
    .trim();
}

/**
 * Canonicalize a raw product/description string into a clean display name.
 * Removes emails, order/customer refs, and common per-customer suffixes so the
 * same underlying product aggregates under a single key.
 */
export function normalizeProductName(raw: string, brand: ProductBrand): string {
  if (!raw) return 'Unspecified';
  let s = String(raw).trim();

  // Strip "Payment for" / "Invoice for" / "Charge for" preambles
  s = s.replace(/^\s*(payment|invoice|charge|receipt)\s+for\s+/i, '');

  // Strip emails, hex ids, and long numeric order/customer refs
  s = s.replace(EMAIL_RE, '');
  s = s.replace(HEX_ID_RE, '');
  s = s.replace(ORDER_REF_RE, '');

  // Drop dangling "for" / "by" / "user" left after removing an email
  s = s.replace(/\b(for|by|user|customer|account)\s*$/i, '');
  s = s.replace(/\bfor\s*(the\s+)?$/i, '');

  s = tidy(s);

  // Stripe brand-specific canonicalization
  if (brand === 'Excel HSC Copilot') {
    const hsc = canonicalizeHsc(s);
    if (hsc) return hsc;
  }
  if (brand === 'Excel Test Zone') {
    const etz = canonicalizeEtz(s);
    if (etz) return etz;
  }

  if (!s) return 'Subscription';
  return s;
}

/** HSC Stripe: fold plan / subscription variants into stable names. */
function canonicalizeHsc(s: string): string | null {
  const low = s.toLowerCase();
  if (!low) return 'HSC Subscription';

  // Subject-specific plans e.g. "HSC Maths Advanced ..." → "HSC Maths Advanced"
  const subj = matchSubject(s);
  if (/subscription|plan|membership|monthly|annual|yearly/.test(low)) {
    if (subj) return `HSC ${subj} Subscription`;
    return 'HSC Subscription';
  }
  if (subj) return `HSC ${subj}`;
  // Generic HSC copilot charges without detail
  if (/hsc|copilot/.test(low)) return 'HSC Subscription';
  return null;
}

/** ETZ Stripe: keep pack names, fold generic subscriptions. */
function canonicalizeEtz(s: string): string | null {
  const low = s.toLowerCase();
  if (!low) return 'Test Zone Subscription';
  if (/subscription|plan|membership|monthly|annual|yearly/.test(low) && low.length < 30) {
    const yl = matchYearLevel(s);
    return yl ? `Test Zone Subscription (${yl})` : 'Test Zone Subscription';
  }
  return null; // keep pack name as-is
}

const SUBJECTS = [
  'Mathematics Extension 2', 'Mathematics Extension 1', 'Mathematics Advanced',
  'Mathematics Standard', 'Maths Extension', 'Maths Advanced', 'Maths Standard',
  'Maths', 'Mathematics', 'English Advanced', 'English Standard', 'English',
  'Biology', 'Chemistry', 'Physics', 'Economics', 'Business Studies',
  'Legal Studies', 'Modern History', 'Ancient History', 'Geography', 'Science',
];

function matchSubject(s: string): string | null {
  for (const subj of SUBJECTS) {
    if (new RegExp(`\\b${subj.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s)) {
      return subj;
    }
  }
  return null;
}

function matchYearLevel(s: string): string | null {
  const m = s.match(/\b(year|yr|grade)\s*(1[0-2]|[1-9])\b/i);
  if (m) return `Year ${m[2]}`;
  if (/\bkindergarten\b|\bkindy\b/i.test(s)) return 'Kindergarten';
  if (/\bprep\b/i.test(s)) return 'Prep';
  return null;
}

/**
 * Infer a coarse category from a product name for filtering.
 * Returns a single best-fit label.
 */
export function inferCategory(name: string, brand: ProductBrand): string {
  const s = (name || '').toLowerCase();

  // Series / product-type first (most specific & useful for ops)
  if (/naplan/.test(s)) return 'NAPLAN';
  if (/selective/.test(s)) return 'Selective';
  if (/scholarship/.test(s)) return 'Scholarship';
  if (/opportunity class|\boc\b/.test(s)) return 'Opportunity Class';
  if (/reading eggs/.test(s)) return 'Reading Eggs';
  if (/targeting/.test(s)) return 'Targeting';
  if (/\bexcel\b/.test(s)) return 'Excel';
  if (/\bhsc\b/.test(s)) return 'HSC';
  if (/assessment|test pack|practice test|exam/.test(s)) return 'Assessment / Test Pack';
  if (/subscription|plan|membership|copilot/.test(s)) return 'Subscription';
  if (/book pack|bundle|pack\b|collection|set\b/.test(s)) return 'Book Pack';
  if (/workbook|worksheet|activity/.test(s)) return 'Workbook';

  // Subject fallback
  if (/\bmath|maths|mathematics|numeracy\b/.test(s)) return 'Maths';
  if (/\benglish|literacy|reading|writing|spelling|grammar\b/.test(s)) return 'English';
  if (/\bscience|biology|chemistry|physics\b/.test(s)) return 'Science';

  // Year level fallback
  const yl = matchYearLevel(name || '');
  if (yl) return yl;

  if (brand === 'Excel HSC Copilot') return 'HSC';
  if (brand === 'Excel Test Zone') return 'Subscription';
  return 'Other';
}
