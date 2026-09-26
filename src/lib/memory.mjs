import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { atomicWrite, loadArchive, pageUrl } from './archive.mjs';
import { readConfig } from './config.mjs';
import { requireWorkspace } from './workspace.mjs';

const fields = ['schemaVersion', 'id', 'revision', 'kind', 'title', 'basis', 'confirmation', 'scope', 'targetTime', 'sources', 'state', 'replaces', 'changeReason', 'createdAt', 'updatedAt'];
const generated = ['schemaVersion', 'id', 'revision', 'createdAt', 'updatedAt'];
const start = '<!-- memory:records:start -->';
const end = '<!-- memory:records:end -->';
const fail = message => { throw new Error(`記憶: ${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && !!value.trim();
const integer = value => Number.isSafeInteger(value) && value > 0;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const idValid = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/u.test(value);
function exact(value, keys, label) {
  if (!object(value) || Object.keys(value).some(k => !keys.includes(k)) || keys.some(k => !Object.hasOwn(value, k))) fail(`${label} の項目が不正です。必須項目: ${keys.join(', ')}`);
}
function regular(path, directory = false) {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) {
    if (error.code === 'ENOENT') fail(`${path} がありません。未作成なら記憶なしで進めてください。既存workspaceなら記憶の保存先を確認してください。`);
    throw error;
  }
  if (!(directory ? stat.isDirectory() : stat.isFile()) || stat.isSymbolicLink()) fail(`${path} は通常の${directory ? 'ディレクトリ' : 'ファイル'}が必要です。`);
}
function memoryRoot(root) {
  regular(join(root, 'memory'), true);
  regular(join(root, 'memory/index.md'));
  return join(root, 'memory');
}
export function validateRecord(record) {
  exact(record, ['metadata', 'body'], '記録');
  const m = record.metadata;
  exact(m, fields, 'metadata');
  if (m.schemaVersion !== 1 || !idValid(m.id) || !integer(m.revision) || !text(m.title) || /[\r\n]/u.test(m.title) ||
      !['experience', 'understanding', 'intention', 'unresolved', 'decision', 'result'].includes(m.kind) ||
      !['user-statement', 'observation', 'inference'].includes(m.basis) ||
      !['unconfirmed', 'confirmed', 'rejected'].includes(m.confirmation) ||
      !['current', 'replaced', 'withdrawn'].includes(m.state) || !date(m.createdAt) || !date(m.updatedAt) || m.updatedAt < m.createdAt ||
      !(m.targetTime === null || text(m.targetTime)) || !text(m.changeReason) || !text(record.body)) fail('metadata または本文の値が不正です。');
  exact(m.scope, ['conditions', 'exceptions'], 'scope');
  if (!text(m.scope.conditions) || !text(m.scope.exceptions)) fail('scope の条件・例外を明示してください。不明も明記してください。');
  if (!Array.isArray(m.replaces) || !m.replaces.every(idValid) || new Set(m.replaces).size !== m.replaces.length) fail('replaces は重複のないID配列です。');
  if (!Array.isArray(m.sources)) fail('sources は配列です。');
  for (const s of m.sources) {
    if (!object(s)) fail('根拠が不正です。');
    if (s.type === 'article') {
      exact(s, ['type', 'projectUrl', 'pageId', 'commitId', 'lineIds'], '記事根拠');
      if (![s.projectUrl, s.pageId, s.commitId].every(text) || !Array.isArray(s.lineIds) || !s.lineIds.length || !s.lineIds.every(text) || new Set(s.lineIds).size !== s.lineIds.length) fail('記事根拠の値が不正です。');
    } else if (s.type === 'dialogue') {
      exact(s, ['type', 'confirmedAt', 'speaker', 'excerpt', 'context'], '対話根拠');
      if (!(s.confirmedAt === null || date(s.confirmedAt)) || ![s.speaker, s.excerpt, s.context].every(text)) fail('対話根拠の値が不正です。');
    } else if (s.type === 'memory') {
      exact(s, ['type', 'id', 'revision'], '記憶根拠');
      if (!idValid(s.id) || !integer(s.revision)) fail('記憶根拠の値が不正です。');
    } else fail('根拠の種類が不正です。');
  }
  return record;
}
export function loadRecords(root) {
  memoryRoot(root);
  const directory = join(root, 'memory/records');
  const records = new Map();
  if (!existsSync(directory)) return records;
  regular(directory, true);
  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith('.md')) fail(`records 内に未知のファイルがあります: ${name}`);
    const path = join(directory, name);
    regular(path);
    const match = /^```json\n([^]*?)\n```\n\n([^]*)$/u.exec(readFileSync(path, 'utf8'));
    if (!match) fail(`${name} は現行の記録形式ではありません。自由形式の記憶は records 外で保持してください。`);
    const record = validateRecord({ metadata: JSON.parse(match[1]), body: match[2] });
    if (name !== `${record.metadata.id}.md`) fail(`${name} とIDが一致しません。`);
    records.set(record.metadata.id, record);
  }
  validateGraph(records, false);
  return records;
}
function validateGraph(records, requireTargets) {
  const active = new Set(), done = new Set();
  function visit(id) {
    if (active.has(id)) fail('記憶参照または replaces が循環しています。');
    if (done.has(id)) return;
    const record = records.get(id);
    if (!record) { if (requireTargets) fail(`参照先不明: ${id}`); return; }
    active.add(id);
    for (const target of [...record.metadata.sources.filter(s => s.type === 'memory').map(s => s.id), ...record.metadata.replaces]) visit(target);
    active.delete(id); done.add(id);
  }
  for (const id of records.keys()) visit(id);
}
function articleArchive(root, projectUrl) {
  return existsSync(join(root, 'archive/articles.json')) ? loadArchive(root, projectUrl).data : null;
}
function evidenceFor(record, records, archive, projectUrl, path = []) {
  const id = record.metadata.id;
  if (path.includes(id)) fail('記憶参照が循環しています。');
  const sources = record.metadata.sources.map(source => {
    if (source.type === 'dialogue') return { source, status: source.confirmedAt === null ? 'unknown-time' : 'recorded', externalFactVerified: false };
    if (source.type === 'article') {
      if (source.projectUrl !== projectUrl) fail('設定外プロジェクトの根拠は参照できません。');
      const page = archive?.articles.find(p => p.id === source.pageId);
      const lines = page ? source.lineIds.map(lineId => page.lines.find(line => line.id === lineId)).filter(Boolean) : [];
      const status = !archive ? 'archive-unavailable' : !page ? 'missing-page' : page.commitId !== source.commitId ? 'changed-version' : lines.length !== source.lineIds.length ? 'missing-lines' : 'current';
      return { source, status, needsRecheck: status !== 'current',
        current: page ? { url: pageUrl(projectUrl, page.title), title: page.title, pageId: page.id, commitId: page.commitId, fetchedAt: page.fetchedAt, lines } : null };
    }
    const target = records.get(source.id);
    if (!target) return { source, status: 'missing-memory', needsRecheck: true, current: null };
    const current = evidenceFor(target, records, archive, projectUrl, [...path, id]);
    const status = target.metadata.revision !== source.revision ? 'changed-revision' : target.metadata.state !== 'current' ? 'inactive-memory' : 'current';
    return { source, status, needsRecheck: status !== 'current' || current.needsRecheck, current };
  });
  return { id, revision: record.metadata.revision, state: record.metadata.state, confirmation: record.metadata.confirmation,
    needsRecheck: sources.some(s => s.needsRecheck), sources };
}
export function readMemory(root, projectUrl, id, evidenceOnly = false) {
  if (!idValid(id)) fail('IDが不正です。');
  const records = loadRecords(root), record = records.get(id);
  if (!record) fail(`記録がありません: ${id}`);
  const evidence = evidenceFor(record, records, articleArchive(root, projectUrl), projectUrl);
  return evidenceOnly ? evidence : { ...record, evidence };
}
export function searchMemory(root, query, { limit = 20, offset = 0, all = false } = {}) {
  if (!text(query) || !integer(limit) || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || typeof all !== 'boolean') fail('検索引数が不正です。');
  const terms = query.trim().toLowerCase().split(/\s+/u);
  const matched = [...loadRecords(root).values()].filter(({ metadata: m, body }) =>
    (all || m.state === 'current') && terms.every(term => `${m.title}\n${body}\n${m.scope.conditions}\n${m.scope.exceptions}`.toLowerCase().includes(term)))
    .sort((a, b) => Buffer.compare(Buffer.from(a.metadata.title), Buffer.from(b.metadata.title)) || Buffer.compare(Buffer.from(a.metadata.id), Buffer.from(b.metadata.id)));
  const items = matched.slice(offset, offset + limit).map(({ metadata: m, body }) => ({ id: m.id, title: m.title, kind: m.kind, state: m.state, revision: m.revision, snippet: [...body].slice(0, 160).join('') }));
  return { items, total: matched.length, limit, offset, nextOffset: offset + items.length < matched.length ? offset + items.length : null };
}
export function memorySummary(root) {
  const records = [...loadRecords(root).values()];
  return { count: records.length, states: Object.fromEntries(['current', 'replaced', 'withdrawn'].map(state => [state, records.filter(r => r.metadata.state === state).length])) };
}
export function renderMemoryIndex(original, records) {
  const starts = original.split(start).length - 1, ends = original.split(end).length - 1;
  if (starts !== ends || starts > 1 || (starts === 1 && original.indexOf(start) > original.indexOf(end))) fail('入口の管理対象マーカーが不正です。自由記述を保ったままマーカーを修正し、npm run memory:index を実行してください。');
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('[', '&#91;').replaceAll(']', '&#93;').replaceAll('\\', '&#92;');
  const rows = [...records.values()].sort((a, b) => Buffer.compare(Buffer.from(a.metadata.title), Buffer.from(b.metadata.title)) || a.metadata.id.localeCompare(b.metadata.id)).map(({ metadata: m }) => `- [${escape(m.title)}](records/${m.id}.md) — ${m.kind} / ${m.state} / ${m.confirmation}`);
  const block = `${start}\n${rows.join('\n')}\n${end}`;
  return starts ? original.slice(0, original.indexOf(start)) + block + original.slice(original.indexOf(end) + end.length) : `${original}${original.endsWith('\n') ? '' : '\n'}\n${block}\n`;
}
function writeIndex(root, records) {
  const path = join(root, 'memory/index.md');
  atomicWrite(path, renderMemoryIndex(readFileSync(path, 'utf8'), records));
}
function withLock(root, action) {
  requireWorkspace(root);
  const { projectUrl } = readConfig(pathToFileURL(`${root}/`));
  const directory = memoryRoot(root), lock = join(directory, '.write.lock');
  try { mkdirSync(lock); }
  catch (error) { if (error.code === 'EEXIST') fail('書き込みロックがあります。実行中でないことを確認して memory/.write.lock を削除してください。'); throw error; }
  try { return action(projectUrl); }
  finally { rmSync(lock, { recursive: true, force: true }); }
}
export function indexMemory(root) {
  return withLock(root, () => { const records = loadRecords(root); writeIndex(root, records); return { indexUpdated: true, ...memorySummary(root) }; });
}
export function saveMemory(root, input, { id, expectRevision } = {}) {
  exact(input, ['metadata', 'body'], '入力');
  exact(input.metadata, fields.filter(k => !generated.includes(k)), '入力metadata');
  if ((id === undefined) !== (expectRevision === undefined) || (id !== undefined && (!idValid(id) || !integer(expectRevision)))) fail('更新にはIDと正の expect-revision が必要です。');
  return withLock(root, projectUrl => {
    const records = loadRecords(root);
    const previous = id === undefined ? null : records.get(id);
    if (id !== undefined && (!previous || previous.metadata.revision !== expectRevision)) fail('revision競合または記録なし。memory:read で現行記録を確認してください。');
    const now = new Date().toISOString();
    const record = validateRecord({ metadata: { ...input.metadata, schemaVersion: 1, id: id ?? randomUUID(), revision: previous ? previous.metadata.revision + 1 : 1, createdAt: previous?.metadata.createdAt ?? now, updatedAt: now }, body: input.body });
    if (!previous && records.has(record.metadata.id)) fail('生成IDが既存記録と重複しました。上書きしません。');
    records.set(record.metadata.id, record);
    validateGraph(records, true);
    const newSources = record.metadata.sources.filter(source => !previous?.metadata.sources.some(old => isDeepStrictEqual(old, source)));
    const evidence = evidenceFor({ ...record, metadata: { ...record.metadata, sources: newSources } }, records, articleArchive(root, projectUrl), projectUrl);
    if (evidence.needsRecheck) fail('根拠の参照先・版・状態が一致しません。原文と根拠記憶を確認してください。');
    const directory = join(root, 'memory/records');
    if (!existsSync(directory)) mkdirSync(directory);
    regular(directory, true);
    atomicWrite(join(directory, `${record.metadata.id}.md`), `\`\`\`json\n${JSON.stringify(record.metadata, null, 2)}\n\`\`\`\n\n${record.body}`, 0o600, join(root, 'memory'));
    const result = { id: record.metadata.id, revision: record.metadata.revision, recordSaved: true, indexUpdated: true };
    try { writeIndex(root, records); }
    catch (error) {
      const failure = new Error(`記録保存は成功しましたが入口更新に失敗しました: ${error.message}\n利用者向けの次の操作: npm run memory:index を実行してください。`);
      failure.partialResult = { ...result, indexUpdated: false };
      throw failure;
    }
    return result;
  });
}
