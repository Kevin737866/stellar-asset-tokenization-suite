/**
 * Verification script to detect stale, broken, or missing local documentation
 * and public API references across Markdown documents.
 */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const scanTargets = [
  path.join(rootDir, 'README.md'),
  path.join(rootDir, 'CONTRIBUTING.md'),
];

const docsDir = path.join(rootDir, 'docs');
if (fs.existsSync(docsDir)) {
  const docFiles = fs.readdirSync(docsDir).filter((file) => file.endsWith('.md'));
  for (const docFile of docFiles) {
    scanTargets.push(path.join(docsDir, docFile));
  }
}

const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
let brokenLinksCount = 0;
let totalCheckedLinks = 0;

for (const filePath of scanTargets) {
  if (!fs.existsSync(filePath)) {
    continue;
  }

  const relativeFile = path.relative(rootDir, filePath);
  const content = fs.readFileSync(filePath, 'utf8');
  let match;

  while ((match = linkRegex.exec(content)) !== null) {
    const rawTarget = match[2].trim();
    const cleanTarget = rawTarget.split('#')[0].trim();

    // Skip external URLs, mailto, anchor-only links, and mentions
    if (
      !cleanTarget ||
      cleanTarget.startsWith('http://') ||
      cleanTarget.startsWith('https://') ||
      cleanTarget.startsWith('mailto:') ||
      cleanTarget.startsWith('@')
    ) {
      continue;
    }

    totalCheckedLinks++;
    const resolvedPath = path.resolve(path.dirname(filePath), cleanTarget);

    if (!fs.existsSync(resolvedPath)) {
      console.error(
        `::error file=${relativeFile}::Missing or stale link target: "${rawTarget}"`
      );
      brokenLinksCount++;
    }
  }
}

console.log(
  `[check-doc-links] Verified ${totalCheckedLinks} local link(s) across documentation files.`
);

if (brokenLinksCount > 0) {
  console.error(
    `[check-doc-links] FAILED: Found ${brokenLinksCount} missing or broken documentation link(s).`
  );
  process.exit(1);
} else {
  console.log('[check-doc-links] SUCCESS: All documentation links are valid.');
}
