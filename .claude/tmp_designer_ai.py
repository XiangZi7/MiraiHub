p = 'src/components/workspace/database/DatabaseTableDesigner.vue'
s = open(p, encoding='utf-8').read()


def rep(a, b):
    global s
    assert s.count(a) == 1, a
    s = s.replace(a, b)


rep("import AppSelect from '@/components/ui/AppSelect.vue'\n",
    "import AppSelect from '@/components/ui/AppSelect.vue'\nimport AppContextMenu from '@/components/ui/AppContextMenu.vue'\nimport AppTextarea from '@/components/ui/AppTextarea.vue'\nimport { useDatabaseAi } from '@/composables/useDatabaseAi'\n")
rep("  TableDesignerIndex,\n  ReferentialAction,", "  TableDesignerIndex,\n  TableIndexKind,\n  ReferentialAction,")
anchor = "    applying.value\n)\n</script>"
add = open('.claude/tmp_designer_ai.ts', encoding='utf-8').read()
rep(anchor, "    applying.value\n)\n" + add + "</script>")
open(p, 'w', encoding='utf-8').write(s)
