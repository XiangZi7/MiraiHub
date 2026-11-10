import type { RouteRecordRaw } from 'vue-router'
import type { NavId } from '@/types'
import type { WindowSurface } from '@/router/window-entry'

declare module 'vue-router' {
  interface RouteMeta {
    surface?: WindowSurface
    nav?: NavId
    title?: string
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
