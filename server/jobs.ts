import { mkdir, readFile, writeFile, rename, readdir, unlink, access } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { isId, validateJob, type JobRecord } from '../src/network-protocol';

export async function atomicJson(path: string, value: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(value), { mode: 0o600 }); await rename(temp, path); }
  finally { await unlink(temp).catch(() => undefined); }
}
export class JobStore {
  private queue = Promise.resolve();
  constructor(readonly directory: string, private maxEvents?: number) {}
  private path(id: string) { if (!isId(id)) throw new Error('Invalid job ID'); return join(this.directory, `${id}.json`); }
  async get(id: string): Promise<JobRecord> {
    const record = JSON.parse(await readFile(this.path(id), 'utf8')) as JobRecord;
    try { return { ...record, ...JSON.parse(await readFile(this.path(id) + '.state', 'utf8')) }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return record; }
  }
  async accept(value: unknown): Promise<JobRecord> {
    const envelope = validateJob(value, { maxEvents: this.maxEvents });
    const result = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const id = createHash('sha256').update(envelope.requestId).digest('hex');
      try {
        const existing = await this.get(id);
        if (JSON.stringify(existing.plan) !== JSON.stringify(envelope.plan)||existing.version!==envelope.version||existing.prepared?.digest!==envelope.prepared?.digest) throw new Error('Request ID already belongs to another job');
        return existing;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const record: JobRecord = { ...envelope, id, status: 'pending', createdAt: new Date().toISOString() };
      await atomicJson(this.path(id), record); return record;
    });
    this.queue = result.then(() => undefined, () => undefined); return result;
  }
  async update(id: string, fields: Partial<Pick<JobRecord, 'status' | 'startRequestId' | 'error' | 'copy' | 'remainingMs' | 'checkpoint'>>) {
    // State is a tiny sidecar. Never parse/stringify the immutable plan during motion.
    const path = this.path(id); await access(path);
    let previous: object = { status: 'pending' };
    try { previous = JSON.parse(await readFile(path + '.state', 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const record = { ...previous, ...fields }; await atomicJson(path + '.state', record); return record;
  }
  async saveDiagnostics(id: string, value: unknown): Promise<void> {
    await atomicJson(this.path(id) + '.diagnostics', value);
  }
  async getDiagnostics(id: string): Promise<unknown> {
    return JSON.parse(await readFile(this.path(id) + '.diagnostics', 'utf8'));
  }
  async recoverInterrupted() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let interrupted = 0;
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const record = await this.get(name.slice(0, -5));
      if (record.status === 'interrupted') interrupted++;
      else if (!['pending', 'finished', 'stopped', 'failed'].includes(record.status)) { interrupted++; await this.update(record.id, { status: 'interrupted', error: 'Runner restarted; establish origin and prepare a new job.' }); }
    }
    return interrupted;
  }
}
