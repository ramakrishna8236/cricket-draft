import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist');
rmSync(output, { recursive: true, force: true });
mkdirSync(output);
cpSync(path.join(root, 'index.html'), path.join(output, 'index.html'));
cpSync(path.join(root, 'src'), path.join(output, 'src'), { recursive: true });
cpSync(path.join(root, 'public'), path.join(output, 'public'), { recursive: true });
console.log(`Cricket Draft ready in ${output}`);
