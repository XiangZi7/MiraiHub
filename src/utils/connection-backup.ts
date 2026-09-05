import type {
  ConnectionGroup,
  ConnectionTagDefinition,
  SavedConnection,
} from "@/types/connection";
export interface ConnectionBackup {
  format: "miraihub-connections";
  version: 1;
  createdAt: number;
  includesCredentials: boolean;
  connections: SavedConnection[];
  groups: ConnectionGroup[];
  tags: ConnectionTagDefinition[];
}
export interface ConnectionSnapshot {
  connections: SavedConnection[];
  groups: ConnectionGroup[];
  tags: ConnectionTagDefinition[];
}
export type RestoreMode = "skip" | "update" | "copy";
export interface RestoreOptions {
  mode: RestoreMode;
  credentials: boolean;
  startupCommands: boolean;
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
const COLORS = [
  "red",
  "orange",
  "amber",
  "green",
  "cyan",
  "blue",
  "violet",
  "gray",
] as const;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("备份中存在无效对象");
  return value as Record<string, unknown>;
}
function string(value: unknown, name: string, max = 4096): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error(`${name} 无效或过长`);
  return value;
}
function optional(value: unknown, name: string, max = 4096): string {
  return value === undefined ? "" : string(value, name, max);
}
function number(
  value: unknown,
  name: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${name} 无效`);
  return value;
}
function array(value: unknown, name: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${name} 无效或数量过多`);
  return value;
}
function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
  name: string,
): T {
  if (!choices.includes(value as T)) throw new Error(`${name} 不受支持`);
  return value as T;
}
function connection(value: unknown): SavedConnection {
  const v = object(value),
    s = object(v.settings);
  const kind = choice(
    v.kind,
    ["ssh", "mysql", "postgresql", "local"],
    "连接类型",
  );
  const common = {
    id: string(v.id, "连接 ID", 200),
    name: string(v.name, "连接名", 200),
    kind,
    host: string(v.host, "主机", 253),
    port: number(v.port, "端口", kind === "local" ? 0 : 1, 65535),
    username: string(v.username, "用户名", 256),
    group: string(v.group, "分组", 200),
    description: optional(v.description, "备注"),
    tags: array(v.tags ?? [], "标签", 50).map((t) => string(t, "标签名", 100)),
    tagColor: choice(v.tagColor ?? "green", COLORS, "标签颜色"),
    createdAt: number(v.createdAt, "创建时间"),
    lastUsedAt: 0,
  };
  if (!common.id || !common.name || (kind !== "local" && !common.host))
    throw new Error("连接 ID、名称和主机不能为空");
  if (kind === "ssh") {
    const a = object(s.auth),
      type = choice(a.type, ["password", "privateKey", "agent"], "认证方式");
    const auth =
      type === "password"
        ? { type, password: optional(a.password, "密码", 8192) }
        : type === "privateKey"
          ? {
              type,
              path: string(a.path, "密钥路径"),
              passphrase: optional(a.passphrase, "私钥口令", 8192),
            }
          : { type };
    return {
      ...common,
      settings: {
        auth,
        timeoutSecs: number(s.timeoutSecs ?? 30, "SSH 超时", 1, 300),
        keepaliveSecs: number(s.keepaliveSecs ?? 30, "心跳间隔", 0, 3600),
        terminalType:
          optional(s.terminalType, "终端类型", 100) || "xterm-256color",
        startupCommand: optional(s.startupCommand, "启动命令", 8192),
      },
    };
  }
  if (kind === "local")
    return {
      ...common,
      settings: {
        shell: choice(s.shell, ["powershell", "cmd", "git-bash"], "本地终端"),
        workingDirectory: optional(s.workingDirectory, "工作目录"),
      },
    };
  return {
    ...common,
    settings: {
      database: optional(s.database, "数据库名称", 256),
      password: optional(s.password, "密码", 8192),
      ssl: s.ssl === true,
      ...(s.sslMode !== undefined
        ? {
            sslMode: choice(
              s.sslMode,
              [
                "disable",
                "prefer",
                "require",
                "verify-ca",
                "verify-full",
              ] as const,
              "SSL 策略",
            ),
          }
        : {}),
      caCertificate: optional(s.caCertificate, "CA 证书路径"),
      clientCertificate: optional(s.clientCertificate, "客户端证书路径"),
      clientKey: optional(s.clientKey, "客户端密钥路径"),
    },
  };
}
export function parseConnectionBackup(value: unknown): ConnectionBackup {
  const root = object(value);
  if (root.format !== "miraihub-connections" || root.version !== 1)
    throw new Error("不支持的连接备份格式或版本");
  const connections = array(root.connections, "连接", 5000).map(connection);
  if (new Set(connections.map((c) => c.id)).size !== connections.length)
    throw new Error("备份中存在重复连接 ID");
  const groups = array(root.groups, "分组", 1000).map((v) => {
    const g = object(v);
    return {
      id: string(g.id, "分组 ID", 200),
      name: string(g.name, "分组名", 200),
      kind: choice(g.kind, ["ssh", "database"], "分组类型"),
      createdAt: number(g.createdAt, "分组时间"),
    };
  });
  const tags = array(root.tags, "标签目录", 1000).map((v) => {
    const t = object(v);
    return {
      name: string(t.name, "标签名", 100),
      color: choice(t.color, COLORS, "标签颜色"),
      createdAt: number(t.createdAt, "标签时间"),
    };
  });
  return {
    format: "miraihub-connections",
    version: 1,
    createdAt: number(root.createdAt, "备份时间"),
    includesCredentials: root.includesCredentials === true,
    connections,
    groups,
    tags,
  };
}
function sanitized(
  source: SavedConnection,
  options: Pick<RestoreOptions, "credentials" | "startupCommands">,
): SavedConnection {
  const c = clone(source);
  if ("auth" in c.settings) {
    if (!options.credentials) {
      if (c.settings.auth.type === "password") c.settings.auth.password = "";
      if (c.settings.auth.type === "privateKey")
        c.settings.auth.passphrase = "";
    }
    if (!options.startupCommands) c.settings.startupCommand = "";
  }
  if ("password" in c.settings && !options.credentials)
    c.settings.password = "";
  return c;
}
export function createConnectionBackup(
  snapshot: ConnectionSnapshot,
  includeCredentials: boolean,
): ConnectionBackup {
  return {
    format: "miraihub-connections",
    version: 1,
    createdAt: Date.now(),
    includesCredentials: includeCredentials,
    connections: snapshot.connections.map((c) =>
      sanitized(c, {
        credentials: includeCredentials,
        startupCommands: includeCredentials,
      }),
    ),
    groups: clone(snapshot.groups),
    tags: clone(snapshot.tags),
  };
}
export function restorePlan(
  current: ConnectionSnapshot,
  backup: ConnectionBackup,
  options: RestoreOptions,
  newId: () => string,
) {
  const next: ConnectionSnapshot = clone(current);
  const changes: {
    name: string;
    host: string;
    kind: string;
    action: "add" | "update" | "skip";
  }[] = [];
  for (const source of backup.connections) {
    const c = sanitized(source, options);
    const index = next.connections.findIndex((item) => item.id === c.id);
    const action =
      index < 0 || options.mode === "copy"
        ? "add"
        : options.mode === "update"
          ? "update"
          : "skip";
    changes.push({
      name: c.name,
      host: `${c.host}:${c.port}`,
      kind: c.kind,
      action,
    });
    if (action === "skip") continue;
    if (action === "update") {
      // An archive with stripped secrets must not silently erase current credentials.
      const existing = next.connections[index]!;
      const sameEndpoint =
        existing.kind === c.kind &&
        existing.host === c.host &&
        existing.port === c.port &&
        existing.username === c.username;
      if (!options.credentials && sameEndpoint) {
        if ("password" in existing.settings && "password" in c.settings)
          c.settings.password = existing.settings.password;
        if (
          "auth" in existing.settings &&
          "auth" in c.settings &&
          existing.settings.auth.type === c.settings.auth.type
        ) {
          if (
            existing.settings.auth.type === "password" &&
            c.settings.auth.type === "password"
          )
            c.settings.auth.password = existing.settings.auth.password;
          if (
            existing.settings.auth.type === "privateKey" &&
            c.settings.auth.type === "privateKey" &&
            existing.settings.auth.path === c.settings.auth.path
          )
            c.settings.auth.passphrase = existing.settings.auth.passphrase;
        }
      }
      if (
        !options.startupCommands &&
        sameEndpoint &&
        "startupCommand" in existing.settings &&
        "startupCommand" in c.settings
      )
        c.settings.startupCommand = existing.settings.startupCommand;
      next.connections[index] = c;
    } else {
      if (
        options.mode === "copy" ||
        next.connections.some((item) => item.id === c.id)
      ) {
        c.id = newId();
        if (next.connections.some((item) => item.id === c.id))
          throw new Error("无法生成唯一连接 ID");
      }
      next.connections.push(c);
    }
  }
  for (const g of backup.groups)
    if (
      !next.groups.some(
        (item) =>
          item.kind === g.kind &&
          item.name.toLocaleLowerCase() === g.name.toLocaleLowerCase(),
      )
    )
      next.groups.push({
        ...g,
        id: next.groups.some((item) => item.id === g.id) ? newId() : g.id,
      });
  for (const t of backup.tags)
    if (
      !next.tags.some(
        (item) => item.name.toLocaleLowerCase() === t.name.toLocaleLowerCase(),
      )
    )
      next.tags.push(t);
  return { next, changes };
}
