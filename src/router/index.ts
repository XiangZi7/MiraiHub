import {
  createRouter,
  createWebHashHistory,
  type RouterHistory,
} from "vue-router";
import type { Pinia } from "pinia";
import { SETTINGS_PAGES } from "@/constants/settings";
import { useConnectionsStore } from "@/stores/connections";
import { useWorkspaceStore } from "@/stores/workspace";
import { routes } from "./routes";
import { isWorkspaceNav, type WindowEntry } from "./window-entry";

export function createAppRouter(
  pinia: Pinia,
  entry: WindowEntry,
  history: RouterHistory = createWebHashHistory(),
) {
  const router = createRouter({ history, routes });
  const fallback = (): string => {
    if (entry.surface !== "workspace") return entry.path;
    try {
      // 兼容原来的 useStorage 格式，只记录主视图，不持久化 URL 或敏感参数。
      const saved = localStorage
        .getItem("miraihub:workspace-route")
        ?.replace(/^"|"$/g, "");
      return isWorkspaceNav(saved) ? `/${saved}` : "/servers";
    } catch {
      return "/servers";
    }
  };

  router.beforeEach((to) => {
    if (
      to.name === "not-found" ||
      to.path === "/" ||
      to.meta.surface !== entry.surface
    )
      return { path: fallback(), replace: true };
    if (
      to.name === "settings" &&
      !SETTINGS_PAGES.some((page) => page.id === to.params.section)
    )
      return {
        name: "settings",
        params: { section: "general" },
        replace: true,
      };
    if (
      to.name === "connection" &&
      !["ssh", "local", "database"].includes(String(to.params.kind))
    )
      return { path: entry.path, replace: true };
  });

  router.beforeResolve(async (to) => {
    if (to.meta.surface !== "workspace") return;
    const connections = useConnectionsStore(pinia);
    const workspace = useWorkspaceStore(pinia);
    await connections.initialize();
    workspace.restore(connections.items);
    if (to.name !== "servers" && to.name !== "databases") return;
    const matches = (connection: { kind: string }) =>
      to.name === "databases"
        ? connection.kind === "mysql" || connection.kind === "postgresql"
        : connection.kind === "ssh" || connection.kind === "local";
    const id =
      typeof to.params.connectionId === "string" ? to.params.connectionId : "";
    if (id) {
      const connection = connections.find(id);
      if (!connection || !matches(connection))
        return { name: to.name, params: {}, replace: true };
      // 已打开的标签持有自己的连接快照；路由切换不替换 props，避免误触发重连。
      if (workspace.tabs.some((tab) => tab.id === id)) workspace.activate(id);
      else workspace.open(connection);
    } else {
      const candidate =
        workspace.active && matches(workspace.active.connection)
          ? workspace.active
          : [...workspace.tabs]
              .reverse()
              .find((tab) => matches(tab.connection));
      if (candidate)
        return {
          name: to.name,
          params: { connectionId: candidate.id },
          replace: true,
        };
    }
  });

  router.afterEach((to, _from, failure) => {
    if (failure) return;
    if (typeof document !== "undefined")
      document.title = `${to.meta.title ?? "工作区"} · MiraiHub`;
    if (to.meta.nav) {
      try {
        localStorage.setItem("miraihub:workspace-route", to.meta.nav);
      } catch {
        /* 存储不可用时导航仍可用。 */
      }
    }
  });

  return router;
}

export function connectionLocation(connection: { id: string; kind: string }) {
  return {
    name:
      connection.kind === "mysql" || connection.kind === "postgresql"
        ? "databases"
        : "servers",
    params: { connectionId: connection.id },
  };
}
