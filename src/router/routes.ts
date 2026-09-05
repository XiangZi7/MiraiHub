import type { RouteRecordRaw } from 'vue-router'
import type { NavId } from '@/types'
import type { WindowSurface } from './window-entry'

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
      { path: 'servers/:connectionId?', name: 'servers', component: () => import('@/pages/workspace/ServersPage.vue'), meta: { nav: 'servers', title: '服务器' } },
      { path: 'databases/:connectionId?', name: 'databases', component: () => import('@/pages/workspace/DatabasesPage.vue'), meta: { nav: 'databases', title: '数据库' } },
      { path: 'ssh-keys', name: 'ssh-keys', component: () => import('@/pages/workspace/SshKeysPage.vue'), meta: { nav: 'ssh-keys', title: 'SSH 密钥' } },
      { path: 'recent', name: 'recent', component: () => import('@/pages/workspace/RecentPage.vue'), meta: { nav: 'recent', title: '最近连接' } },
    ],
  },
  { path: '/settings/:section?', name: 'settings', component: () => import('@/pages/windows/SettingsPage.vue'), meta: { surface: 'settings', title: '设置' } },
  { path: '/connection/:kind?', name: 'connection', component: () => import('@/pages/windows/ConnectionPage.vue'), props: route => ({ kind: route.params.kind, connectionId: typeof route.query.connectionId === 'string' ? route.query.connectionId : '' }), meta: { surface: 'connection', title: '连接配置' } },
  { path: '/remote-editor', name: 'remote-editor', component: () => import('@/pages/windows/RemoteEditorPage.vue'), meta: { surface: 'remote-editor', title: '远端文件编辑' } },
  { path: '/splash', name: 'splash', component: () => import('@/pages/windows/SplashPage.vue'), meta: { surface: 'splash', title: '正在启动' } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/pages/NotFoundPage.vue') },
]
