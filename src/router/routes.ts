import type { RouteLocationNormalized, RouteRecordRaw } from 'vue-router'
import type { NavId } from '@/types'
import type { WindowSurface } from '@/router/window-entry'

declare module 'vue-router' {
  interface RouteMeta {
    surface?: WindowSurface
    nav?: NavId
    title?: string
  }
}

/** 提取原生容器窗口固定的目标，忽略不受支持的参数。 */
function containerWindowProps({ query }: RouteLocationNormalized) {
  return {
    connectionId: typeof query.connectionId === 'string' ? query.connectionId : '',
    containerId: typeof query.containerId === 'string' ? query.containerId : '',
    containerName: typeof query.containerName === 'string' ? query.containerName : '',
  }
}

/** 路由只声明页面入口；领域组件不作为路由直接使用。 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: () => import('@/layouts/WorkspaceLayout.vue'),
    meta: { surface: 'workspace' },
    children: [
      {
        path: 'servers/:connectionId?',
        name: 'servers',
        component: () => import('@/pages/servers/index.vue'),
        meta: { nav: 'servers', title: '服务器' },
      },
      {
        path: 'databases/:connectionId?',
        name: 'databases',
        component: () => import('@/pages/databases/index.vue'),
        meta: { nav: 'databases', title: '数据库' },
      },
      {
        path: 'docker/:connectionId?',
        name: 'docker',
        component: () => import('@/pages/docker/index.vue'),
        meta: { nav: 'docker', title: 'Docker' },
      },
    ],
  },
  {
    path: '/settings/:section?',
    name: 'settings',
    component: () => import('@/pages/settings/index.vue'),
    meta: { surface: 'settings', title: '设置' },
  },
  {
    path: '/connection/:kind?',
    name: 'connection',
    component: () => import('@/pages/connection/index.vue'),
    props: route => ({
      kind: route.params.kind,
      connectionId:
        typeof route.query.connectionId === 'string'
          ? route.query.connectionId
          : '',
      group: typeof route.query.group === 'string' ? route.query.group : '',
    }),
    meta: { surface: 'connection', title: '连接配置' },
  },
  {
    path: '/docker-logs',
    name: 'docker-logs',
    component: () => import('@/pages/docker/logs.vue'),
    props: containerWindowProps,
    meta: { surface: 'docker-logs', title: '容器日志' },
  },
  {
    path: '/docker-details',
    name: 'docker-details',
    component: () => import('@/pages/docker/details.vue'),
    props: containerWindowProps,
    meta: { surface: 'docker-details', title: '容器详情' },
  },
  {
    path: '/remote-editor',
    name: 'remote-editor',
    component: () => import('@/pages/remote-editor.vue'),
    meta: { surface: 'remote-editor', title: '远端文件编辑' },
  },
  {
    path: '/column-tags',
    name: 'column-tags',
    component: () => import('@/pages/column-tags.vue'),
    meta: { surface: 'column-tags', title: '标签化显示' },
  },
  {
    path: '/splash',
    name: 'splash',
    component: () => import('@/pages/splash.vue'),
    meta: { surface: 'splash', title: '正在启动' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/pages/not-found.vue'),
  },
]
