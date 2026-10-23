const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/speech-voices.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
vm.runInNewContext(source, { exports: exportsObject });
const { sortVoices } = exportsObject;
const native = { backend: 'native', voice: 'Microsoft Heami Desktop', name: 'Microsoft Heami Desktop', lang: 'ko-KR', local: true };
const browser = { backend: 'browser', voice: 'Microsoft Heami - Korean (Korean)', name: 'Microsoft Heami - Korean (Korean)', lang: 'ko-KR', local: true };

test('one installed Microsoft voice appears once across Windows and browser providers, independent of enumeration order', () => {
  for (const rows of [[native, browser], [browser, native, browser]]) {
    const voices = sortVoices(rows);
    assert.equal(voices.length, 1); assert.equal(voices[0].backend, 'browser');
  }
});
test('merging voices preserves an existing explicit native or browser selection', () => {
  for (const selected of [native, browser]) {
    const voices = sortVoices([native, browser], selected);
    assert.equal(voices.length, 1); assert.equal(voices[0], selected);
  }
});
test('different languages, providers, local/online services and quality variants remain distinct', () => {
  const rows = [native, browser,
    { ...browser, voice: 'online', local: false },
    { ...native, lang: 'en-US' },
    { ...native, name: 'Microsoft Heami Online (Natural)', voice: 'natural' },
    { ...browser, name: 'Different provider Heami', voice: 'other-provider' },
    { backend: 'browser', name: 'Yuna', voice: 'apple.compact.yuna', lang: 'ko-KR', local: true },
    { backend: 'browser', name: 'Yuna', voice: 'apple.premium.yuna', lang: 'ko-KR', local: true },
  ];
  assert.equal(sortVoices(rows).length, 7);
});
