Unicode true
RequestExecutionLevel user
!include "MUI2.nsh"

Name "TagSet"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\TagSet"
; Keep the installation identity so existing installs are upgraded.
InstallDirRegKey HKCU "Software\Setwise" "InstallDir"
SetCompressor /SOLID lzma
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${SOURCE_DIR}/*"
  Delete "$INSTDIR\Setwise.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  Delete "$SMPROGRAMS\Setwise.lnk"
  CreateShortcut "$SMPROGRAMS\TagSet.lnk" "$INSTDIR\TagSet.exe"
  WriteRegStr HKCU "Software\Setwise" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise" "DisplayName" "TagSet"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise" "DisplayIcon" "$INSTDIR\TagSet.exe,0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\Uninstall.exe"
  Delete "$INSTDIR\Setwise.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\TagSet.lnk"
  DeleteRegKey HKCU "Software\Setwise"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise"
SectionEnd
