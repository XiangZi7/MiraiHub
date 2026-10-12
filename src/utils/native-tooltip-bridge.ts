interface NativeTooltip {
  content: string
  label: string | null
}

/** 接管现有原生 title，保留空属性供 Vue 正常更新或移除，不改动组件的标题 prop。 */
export function startNativeTooltipBridge(
  root: HTMLElement,
  onChange: () => void
) {
  const entries = new Map<Element, NativeTooltip>()
  const options: MutationObserverInit = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title', 'data-tooltip'],
  }

  function clear(element: Element, restore = false): void {
    const previous = entries.get(element)
    if (!previous) return
    if (element.getAttribute('data-native-tooltip') === previous.content)
      element.removeAttribute('data-native-tooltip')
    if (previous.label && element.getAttribute('aria-label') === previous.label)
      element.removeAttribute('aria-label')
    if (restore && element.getAttribute('title') === '')
      element.setAttribute('title', previous.content)
    entries.delete(element)
  }

  function convert(element: Element, changed = false): void {
    if (!root.contains(element)) {
      clear(element, true)
      return
    }
    const title = element.getAttribute('title') ?? ''
    // Vue 移动已有节点时，已接管的空 title 仍代表原来的文案。
    if (!changed && entries.has(element) && title === '') return
    const content = title.trim()
    clear(element)
    if (!content) return

    const needsLabel =
      element.matches('button, a, [role="button"]') &&
      !element.hasAttribute('aria-label') &&
      !element.textContent?.trim()
    if (needsLabel) element.setAttribute('aria-label', content)
    entries.set(element, { content: title, label: needsLabel ? content : null })
    element.setAttribute('data-native-tooltip', title)
    element.setAttribute('title', '')
  }

  function collect(node: Node, targets: Set<Element>): void {
    if (!(node instanceof Element)) return
    if (node.hasAttribute('title') || entries.has(node)) targets.add(node)
    node.querySelectorAll('[title]').forEach(element => targets.add(element))
  }

  const observer = new MutationObserver(records => {
    const targets = new Set<Element>()
    const changedTitles = new Set<Element>()
    for (const record of records) {
      if (record.type === 'attributes' && record.attributeName === 'title') {
        targets.add(record.target as Element)
        changedTitles.add(record.target as Element)
      }
      for (const node of record.addedNodes) collect(node, targets)
      for (const node of record.removedNodes) collect(node, targets)
    }
    // 转换期间暂停观察，避免自己的 title 清空被误认为业务主动清空提示。
    observer.disconnect()
    targets.forEach(element => convert(element, changedTitles.has(element)))
    observer.observe(root, options)
    onChange()
  })

  const initial = new Set<Element>()
  collect(root, initial)
  initial.forEach(element => convert(element))
  observer.observe(root, options)

  return () => {
    observer.disconnect()
    for (const element of entries.keys()) clear(element, true)
  }
}
