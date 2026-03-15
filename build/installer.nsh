; Claude Meter - Dark oneClick installer
; Minimal UI: just a brief progress dialog, then the app launches

!include WinMessages.nsh

!macro customHeader
  ; Dark background for the instfiles progress page
  !ifdef MUI_BGCOLOR
    !undef MUI_BGCOLOR
  !endif
  !define MUI_BGCOLOR "0C0C12"

  !ifdef MUI_TEXTCOLOR
    !undef MUI_TEXTCOLOR
  !endif
  !define MUI_TEXTCOLOR "E2E2F0"

  !ifdef MUI_INSTFILESPAGE_COLORS
    !undef MUI_INSTFILESPAGE_COLORS
  !endif
  !define MUI_INSTFILESPAGE_COLORS "E2E2F0 13131D"

  ; Remove header image
  !ifdef MUI_HEADERIMAGE
    !undef MUI_HEADERIMAGE
  !endif
!macroend

!macro customInit
  ; Enable dark title bar
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'

  ; Dark window background
  System::Call 'gdi32::CreateSolidBrush(i 0x00120C0C) p .r1'
  System::Call 'user32::SetClassLongPtr(p $HWNDPARENT, i -10, p r1) p .r2'
  ${If} $2 != 0
    System::Call 'gdi32::DeleteObject(p r2)'
  ${EndIf}

  ; Hide white header area elements
  GetDlgItem $0 $HWNDPARENT 1034
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1036
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1037
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1038
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1044
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1045
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1046
  ShowWindow $0 ${SW_HIDE}

  ; Hide separator line
  GetDlgItem $0 $HWNDPARENT 1035
  ShowWindow $0 ${SW_HIDE}

  ; Dark branding text
  GetDlgItem $0 $HWNDPARENT 1028
  SetCtlColors $0 "2A2A3D" "0C0C12"

  System::Call 'user32::RedrawWindow(p $HWNDPARENT, p 0, p 0, i 0x0085)'
!macroend

; ===================================================================
; Override the built-in app-running check to silently force-kill
; instead of showing the generic Windows "is running" dialog
; ===================================================================
!macro customCheckAppRunning
  nsExec::Exec 'taskkill /F /IM "${PRODUCT_FILENAME}.exe"'
  Sleep 1000
!macroend
