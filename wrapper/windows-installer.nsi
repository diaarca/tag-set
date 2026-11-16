Unicode true
RequestExecutionLevel user
!include "MUI2.nsh"

Name "Setwise"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Setwise"
InstallDirRegKey HKCU "Software\Setwise" "InstallDir"
SetCompressor /SOLID lzma

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
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\Setwise.lnk" "$INSTDIR\Setwise.exe"
  WriteRegStr HKCU "Software\Setwise" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise" "DisplayName" "Setwise"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\Setwise.lnk"
  DeleteRegKey HKCU "Software\Setwise"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Setwise"
SectionEnd
