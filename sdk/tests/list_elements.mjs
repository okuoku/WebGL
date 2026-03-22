import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function collectTagsFromSourceRegex(source) {
  const tags = [];
  const tagRegex = /h\s*\(\s*["']([^"']+)["']\s*,/g;
  let match;
  while ((match = tagRegex.exec(source)) !== null) {
    tags.push(match[1]);
  }
  return [...new Set(tags)];
}

function collectTagsFromHyperscript(hyperscript) {
  const tags = [];
  const h = (tag, attrs, ...children) => {
    tags.push(tag);
    children.forEach(child => {
      if (Array.isArray(child)) {
        collectFromArray(child, tags);
      }
    });
    return [tag, attrs, ...children];
  };

  function collectFromArray(arr, collector) {
    arr.forEach(item => {
      if (Array.isArray(item)) {
        collectFromArray(item, collector);
      }
    });
  }

  const result = hyperscript(h);
  collectFromArray(result, tags);

  return [...new Set(tags)];
}

function evaluateHyperscript(source) {
  const h = (tag, attrs, ...children) => {
    tags.push(tag);
    children.forEach(child => {
      if (Array.isArray(child)) {
        collectFromArray(child, tags);
      }
    });
    return [tag, attrs, ...children];
  };

  const tags = [];
  const collectFromArray = (arr, collector) => {
    arr.forEach(item => {
      if (Array.isArray(item)) {
        collectFromArray(item, collector);
      }
    });
  };

  const functionNames = source.match(/^function\s+(\w+)\s*\(/gm)?.map(m => m.match(/^function\s+(\w+)/)[1]) || [];
  
  const wrappedCode = `
    ${source}
    const __hyperscript_funcs__ = [${functionNames.map(n => n).join(', ')}];
    return __hyperscript_funcs__;
  `;

  try {
    const getFuncs = new Function(wrappedCode);
    const funcs = getFuncs();
    funcs.forEach(fn => fn(h));
    return tags;
  } catch (e) {
    return collectTagsFromSourceRegex(source);
  }
}

const hypertests = JSON.parse(readFileSync(join(__dirname, 'hypertests.json'), 'utf-8'));
const allTags = new Set();

function processNode(node) {
  if (node.type === 'test' && node.path.endsWith('.hyper.js')) {
    const fullPath = join(__dirname, node.path);
    const source = readFileSync(fullPath, 'utf-8');
    const tags = evaluateHyperscript(source);
    tags.forEach(tag => allTags.add(tag));
  } else if (node.type === 'group' && node.children) {
    node.children.forEach(processNode);
  }
}

hypertests.tests.forEach(processNode);

const sortedTags = Array.from(allTags).sort();

console.log(JSON.stringify(sortedTags));
