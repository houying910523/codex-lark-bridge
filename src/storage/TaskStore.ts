import {JsonFileStore} from "./json-file-store";
import path from "node:path";
import {Thread, ThreadItem, ThreadStatus, Turn} from "../codex/protocol/v2";

export interface TaskState {
  lark: {
    chatId: string;
    messageId: string;
    reaction_id?: {
      typing: string;
    }
  }
  currentSessionId: string;
  session?: Thread;
  status?: ThreadStatus;
  turn?: Turn;
  items?: ThreadItem[];
  activeItem?: ThreadItem;
  streamState?: {
    messageId: string,
    timer?: NodeJS.Timeout,
    dirty: boolean
  }
}

export class TaskStore {
  private readonly store: JsonFileStore<TaskState>;

  constructor(dataDir: string) {
    this.store = new JsonFileStore(path.join(dataDir, 'task.json'), () => ({
      currentSessionId: '',
      lark: {
        chatId: '',
        messageId: '',
      },
      items: []
    }));
  }

  async read(): Promise<TaskState> {
    return this.store.read();
  }

  async write(next: TaskState): Promise<void> {
    await this.store.write(next);
  }
}