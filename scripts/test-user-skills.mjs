import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { parseSkillFiles, parseSkillUpload, buildSkillContext, UserSkillStore, exportSkill } from '../server/user-skills.ts';

const markdown = '---\nname: study-guide\ndescription: Explain study methods.\n---\nUse [rubric](references/rubric.md).';
const files = [{ path: 'study-guide/SKILL.md', content: markdown }, { path: 'study-guide/references/rubric.md', content: 'Separate assumptions and evidence.' }];
const parsed = parseSkillFiles(files);
assert.equal(parsed.name, 'study-guide'); assert.equal(parsed.files[0].path, 'references/rubric.md');
assert.match(parsed.instructions, /rubric/);
assert.equal(parseSkillFiles([{ path: 'Notes.md', content: '# Notes\nExplain plainly.' }]).format, 'markdown');
const indented = '    Preserve this code example\n\nExplain the passage.\n';
assert.equal(parseSkillFiles([{ path: 'Notes.md', content: indented }]).instructions, indented, 'Import must preserve Markdown indentation and trailing newline');
const codeExample = '```markdown\n[Example](references/not-a-real-file.md)\n```\nExplain the passage.';
assert.equal(parseSkillFiles([{ path: 'Notes.md', content: codeExample }]).instructions, codeExample, 'A fenced example is not a live resource binding');
assert.equal(parseSkillFiles([{ path: 'SKILL.md', content: '---\nname: test\ndescription: >-\n  Explain assumptions\n  and evidence.\n---\nDo it.' }]).description, 'Explain assumptions and evidence.');
for (const [bad, code] of [
  [[{ path: '../SKILL.md', content: markdown }], 'path'],
  [[{ path: '/SKILL.md', content: markdown }], 'path'],
  [[{ path: 'C:\\SKILL.md', content: markdown }], 'path'],
  [[{ path: 'SKILL.md', content: '# no metadata' }], 'metadata'],
  [[{ path: 'SKILL.md', content: '---\nname: test\nname: other\ndescription: test\n---\nInstructions.' }], 'metadata'],
  [[{ path: 'SKILL.md', content: markdown }], 'reference'],
  [[...files, { path: 'study-guide/scripts/run.py', content: 'print(1)' }], 'unsupported'],
  [[...files, { path: 'study-guide/assets/image.png', content: 'not text' }], 'unsupported'],
  [[...files, { path: 'another/SKILL.md', content: markdown }], 'entry'],
  [[...files, files[1]], 'path'],
  [[{ path: 'one.md', content: 'x'.repeat(50_000) }], 'limit']
]) assert.throws(() => parseSkillFiles(bad), e => e.code === code, code);
const zip = new JSZip(); for (const f of files) zip.file(f.path, f.content);
assert.deepEqual(await parseSkillUpload('guide.zip', await zip.generateAsync({ type: 'nodebuffer' })), parsed);
await assert.rejects(parseSkillUpload('guide.zip', Buffer.from('broken')), e => e.code === 'archive');
await assert.rejects(parseSkillUpload('guide.md', Buffer.from([0xff, 0xfe])), e => e.code === 'encoding');
const slip = new JSZip(); slip.file('../SKILL.md', markdown);
await assert.rejects(parseSkillUpload('guide.zip', await slip.generateAsync({ type: 'nodebuffer' })), e => e.code === 'path');
const link = new JSZip(); link.file('SKILL.md', markdown); link.file('references/rubric.md', 'elsewhere', { unixPermissions: 0o120777 });
await assert.rejects(parseSkillUpload('guide.zip', await link.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })), e => e.code === 'path');
const bomb = new JSZip(); bomb.file('SKILL.md', 'a'.repeat(3_000_000));
await assert.rejects(parseSkillUpload('guide.zip', await bomb.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })), e => e.code === 'limit');
const duplicateZip = new JSZip(); duplicateZip.file('SKILL.md', '---\nname: duplicate\ndescription: Test.\n---\nRead.'); duplicateZip.file('one.md', 'first'); duplicateZip.file('two.md', 'second');
const duplicateBytes = Buffer.from((await duplicateZip.generateAsync({ type: 'nodebuffer' })).toString('latin1').replaceAll('two.md', 'one.md'), 'latin1');
await assert.rejects(parseSkillUpload('duplicate.zip', duplicateBytes), e => e.code === 'path');
const damagedContent = Buffer.from((await duplicateZip.generateAsync({ type: 'nodebuffer' })).toString('latin1').replace('first', 'firsX'), 'latin1');
await assert.rejects(parseSkillUpload('damaged.zip', damagedContent), e => e.code === 'archive');
const ordinary = { name: '论文论证检查', description: '关注实验设计。', instructions: '区分观察与因果。', files: [], format: 'markdown' };
assert.deepEqual(await parseSkillUpload('export.zip', await exportSkill(ordinary)), ordinary);
const dir = await mkdtemp(path.join(os.tmpdir(), 'aitip-user-skills-'));
try {
  const store = new UserSkillStore(dir);
  const created = await store.create('alice', parsed);
  assert.equal(created.enabled, false); assert.equal(buildSkillContext(await store.list('alice'), 'en').prompt, '');
  assert.deepEqual(await store.list('bob'), []);
  await assert.rejects(store.create('alice', parsed), e => e.code === 'duplicate');
  await assert.rejects(store.update('bob', created.id, { enabled: true, signature: created.signature }), e => e.code === 'missing');
  const enabled = await store.update('alice', created.id, { enabled: true, signature: created.signature });
  const context = buildSkillContext([enabled], 'en');
  assert.match(context.prompt, /Separate assumptions and evidence/); assert.equal(context.snapshots[0].signature, enabled.signature);
  const edited = await store.update('alice', created.id, { instructions: 'Use new instructions.', signature: enabled.signature });
  assert.notEqual(edited.signature, enabled.signature);
  await assert.rejects(store.update('alice', created.id, { enabled: false, signature: enabled.signature }), e => e.code === 'stale');
  assert.match(buildSkillContext(await store.list('alice'), 'en').prompt, /Use new instructions/);
  assert.equal((await new UserSkillStore(dir).list('alice'))[0].signature, edited.signature);
  const disabled = await store.update('alice', created.id, { enabled: false, signature: edited.signature });
  await assert.rejects(store.update('alice', created.id, { enabled: true, signature: edited.signature }), e => e.code === 'stale');
  assert.equal(buildSkillContext(await store.list('alice'), 'en').prompt, '');
  for (let i = 0; i < 4; i++) {
    const s = await store.create('alice', { ...parsed, name: `skill-${i}`, instructions: 'Respond concisely.' });
    await store.update('alice', s.id, { enabled: true, signature: s.signature });
  }
  await assert.rejects(store.update('alice', created.id, { enabled: true, signature: disabled.signature }), e => e.code === 'budget');
  assert.throws(() => buildSkillContext([{ ...enabled, instructions: 'tampered' }], 'en'), e => e.code === 'integrity');
  await assert.rejects(store.delete('bob', created.id, edited.signature), e => e.code === 'missing');
  await store.delete('alice', created.id, disabled.signature);
  assert.ok(!(await store.list('alice')).some(s => s.id === created.id));
  await store.purge('alice'); assert.deepEqual(await store.list('alice'), []);
  console.log(JSON.stringify({ evidence: 'COMPONENT_CAPABILITY', parsing: true, invalidPackagesRejected: true, accountIsolation: true, disabledAbsent: true, staleWritesRejected: true, tamperingRejected: true, restartPersistence: true, deletion: true }));
} finally { await rm(dir, { recursive: true, force: true }); }
