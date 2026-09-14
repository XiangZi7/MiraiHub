; Extend Tauri's existing uninstall entry. SHCTX follows the install mode;
; Tauri removes this entire entry during uninstall.
!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "${UNINSTKEY}" "Comments" "MiraiHub - 一站式服务器与开发基础设施工作台"
  WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}/issues"
  WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}/releases/latest"
!macroend
