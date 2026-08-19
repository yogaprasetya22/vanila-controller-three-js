import fs from 'fs';
import path from 'path';

// PONYTAIL: Simple JSON to TypeScript converter.
// Ceiling: Assumes valid JSON input and generates a large inline object, which can slow down TS compiler for huge files.
// Upgrade path: Load JSON dynamically at runtime or use JSON imports if compiler performance degrades.

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error("Usage: node convert-quark.mjs <path-to-json>");
  process.exit(1);
}

try {
  const raw = fs.readFileSync(jsonPath, 'utf8');
  // Parse to ensure valid JSON
  JSON.parse(raw);

  // Generate safe camelCase variable name
  const baseName = path.basename(jsonPath, '.json');
  const varName = baseName
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (word, index) => index === 0 ? word.toLowerCase() : word.toUpperCase())
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9]/g, '');

  const tsContent = `// Generated from ${path.basename(jsonPath)}\nexport const ${varName} = ${raw.trim()} as const;\n`;

  const outPath = path.join(path.dirname(jsonPath), `${baseName.replace(/\s+/g, '')}.ts`);
  fs.writeFileSync(outPath, tsContent, 'utf8');
  console.log(`Successfully converted to: ${outPath}`);
} catch (err) {
  console.error(`Error converting file: ${err.message}`);
  process.exit(1);
}
