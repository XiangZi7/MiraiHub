import re, glob
files = ['src/utils/database-ddl.ts', 'src/components/workspace/database/DatabaseTableDesigner.vue'] + glob.glob('src/components/workspace/database/designer/*.vue')
keys = []
pat = re.compile(r"(?<![A-Za-z_])t\(\s*'([^']*)'")
for f in files:
    s = open(f, encoding='utf-8').read()
    for m in pat.finditer(s):
        k = m.group(1)
        if re.search('[一-鿿]', k) and k not in keys:
            keys.append(k)
alls = ''
for f in glob.glob('src/i18n/**/*.ts', recursive=True):
    alls += open(f, encoding='utf-8').read()
for k in keys:
    if ("'" + k + "'") not in alls and ('"' + k + '"') not in alls:
        print(k)
