#!/usr/bin/env node
const fs = require('fs');

const filepath = 'dist/cli.js';
const shebang = '#!/usr/bin/env node\n';
const content = fs.readFileSync(filepath, 'utf8');

if (!content.startsWith(shebang)) {
  fs.writeFileSync(filepath, shebang + content);
}
