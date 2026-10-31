/**
 * B2 regression guard: no screen draws its own back arrow — every header
 * uses the shared 48dp HeaderBackButton (accessibilityLabel "Back").
 * Plain JS so it can use Node's fs/path (the app's TS config has no Node types).
 */
const fs = require('fs');
const path = require('path');

test('every header back arrow comes from HeaderBackButton', () => {
  const root = path.resolve(__dirname, '../../../..');
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'HeaderBackButton') walk(full);
      } else if (full.endsWith('.tsx') && fs.readFileSync(full, 'utf8').includes('name="arrow-left"')) {
        offenders.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  expect(offenders).toEqual([]);
});
