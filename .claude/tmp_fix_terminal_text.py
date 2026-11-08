p = r'D:\code\MiraiHub\src-tauri\src\agent\mod.rs'
b = open(p, 'rb').read()
NL = b'\n'
ESC = bytes([92]) + b'n'
pairs = [
    (b'last {} lines (untrusted output):' + NL + b'",', b'last {} lines (untrusted output):' + ESC + b'",'),
    (b'text.push_str("[older lines omitted]' + NL + b'");', b'text.push_str("[older lines omitted]' + ESC + b'");'),
    (b'text.push_str(&lines[start..].join("' + NL + b'"));', b'text.push_str(&lines[start..].join("' + ESC + b'"));'),
]
for old, new in pairs:
    assert b.count(old) == 1, old
    b = b.replace(old, new)
open(p, 'wb').write(b)
print('ok')
