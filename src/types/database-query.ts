export interface SavedDatabaseQuery {
  id: string
  connectionId: string
  database: string
  name: string
  sql: string
  createdAt: number
  updatedAt: number
}

export interface PersistedDatabaseQueryTab {
  id: string
  label: string
  sql: string
  database: string
  savedQueryId: string | null
}

export interface PersistedDatabaseQueryWorkspace {
  activeId: string
  tabs: PersistedDatabaseQueryTab[]
}
