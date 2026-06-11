import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

import type {
  AuditEntry,
  BindingsData,
  DecisionsData,
  IdempotencyRecord,
  MessageBinding,
  PendingDecision,
  TaskRecord,
  TasksData,
  UserBinding,
} from '../domain/models.js';
import { JsonFileStore } from './json-file-store.js';

const emptyBindings = (): BindingsData => ({
  users: {},
  messages: {},
  idempotency: {},
});

const emptyTasks = (): TasksData => ({
  tasks: {},
});

const emptyDecisions = (): DecisionsData => ({
  items: {},
});

export class BindingsRepository {
  private readonly store: JsonFileStore<BindingsData>;

  constructor(dataDir: string) {
    this.store = new JsonFileStore(path.join(dataDir, 'bindings.json'), emptyBindings);
  }

  async getUser(larkUserId: string): Promise<UserBinding | undefined> {
    const data = await this.store.read();
    return data.users[larkUserId];
  }

  async upsertUser(next: UserBinding): Promise<void> {
    await this.store.update((data) => ({
      ...data,
      users: {
        ...data.users,
        [next.larkUserId]: next,
      },
    }));
  }

  async updateUser(larkUserId: string, updater: (current: UserBinding | undefined) => UserBinding): Promise<UserBinding> {
    let created!: UserBinding;
    await this.store.update((data) => {
      created = updater(data.users[larkUserId]);
      return {
        ...data,
        users: {
          ...data.users,
          [larkUserId]: created,
        },
      };
    });
    return created;
  }

  async bindMessage(binding: MessageBinding): Promise<void> {
    await this.store.update((data) => ({
      ...data,
      messages: {
        ...data.messages,
        [binding.messageId]: binding,
      },
    }));
  }

  async getMessage(messageId: string): Promise<MessageBinding | undefined> {
    const data = await this.store.read();
    return data.messages[messageId];
  }

  async rememberIdempotency(record: IdempotencyRecord): Promise<void> {
    await this.store.update((data) => ({
      ...data,
      idempotency: {
        ...data.idempotency,
        [record.key]: record,
      },
    }));
  }

  async getIdempotency(key: string): Promise<IdempotencyRecord | undefined> {
    const data = await this.store.read();
    return data.idempotency[key];
  }
}

export class TasksRepository {
  private readonly store: JsonFileStore<TasksData>;

  constructor(dataDir: string) {
    this.store = new JsonFileStore(path.join(dataDir, 'tasks.json'), emptyTasks);
  }

  async list(): Promise<TaskRecord[]> {
    const data = await this.store.read();
    return Object.values(data.tasks).sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async get(taskId: string): Promise<TaskRecord | undefined> {
    const data = await this.store.read();
    return data.tasks[taskId];
  }

  async put(task: TaskRecord): Promise<void> {
    await this.store.update((data) => ({
      ...data,
      tasks: {
        ...data.tasks,
        [task.taskId]: task,
      },
    }));
  }

  async update(taskId: string, updater: (current: TaskRecord | undefined) => TaskRecord): Promise<TaskRecord> {
    let created!: TaskRecord;
    await this.store.update((data) => {
      created = updater(data.tasks[taskId]);
      return {
        ...data,
        tasks: {
          ...data.tasks,
          [taskId]: created,
        },
      };
    });
    return created;
  }

  async listActive(): Promise<TaskRecord[]> {
    const items = await this.list();
    return items.filter((item) => !['Succeeded', 'Failed', 'Cancelled'].includes(item.state));
  }

  async latestForUser(operatorId: string): Promise<TaskRecord | undefined> {
    const items = await this.list();
    return items.find((item) => item.operatorId === operatorId);
  }
}

export class DecisionsRepository {
  private readonly store: JsonFileStore<DecisionsData>;

  constructor(dataDir: string) {
    this.store = new JsonFileStore(path.join(dataDir, 'decisions.json'), emptyDecisions);
  }

  async get(taskId: string): Promise<PendingDecision | undefined> {
    const data = await this.store.read();
    return data.items[taskId];
  }

  async put(decision: PendingDecision): Promise<void> {
    await this.store.update((data) => ({
      ...data,
      items: {
        ...data.items,
        [decision.taskId]: decision,
      },
    }));
  }

  async remove(taskId: string): Promise<void> {
    await this.store.update((data) => {
      const next = { ...data.items };
      delete next[taskId];
      return {
        ...data,
        items: next,
      };
    });
  }
}

export class AuditRepository {
  private readonly filePath: string;

  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, 'audit.ndjson');
  }

  async append(entry: AuditEntry): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`);
  }
}
