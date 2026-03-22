import { parse } from 'node-html-parser';
import { readFileSync, writeFileSync, statSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, relative, isAbsolute, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseVersion(v) {
  const parts = v.split('.').map(Number);
  return parts[0] * 10000 + (parts[1] || 0) * 100 + (parts[2] || 0);
}

function parseTestLine(line) {
  line = line.trim();
  if (!line || line.startsWith('//') || line.startsWith('#')) return null;

  let minVersion = null;
  let maxVersion = null;
  let filePath = line;

  const minMatch = line.match(/^--min-version\s+(\S+)/);
  const maxMatch = line.match(/--max-version\s+(\S+)/);

  if (minMatch) {
    minVersion = minMatch[1];
  }
  if (maxMatch) {
    maxVersion = maxMatch[1];
  }

  filePath = line
    .replace(/--min-version\s+\S+\s*/g, '')
    .replace(/--max-version\s+\S+\s*/g, '')
    .trim();

  return { filePath, minVersion, maxVersion };
}

function collectTests(listPath, baseDir) {
  const results = [];
  const lines = readFileSync(listPath, 'utf-8').split('\n');

  const listDir = dirname(listPath);

  for (const line of lines) {
    const parsed = parseTestLine(line);
    if (!parsed) continue;

    const { filePath, minVersion, maxVersion } = parsed;
    const fullPath = isAbsolute(filePath) ? filePath : join(listDir, filePath);
    const relPath = relative(baseDir, fullPath);

    if (filePath.endsWith('.txt')) {
      if (statSync(fullPath).isFile()) {
        const nested = collectTests(fullPath, baseDir);
        results.push({
          type: 'group',
          path: relPath,
          children: nested
        });
      }
    } else if (filePath.endsWith('.html')) {
      results.push({
        type: 'test',
        path: relPath,
        ...(minVersion && { minVersion }),
        ...(maxVersion && { maxVersion })
      });
    }
  }

  return results;
}

function normalizeFilePath(path) {
  let result = path;
  result = result.replace(/--min-version\s+\S+\s*/g, '');
  result = result.replace(/--max-version\s+\S+\s*/g, '');
  result = result.replace(/--slow\s*/g, '');
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

function getFunctionName(filePath) {
  const normalized = normalizeFilePath(filePath);
  const base = basename(normalized, extname(normalized));
  return base.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
}

function escapeString(str) {
  if (str === null || str === undefined) return 'null';
  return JSON.stringify(str);
}

function nodeToHyperscript(node, indent = 2) {
  const spaces = ' '.repeat(indent);
  const tag = node.tagName ? node.tagName.toLowerCase() : null;

  if (!tag) {
    const text = node.text || '';
    const trimmed = text.trim();
    if (trimmed) {
      return escapeString(trimmed);
    }
    return null;
  }

  const attrs = {};
  if (node.attributes) {
    for (const [key, value] of Object.entries(node.attributes)) {
      if (value !== undefined && value !== null) {
        attrs[key] = value;
      }
    }
  }

  const children = node.childNodes
    .map(child => nodeToHyperscript(child, indent + 2))
    .filter(c => c !== null);

  const childrenStr = children.length > 0
    ? `[\n${children.map(c => spaces + '  ' + c).join(',\n')}\n${spaces}]`
    : '[]';

  const attrsStr = Object.keys(attrs).length > 0
    ? JSON.stringify(attrs)
    : 'null';

  return `h("${tag}", ${attrsStr}, ${childrenStr})`;
}

function convertHtmlToHyperscript(htmlPath) {
  const html = readFileSync(htmlPath, 'utf-8');
  const root = parse(html, { blockTextElements: { script: true, style: true, noscript: true } });

  const body = root.querySelector('body') || root;
  const head = root.querySelector('head');

  const lines = [];
  const funcName = getFunctionName(htmlPath);

  lines.push(`function ${funcName}(h) {`);

  const parts = [];

  if (head && head.childNodes.length > 0) {
    const headNodes = head.childNodes
      .map(child => nodeToHyperscript(child, 2))
      .filter(n => n !== null);
    if (headNodes.length > 0) {
      parts.push(`  h("head", null, [${headNodes.join(', ')}])`);
    }
  }

  if (body) {
    const bodyNodes = body.childNodes
      .map(child => nodeToHyperscript(child, 2))
      .filter(n => n !== null);
    if (bodyNodes.length > 0) {
      parts.push(`  h("body", null, [${bodyNodes.join(', ')}])`);
    }
  }

  if (parts.length > 0) {
    lines.push(`  h("html", null, [\n    ${parts.join(',\n    ')}\n  ]);`);
  } else {
    lines.push(`  h("html", null, []);`);
  }

  lines.push('}');

  return lines.join('\n');
}

function processTests(tests, baseDir, results) {
  for (const test of tests) {
    if (test.type === 'test' && test.path.endsWith('.html')) {
      const normalizedPath = normalizeFilePath(test.path);
      const srcPath = join(baseDir, normalizedPath);
      const hyperPath = srcPath.replace(/\.html$/, '.hyper.js');

      const output = convertHtmlToHyperscript(srcPath);

      const outDir = dirname(hyperPath);
      if (!existsSync(outDir)) {
        mkdirSync(outDir, { recursive: true });
      }

      writeFileSync(hyperPath, output);

      const hyperRelPath = relative(baseDir, hyperPath);
      results.push({
        type: 'test',
        path: hyperRelPath,
        ...(test.minVersion && { minVersion: test.minVersion }),
        ...(test.maxVersion && { maxVersion: test.maxVersion })
      });
    } else if (test.type === 'group' && test.children) {
      const groupResult = {
        type: 'group',
        path: test.path,
        children: []
      };
      processTests(test.children, baseDir, groupResult.children);
      results.push(groupResult);
    }
  }
}

function countTests(tests) {
  let count = 0;
  for (const test of tests) {
    if (test.type === 'test') count++;
    else if (test.type === 'group' && test.children) count += countTests(test.children);
  }
  return count;
}

const rootList = join(__dirname, '00_test_list.txt');
const tests = collectTests(rootList, __dirname);

const hyperTests = [];
processTests(tests, __dirname, hyperTests);
const count = countTests(hyperTests);

const output = {
  version: '1.0',
  generatedAt: new Date().toISOString(),
  root: rootList,
  tests: hyperTests
};

writeFileSync(join(__dirname, 'hypertests.json'), JSON.stringify(output, null, 2));
console.log(`Converted ${count} HTML files to HyperScript functions.`);
console.log(`Output: hypertests.json`);
