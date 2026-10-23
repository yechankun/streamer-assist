const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const output = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/participant-count.ts'), 'utf8'), { compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText;
const api={}; vm.runInNewContext(output,{exports:api});
test('participant display uses exact counts up to ten, tens below 100, and digit magnitude thereafter', () => {
  for(const [n,label] of [[0,'0명'],[1,'1명'],[9,'9명'],[10,'10명'],[11,'10명+'],[19,'10명+'],[20,'20명+'],[29,'20명+'],[99,'90명+'],[100,'100명+'],[199,'100명+'],[999,'100명+'],[1000,'1000명+'],[9999,'1000명+'],[10000,'10000명+']]) assert.equal(api.participantCount(n),label,'count '+n);
});
