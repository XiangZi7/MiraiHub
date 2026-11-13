<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useEventListener } from '@vueuse/core'
import { computed, onMounted, reactive, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import * as database from '@/api/database'
import { toast } from '@/composables/useToast'
import type { DatabaseKind, DatabaseObject } from '@/types/database'
import type {
  DatabaseAccount,
  GrantEntry,
  GrantLevel,
  GrantScope,
  UserAction,
} from '@/types/database-ops'
import { cn } from '@/utils/cn'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  databaseKind: DatabaseKind
  databaseName: string
  connectionName: string
}>()

const emit = defineEmits<{
  close: []
}>()

type DialogKind = 'create' | 'password' | 'grant' | 'drop' | 'revoke'

// 各级别可勾选的权限；名称直接拼进 GRANT 语句，后端会再校验
const MYSQL_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'INDEX',
  'REFERENCES',
  'CREATE VIEW',
  'SHOW VIEW',
  'TRIGGER',
  'EXECUTE',
  'CREATE ROUTINE',
  'ALTER ROUTINE',
  'EVENT',
  'LOCK TABLES',
  'CREATE TEMPORARY TABLES',
]
const MYSQL_GLOBAL_EXTRA = [
  'PROCESS',
  'RELOAD',
  'SHOW DATABASES',
  'CREATE USER',
  'REPLICATION CLIENT',
  'REPLICATION SLAVE',
]
const MYSQL_TABLE_PRIVILEGES = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'INDEX',
  'REFERENCES',
  'TRIGGER',
  'SHOW VIEW',
]
const PG_PRIVILEGES: Record<GrantLevel, string[]> = {
  global: [],
  database: ['CONNECT', 'CREATE', 'TEMPORARY'],
  schema: [
    'USAGE',
    'CREATE',
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER',
  ],
  table: [
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'REFERENCES',
    'TRIGGER',
  ],
  role: [],
}

const isMysql = computed(() => props.databaseKind === 'mysql')

const state = reactive({
  loading: true,
  error: '',
  notice: '',
  accounts: [] as DatabaseAccount[],
  keyword: '',
  selectedKey: '',
  grantsLoading: false,
  grantsError: '',
  grants: [] as GrantEntry[],
  databases: [] as string[],
  objects: [] as DatabaseObject[],
  catalogLoaded: false,
  dialog: null as null | {
    kind: DialogKind
    step: 'edit' | 'preview'
    action: UserAction | null
    statements: string[]
    busy: boolean
  },
})

const form = reactive({
  name: '',
  host: '%',
  password: '',
  passwordAgain: '',
  login: true,
  level: 'database' as GrantLevel,
  database: '',
  schema: '',
  table: '',
  role: '',
  privileges: [] as string[],
  allPrivileges: false,
  withGrantOption: false,
})

/** 账号唯一键：MySQL 用 user@host，PostgreSQL 只有角色名 */
function accountKey(account: DatabaseAccount): string {
  return `${account.name}@${account.host ?? ''}`
}

/** 账号的展示名 */
function accountLabel(account: DatabaseAccount): string {
  return account.host ? `${account.name}@${account.host}` : account.name
}

const filteredAccounts = computed(() => {
  const keyword = state.keyword.trim().toLowerCase()
  if (!keyword) return state.accounts
  return state.accounts.filter(account =>
    [account.name, account.host ?? '', ...account.attributes].some(value =>
      value.toLowerCase().includes(keyword)
    )
  )
})

const selected = computed(
  () =>
    state.accounts.find(account => accountKey(account) === state.selectedKey) ??
    null
)

/** 读取账号列表，保留仍存在的选中项 */
async function loadAccounts(): Promise<void> {
  state.loading = true
  try {
    const result = await database.listAccounts(props.sessionId)
    state.accounts = result.accounts
    state.notice = result.notice ?? ''
    state.error = ''
    if (!selected.value) {
      const first = result.accounts[0]
      state.selectedKey = first ? accountKey(first) : ''
    }
    if (selected.value) await loadGrants()
  } catch (error) {
    state.error = database.errorMessage(error)
  } finally {
    state.loading = false
  }
}

/** 读取选中账号的授权明细 */
async function loadGrants(): Promise<void> {
  const account = selected.value
  if (!account) return
  state.grantsLoading = true
  state.grantsError = ''
  try {
    state.grants = await database.listGrants(
      props.sessionId,
      account.name,
      account.host
    )
  } catch (error) {
    state.grants = []
    state.grantsError = database.errorMessage(error)
  } finally {
    state.grantsLoading = false
  }
}

/** 切换选中账号并刷新授权 */
function selectAccount(account: DatabaseAccount): void {
  if (state.selectedKey === accountKey(account)) return
  state.selectedKey = accountKey(account)
  state.grants = []
  void loadGrants()
}

/** 首次打开授权表单时加载库/表清单，供下拉选择 */
async function loadCatalog(): Promise<void> {
  if (state.catalogLoaded) return
  try {
    const [databases, objects] = await Promise.all([
      database.listDatabases(props.sessionId),
      database.listObjects(props.sessionId),
    ])
    state.databases = databases
    state.objects = objects.filter(
      item => item.kind === 'table' || item.kind === 'view'
    )
    state.catalogLoaded = true
  } catch (error) {
    console.warn('读取库表清单失败：', error)
  }
}

onMounted(() => void loadAccounts())

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  // 子对话框打开时由它处理 Esc
  if (event.key === 'Escape' && !state.dialog) emit('close')
})

const levelOptions = computed(() =>
  (isMysql.value
    ? (['global', 'database', 'table'] as GrantLevel[])
    : (['database', 'schema', 'table', 'role'] as GrantLevel[])
  ).map(level => ({ value: level, label: levelLabel(level) }))
)

/** 授权级别的显示名 */
function levelLabel(level: GrantLevel): string {
  return {
    global: t('全局'),
    database: t('数据库'),
    schema: t('模式'),
    table: t('表'),
    role: t('角色成员'),
  }[level]
}

const databaseOptions = computed(() =>
  state.databases.map(name => ({ value: name, label: name }))
)

const schemaOptions = computed(() =>
  [...new Set(state.objects.map(item => item.schema))].map(name => ({
    value: name,
    label: name,
  }))
)

// MySQL 只有当前库的表清单可选；选了其他库时改为手填
const tableOptions = computed(() => {
  const owner = isMysql.value ? form.database : form.schema
  return state.objects
    .filter(item => item.schema === owner)
    .map(item => ({ value: item.name, label: item.name }))
})

const roleOptions = computed(() =>
  state.accounts
    .filter(account => account.name !== selected.value?.name)
    .map(account => ({ value: account.name, label: account.name }))
)

const privilegeChoices = computed(() => {
  if (!isMysql.value) return PG_PRIVILEGES[form.level]
  if (form.level === 'table') return MYSQL_TABLE_PRIVILEGES
  if (form.level === 'global') return [...MYSQL_PRIVILEGES, ...MYSQL_GLOBAL_EXTRA]
  return MYSQL_PRIVILEGES
})

// 切换级别后原先勾选的权限可能不适用，清空重选
watch(
  () => form.level,
  () => {
    form.privileges = []
    form.allPrivileges = false
  }
)

/** 勾选/取消某项权限 */
function togglePrivilege(privilege: string): void {
  form.privileges = form.privileges.includes(privilege)
    ? form.privileges.filter(item => item !== privilege)
    : [...form.privileges, privilege]
}

/** 打开新建用户表单 */
function openCreate(): void {
  Object.assign(form, {
    name: '',
    host: '%',
    password: '',
    passwordAgain: '',
    login: true,
  })
  openDialog('create')
}

/** 打开修改密码表单 */
function openPassword(): void {
  form.password = ''
  form.passwordAgain = ''
  openDialog('password')
}

/** 打开授权表单，默认作用于当前库 */
function openGrant(): void {
  Object.assign(form, {
    level: isMysql.value ? 'database' : 'schema',
    database: props.databaseName,
    schema: '',
    table: '',
    role: '',
    privileges: [],
    allPrivileges: false,
    withGrantOption: false,
  })
  if (!isMysql.value) form.schema = schemaOptions.value[0]?.value ?? 'public'
  openDialog('grant')
  void loadCatalog().then(() => {
    if (!isMysql.value && !form.schema)
      form.schema = schemaOptions.value[0]?.value ?? 'public'
  })
}

/** 删除用户：直接进入 SQL 预览 */
function askDrop(): void {
  const account = selected.value
  if (!account) return
  void openPreview('drop', {
    type: 'drop',
    name: account.name,
    host: account.host ?? '',
  })
}

/** 撤销一条已解析出范围的授权：直接进入 SQL 预览 */
function askRevoke(entry: GrantEntry): void {
  const account = selected.value
  if (!account || !entry.scope) return
  void openPreview('revoke', {
    type: 'revoke',
    name: account.name,
    host: account.host ?? '',
    privileges: entry.privileges,
    scope: entry.scope,
  })
}

/** 打开编辑步骤的对话框 */
function openDialog(kind: DialogKind): void {
  state.dialog = {
    kind,
    step: 'edit',
    action: null,
    statements: [],
    busy: false,
  }
}

/** 生成并展示将执行的 SQL；失败时留在当前步骤并提示 */
async function openPreview(kind: DialogKind, action: UserAction): Promise<void> {
  const dialog = state.dialog ?? {
    kind,
    step: 'edit' as const,
    action: null,
    statements: [],
    busy: false,
  }
  state.dialog = dialog
  dialog.busy = true
  try {
    const statements = await database.previewUserAction(props.sessionId, action)
    Object.assign(dialog, { action, statements, step: 'preview' })
  } catch (error) {
    toast.error({
      title: t('生成 SQL 失败'),
      description: database.errorMessage(error),
    })
    // 直接预览类操作没有编辑步骤，出错就关闭
    if (kind === 'drop' || kind === 'revoke') state.dialog = null
  } finally {
    dialog.busy = false
  }
}

/** 校验表单并组装成后端的账号操作 */
function buildAction(): UserAction | null {
  const kind = state.dialog?.kind
  const account = selected.value
  const host = isMysql.value ? form.host.trim() || '%' : ''
  const needPassword = (): boolean => {
    if (form.password !== form.passwordAgain) {
      toast.warning(t('两次输入的密码不一致'))
      return false
    }
    return true
  }
  if (kind === 'create') {
    if (!form.name.trim()) {
      toast.warning(t('请输入用户名'))
      return null
    }
    if (!needPassword()) return null
    return {
      type: 'create',
      name: form.name.trim(),
      host,
      password: form.password,
      login: form.login,
    }
  }
  if (!account) return null
  if (kind === 'password') {
    if (!form.password) {
      toast.warning(t('请输入新密码'))
      return null
    }
    if (!needPassword()) return null
    return {
      type: 'changePassword',
      name: account.name,
      host: account.host ?? '',
      password: form.password,
    }
  }
  if (kind === 'grant') {
    const scope: GrantScope = {
      level: form.level,
      database: form.database.trim(),
      schema: form.schema.trim(),
      table: form.table.trim(),
      role: form.role.trim(),
    }
    const privileges =
      form.level === 'role'
        ? []
        : form.allPrivileges
          ? ['ALL PRIVILEGES']
          : form.privileges
    return {
      type: 'grant',
      name: account.name,
      host: account.host ?? '',
      privileges,
      scope,
      withGrantOption: form.withGrantOption,
    }
  }
  return null
}

/** 编辑步骤的“下一步”：生成 SQL 预览 */
function next(): void {
  const kind = state.dialog?.kind
  const action = buildAction()
  if (kind && action) void openPreview(kind, action)
}

/** 执行预览过的操作，成功后刷新列表 */
async function apply(): Promise<void> {
  const dialog = state.dialog
  if (!dialog?.action || dialog.busy) return
  dialog.busy = true
  try {
    await database.applyUserAction(props.sessionId, dialog.action)
    toast.success(t('已执行 {count} 条语句', { count: dialog.statements.length }))
    if (dialog.action.type === 'create')
      state.selectedKey = `${dialog.action.name}@${dialog.action.host ?? ''}`
    if (dialog.action.type === 'drop') state.selectedKey = ''
    state.dialog = null
    form.password = ''
    form.passwordAgain = ''
    await loadAccounts()
  } catch (error) {
    toast.error({
      title: t('执行失败'),
      description: database.errorMessage(error),
    })
  } finally {
    dialog.busy = false
  }
}

const dialogTitle = computed(() => {
  const kind = state.dialog?.kind
  const name = selected.value ? accountLabel(selected.value) : ''
  if (kind === 'create') return t('新建用户')
  if (kind === 'password') return t('修改 {name} 的密码', { name })
  if (kind === 'grant') return t('为 {name} 授权', { name })
  if (kind === 'drop') return t('删除用户 {name}', { name })
  if (kind === 'revoke') return t('撤销 {name} 的权限', { name })
  return ''
})

const dangerous = computed(
  () => state.dialog?.kind === 'drop' || state.dialog?.kind === 'revoke'
)

/** 授权范围的简短描述 */
function scopeLabel(scope: GrantScope): string {
  const join = (...parts: (string | undefined)[]): string =>
    parts.filter(Boolean).join('.')
  if (scope.level === 'global') return t('全局')
  if (scope.level === 'role') return t('角色 {role}', { role: scope.role ?? '' })
  if (scope.level === 'database')
    return isMysql.value ? `${scope.database}.*` : t('数据库 {name}', { name: scope.database ?? '' })
  if (scope.level === 'schema') return t('模式 {name}', { name: scope.schema ?? '' })
  return isMysql.value
    ? join(scope.database, scope.table)
    : join(scope.schema, scope.table)
}
</script>

<template>
  <Transition
    name="fade"
    appear
  >
    <div class="bg-window glass absolute inset-0 z-50 flex flex-col">
      <header
        class="border-line-soft flex h-10 shrink-0 items-center gap-2 border-b px-3"
      >
        <AppIcon
          name="lucide:users"
          :size="15"
          class="text-accent"
        />
        <span class="text-txt text-[12.5px] font-medium">{{
          t('用户与权限')
        }}</span>
        <span class="text-txt-4 truncate font-mono text-[11px]">{{
          connectionName
        }}</span>
        <span class="flex-1" />
        <AppButton
          size="sm"
          variant="primary"
          @click="openCreate"
        >
          <AppIcon
            name="lucide:user-plus"
            :size="13"
          />
          {{ t('新建用户') }}
        </AppButton>
        <IconButton
          icon="lucide:refresh-cw"
          :size="14"
          :title="t('刷新')"
          :disabled="state.loading"
          @click="loadAccounts"
        />
        <IconButton
          icon="lucide:x"
          :size="15"
          :title="t('关闭')"
          @click="emit('close')"
        />
      </header>

      <div
        v-if="state.notice || state.error"
        :class="
          cn(
            'flex shrink-0 items-start gap-2 border-b px-3 py-2 text-[11.5px]',
            state.error
              ? 'border-danger/25 bg-danger/8 text-danger'
              : 'border-amber/25 bg-amber/8 text-amber'
          )
        "
      >
        <AppIcon
          :name="state.error ? 'lucide:circle-x' : 'lucide:shield-alert'"
          :size="13"
          class="mt-px shrink-0"
        />
        <span class="min-w-0 flex-1 leading-4">{{
          state.error || state.notice
        }}</span>
      </div>

      <div class="flex min-h-0 flex-1">
        <!-- 账号列表 -->
        <aside class="border-line-soft flex w-64 shrink-0 flex-col border-r">
          <div class="p-2">
            <SearchField
              v-model="state.keyword"
              :placeholder="t('搜索用户…')"
            />
          </div>
          <div
            v-if="state.loading && !state.accounts.length"
            class="px-3"
          >
            <AppSkeleton :rows="6" />
          </div>
          <div
            v-else
            :class="
              cn(
                'scroll-thin min-h-0 flex-1 overflow-y-auto px-1.5 pb-2',
                state.loading && 'stale-dim'
              )
            "
          >
            <button
              v-for="account in filteredAccounts"
              :key="accountKey(account)"
              type="button"
              :class="
                cn(
                  'row-item w-full items-start text-left',
                  state.selectedKey === accountKey(account) && 'bg-raised'
                )
              "
              @click="selectAccount(account)"
            >
              <AppIcon
                :name="
                  account.attributes.some(item => /super/i.test(item))
                    ? 'lucide:shield-user'
                    : 'lucide:user-round'
                "
                :size="14"
                class="text-txt-3 mt-0.5 shrink-0"
              />
              <span class="min-w-0 flex-1">
                <span class="text-txt-2 block truncate text-xs">
                  {{ account.name
                  }}<span
                    v-if="account.host"
                    class="text-txt-4 font-mono text-[10.5px]"
                    >@{{ account.host }}</span
                  >
                </span>
                <span
                  v-if="account.attributes.length"
                  class="text-txt-4 block truncate text-[10px]"
                  >{{ account.attributes.join(' · ') }}</span
                >
              </span>
            </button>
            <p
              v-if="!filteredAccounts.length"
              class="text-txt-4 py-6 text-center text-xs"
            >
              {{ t('没有匹配的用户') }}
            </p>
          </div>
        </aside>

        <!-- 账号详情与授权 -->
        <section class="flex min-w-0 flex-1 flex-col">
          <AppEmptyState
            v-if="!selected"
            icon="lucide:users"
            :title="t('选择一个用户')"
            :description="t('查看其授权，或修改密码、授予与撤销权限')"
          />
          <template v-else>
            <div
              class="border-line-soft flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3"
            >
              <div class="min-w-0 flex-1">
                <h3 class="text-txt truncate text-[13px] font-medium">
                  {{ accountLabel(selected) }}
                </h3>
                <div class="mt-1 flex flex-wrap gap-1">
                  <span
                    v-for="attribute in selected.attributes"
                    :key="attribute"
                    class="bg-raised text-txt-3 rounded px-1.5 text-[10px]"
                    >{{ attribute }}</span
                  >
                  <span
                    v-for="role in selected.memberOf"
                    :key="role"
                    class="bg-accent/10 text-accent rounded px-1.5 text-[10px]"
                    >{{ t('成员：{role}', { role }) }}</span
                  >
                </div>
              </div>
              <AppButton
                size="sm"
                @click="openPassword"
              >
                <AppIcon
                  name="lucide:key-round"
                  :size="13"
                />
                {{ t('修改密码') }}
              </AppButton>
              <AppButton
                size="sm"
                @click="openGrant"
              >
                <AppIcon
                  name="lucide:shield-plus"
                  :size="13"
                />
                {{ t('授予权限') }}
              </AppButton>
              <AppButton
                size="sm"
                variant="danger"
                @click="askDrop"
              >
                <AppIcon
                  name="lucide:user-x"
                  :size="13"
                />
                {{ t('删除用户') }}
              </AppButton>
            </div>

            <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <p class="group-label mb-2 px-0">{{ t('授权') }}</p>
              <AppSkeleton
                v-if="state.grantsLoading && !state.grants.length"
                :rows="4"
              />
              <p
                v-else-if="state.grantsError"
                class="text-danger text-[11.5px]"
              >
                {{ state.grantsError }}
              </p>
              <p
                v-else-if="!state.grants.length"
                class="text-txt-4 text-xs"
              >
                {{ t('没有显式授权') }}
              </p>
              <ul
                v-else
                :class="cn('space-y-1.5', state.grantsLoading && 'stale-dim')"
              >
                <li
                  v-for="(entry, index) in state.grants"
                  :key="`${index}-${entry.sql}`"
                  class="border-line-soft bg-raised/40 group flex items-start gap-3 rounded-md border px-3 py-2"
                >
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-1">
                      <span
                        v-if="entry.scope"
                        class="text-txt-2 mr-1 font-mono text-[11px]"
                        >{{ scopeLabel(entry.scope) }}</span
                      >
                      <span
                        v-for="privilege in entry.privileges"
                        :key="privilege"
                        class="bg-success/10 text-success rounded px-1.5 text-[10px]"
                        >{{ privilege }}</span
                      >
                    </div>
                    <p
                      class="text-txt-4 mt-1 font-mono text-[10.5px] break-all"
                    >
                      {{ entry.sql }}
                    </p>
                  </div>
                  <AppButton
                    v-if="entry.scope"
                    size="sm"
                    variant="ghost"
                    class="hover:text-danger shrink-0 opacity-70 group-hover:opacity-100"
                    @click="askRevoke(entry)"
                  >
                    {{ t('撤销') }}
                  </AppButton>
                </li>
              </ul>
            </div>
          </template>
        </section>
      </div>

      <!-- 操作对话框：先编辑，再预览 SQL，确认后执行 -->
      <AppDialog
        v-if="state.dialog"
        wide
        :title="dialogTitle"
        :description="
          state.dialog.step === 'preview'
            ? t('确认以下 SQL 后执行，密码已隐藏。')
            : ''
        "
        @close="state.dialog = null"
      >
        <template v-if="state.dialog.step === 'edit'">
          <div
            v-if="state.dialog.kind === 'create'"
            class="space-y-3"
          >
            <div class="flex gap-2">
              <div class="min-w-0 flex-1">
                <AppTextField
                  v-model="form.name"
                  :label="t('用户名')"
                  autofocus
                  autocomplete="off"
                />
              </div>
              <div
                v-if="isMysql"
                class="w-40"
              >
                <AppTextField
                  v-model="form.host"
                  :label="t('主机')"
                  placeholder="%"
                />
              </div>
            </div>
            <AppTextField
              v-model="form.password"
              type="password"
              :label="t('密码')"
              autocomplete="new-password"
            />
            <AppTextField
              v-model="form.passwordAgain"
              type="password"
              :label="t('确认密码')"
              autocomplete="new-password"
            />
            <AppSwitch
              v-if="!isMysql"
              v-model="form.login"
              :label="t('允许登录')"
              :description="t('关闭后只创建角色，可被授予给其他用户')"
            />
          </div>

          <div
            v-else-if="state.dialog.kind === 'password'"
            class="space-y-3"
          >
            <AppTextField
              v-model="form.password"
              type="password"
              :label="t('新密码')"
              autofocus
              autocomplete="new-password"
            />
            <AppTextField
              v-model="form.passwordAgain"
              type="password"
              :label="t('确认密码')"
              autocomplete="new-password"
            />
          </div>

          <div
            v-else-if="state.dialog.kind === 'grant'"
            class="space-y-3"
          >
            <div class="flex gap-2">
              <div class="w-36 shrink-0">
                <AppSelect
                  icon="lucide:layers"
                  v-model="form.level"
                  :label="t('级别')"
                  :options="levelOptions"
                />
              </div>
              <div
                v-if="
                  form.level === 'database' ||
                  (isMysql && form.level === 'table')
                "
                class="min-w-0 flex-1"
              >
                <AppSelect
                  icon="lucide:database"
                  v-if="databaseOptions.length"
                  v-model="form.database"
                  :label="t('数据库')"
                  :options="databaseOptions"
                  searchable
                />
                <AppTextField
                  v-else
                  v-model="form.database"
                  :label="t('数据库')"
                />
              </div>
              <div
                v-if="
                  !isMysql && (form.level === 'schema' || form.level === 'table')
                "
                class="min-w-0 flex-1"
              >
                <AppSelect
                  icon="lucide:folder-tree"
                  v-if="schemaOptions.length"
                  v-model="form.schema"
                  :label="t('模式')"
                  :options="schemaOptions"
                  searchable
                />
                <AppTextField
                  v-else
                  v-model="form.schema"
                  :label="t('模式')"
                />
              </div>
              <div
                v-if="form.level === 'table'"
                class="min-w-0 flex-1"
              >
                <AppSelect
                  icon="lucide:table-2"
                  v-if="tableOptions.length"
                  v-model="form.table"
                  :label="t('表')"
                  :options="tableOptions"
                  searchable
                />
                <AppTextField
                  v-else
                  v-model="form.table"
                  :label="t('表')"
                />
              </div>
              <div
                v-if="form.level === 'role'"
                class="min-w-0 flex-1"
              >
                <AppSelect
                  icon="lucide:users"
                  v-model="form.role"
                  :label="t('角色')"
                  :options="roleOptions"
                  searchable
                />
              </div>
            </div>

            <template v-if="form.level !== 'role'">
              <AppCheckbox
                v-model="form.allPrivileges"
                :label="t('全部权限（ALL PRIVILEGES）')"
              />
              <div
                :class="
                  cn(
                    'flex flex-wrap gap-1.5 transition-opacity duration-150 motion-reduce:transition-none',
                    form.allPrivileges && 'pointer-events-none opacity-40'
                  )
                "
              >
                <button
                  v-for="privilege in privilegeChoices"
                  :key="privilege"
                  type="button"
                  :aria-pressed="form.privileges.includes(privilege)"
                  :class="
                    cn(
                      'border-line rounded-md border px-2 py-1 font-mono text-[10.5px] transition-colors duration-100 motion-reduce:transition-none',
                      form.privileges.includes(privilege)
                        ? 'border-accent/50 bg-accent/12 text-accent'
                        : 'text-txt-3 hover:bg-hover hover:text-txt'
                    )
                  "
                  @click="togglePrivilege(privilege)"
                >
                  {{ privilege }}
                </button>
              </div>
              <AppCheckbox
                v-model="form.withGrantOption"
                :label="t('允许转授（WITH GRANT OPTION）')"
              />
            </template>
            <p
              v-else
              class="text-txt-3 text-[11px]"
            >
              {{ t('把所选角色授予该用户，用户将继承该角色的全部权限。') }}
            </p>
          </div>
        </template>

        <template v-else>
          <p
            v-if="dangerous"
            class="border-danger/25 bg-danger/8 text-danger mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[11.5px]"
          >
            <AppIcon
              name="lucide:triangle-alert"
              :size="13"
              class="mt-px shrink-0"
            />
            {{
              state.dialog.kind === 'drop'
                ? t('删除后该用户将无法登录，其授权一并移除，且无法撤销。')
                : t('撤销后该用户将立即失去这些权限。')
            }}
          </p>
          <pre
            class="bg-raised text-txt-2 scroll-thin max-h-72 overflow-auto rounded-md px-3 py-2 font-mono text-[11.5px] leading-5 break-all whitespace-pre-wrap"
            >{{ state.dialog.statements.map(sql => `${sql};`).join('\n') }}</pre
          >
        </template>

        <template #footer>
          <span class="flex-1" />
          <AppButton
            size="sm"
            @click="state.dialog = null"
          >
            {{ t('取消') }}
          </AppButton>
          <AppButton
            v-if="
              state.dialog.step === 'preview' &&
              !['drop', 'revoke'].includes(state.dialog.kind)
            "
            size="sm"
            :disabled="state.dialog.busy"
            @click="state.dialog.step = 'edit'"
          >
            {{ t('上一步') }}
          </AppButton>
          <AppButton
            v-if="state.dialog.step === 'edit'"
            size="sm"
            variant="primary"
            :disabled="state.dialog.busy"
            @click="next"
          >
            {{ t('预览 SQL') }}
          </AppButton>
          <AppButton
            v-else
            size="sm"
            :variant="dangerous ? 'danger' : 'primary'"
            :disabled="state.dialog.busy"
            @click="apply"
          >
            {{ dangerous ? t('确认执行') : t('执行') }}
          </AppButton>
        </template>
      </AppDialog>
    </div>
  </Transition>
</template>
