const fs = require('fs');
let code = fs.readFileSync('packages/app-core/src/workspace-sidebars.tsx', 'utf-8');

// The multi_replace_file_content tool just messed up the order.
// Let's restore the original file from git.
