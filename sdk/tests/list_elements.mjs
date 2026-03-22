import { readFileSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function collectTagsFromHyperscript(hyperscript) {
  const tags = [];
  
  function h(tag, attrs, ...children) {
    tags.push(tag);
    children.forEach(child => {
      if (Array.isArray(child)) {
        child.forEach(c => {
          if (typeof c === 'string') {
            // nested array structure like ["tag", null, [...]]
          }
        });
      }
    });
    return [tag, attrs, ...children];
  }
  
  function processValue(val) {
    if (Array.isArray(val)) {
      val.forEach(v => processValue(v));
    }
  }
  
  const result = hyperscript(h);
  processValue(result);
  
  return tags;
}

function collectTagsFromSource(source) {
  const tags = [];
  const tagRegex = /h\s*\(\s*["']([^"']+)["']\s*,/g;
  let match;
  while ((match = tagRegex.exec(source)) !== null) {
    tags.push(match[1]);
  }
  return tags;
}

const hypertests = JSON.parse(readFileSync(join(__dirname, 'hypertests.json'), 'utf-8'));
const allTags = new Set();

function processNode(node) {
  if (node.type === 'test' && node.path.endsWith('.hyper.js')) {
    const fullPath = join(__dirname, node.path);
    const source = readFileSync(fullPath, 'utf-8');
    const tags = collectTagsFromSource(source);
    tags.forEach(tag => allTags.add(tag));
  } else if (node.type === 'group' && node.children) {
    node.children.forEach(processNode);
  }
}

hypertests.tests.forEach(processNode);

const sortedTags = Array.from(allTags).sort();

console.log(JSON.stringify(sortedTags));
