import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class JsonFileStore<T> {
  private cache?: T;

  constructor(
    private readonly filePath: string,
    private readonly initialValue: () => T,
  ) {
  }

  async read(): Promise<T> {
    if (this.cache) {
      return this.cache;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.cache = JSON.parse(raw) as T;
    } catch (error) {
      this.cache = this.initialValue();
      await this.write(this.cache);
    }

    return this.cache;
  }

  async write(next: T): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(next, null, 2));
    this.cache = next;
  }

  async update(updater: (current: T) => T | Promise<T>): Promise<T> {
    const current = await this.read();
    const next = await updater(current);
    await this.write(next);
    return next;
  }
}
