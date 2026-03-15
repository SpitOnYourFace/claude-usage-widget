; Claude Meter - Fully custom dark installer UI
; nsDialogs pages with dark title bar, custom buttons, no generic Windows look

!include nsDialogs.nsh
!include WinMessages.nsh

; --- Color constants (from app CSS) ---
!define CM_BG     "0C0C12"
!define CM_SURF   "13131D"
!define CM_SURF2  "1B1B28"
!define CM_BORDER "2A2A3D"
!define CM_TEXT   "E2E2F0"
!define CM_DIM    "7E7E98"
!define CM_ACCENT "D4845A"
!define CM_GREEN  "4ADE80"

Var welcomeDialog
Var finishDialog
Var launchCheckbox

!macro customHeader
  ; --- Dark backgrounds for any remaining MUI pages ---
  !ifdef MUI_BGCOLOR
    !undef MUI_BGCOLOR
  !endif
  !define MUI_BGCOLOR "${CM_BG}"

  !ifdef MUI_TEXTCOLOR
    !undef MUI_TEXTCOLOR
  !endif
  !define MUI_TEXTCOLOR "${CM_TEXT}"

  !ifdef MUI_INSTFILESPAGE_COLORS
    !undef MUI_INSTFILESPAGE_COLORS
  !endif
  !define MUI_INSTFILESPAGE_COLORS "${CM_TEXT} ${CM_SURF}"

  !ifndef MUI_ABORTWARNING
    !define MUI_ABORTWARNING
  !endif
  !ifdef MUI_ABORTWARNING_TEXT
    !undef MUI_ABORTWARNING_TEXT
  !endif
  !define MUI_ABORTWARNING_TEXT "Cancel Claude Meter installation?"
!macroend

; ===================================================================
; Enable dark title bar + dark window background
; ===================================================================
!macro EnableDarkFrame
  ; DWMWA_USE_IMMERSIVE_DARK_MODE = 20 (Windows 10 20H1+)
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'

  ; Set window class background brush to dark
  System::Call 'gdi32::CreateSolidBrush(i 0x00120C0C) p .r1'
  System::Call 'user32::SetClassLongPtr(p $HWNDPARENT, i -10, p r1) p .r2'
  ${If} $2 != 0
    System::Call 'gdi32::DeleteObject(p r2)'
  ${EndIf}

  ; Style navigation buttons to be less visible
  GetDlgItem $0 $HWNDPARENT 1
  SetCtlColors $0 "${CM_TEXT}" "${CM_SURF2}"
  GetDlgItem $0 $HWNDPARENT 2
  SetCtlColors $0 "${CM_DIM}" "${CM_SURF}"
  GetDlgItem $0 $HWNDPARENT 3
  SetCtlColors $0 "${CM_DIM}" "${CM_SURF}"

  ; Force redraw
  System::Call 'user32::RedrawWindow(p $HWNDPARENT, p 0, p 0, i 0x0085)'
!macroend

; ===================================================================
; CUSTOM WELCOME PAGE
; ===================================================================
!macro customWelcomePage
  Page custom welcomePageCreate welcomePageLeave
!macroend

Function welcomePageCreate
  !insertmacro EnableDarkFrame

  ; Rename "Next" to "Install" and hide Back
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Install"
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}

  nsDialogs::Create 1018
  Pop $welcomeDialog
  ${If} $welcomeDialog == error
    Abort
  ${EndIf}
  SetCtlColors $welcomeDialog "${CM_TEXT}" "${CM_BG}"

  ; --- App title ---
  ${NSD_CreateLabel} 0 28u 100% 24u "Claude Meter"
  Pop $0
  SetCtlColors $0 "${CM_TEXT}" "${CM_BG}"
  CreateFont $1 "Segoe UI" 20 700
  SendMessage $0 ${WM_SETFONT} $1 1
  ${NSD_AddStyle} $0 ${SS_CENTER}

  ; --- Version badge ---
  ${NSD_CreateLabel} 0 54u 100% 14u "v${VERSION}"
  Pop $0
  SetCtlColors $0 "${CM_ACCENT}" "${CM_BG}"
  CreateFont $1 "Segoe UI" 10 400
  SendMessage $0 ${WM_SETFONT} $1 1
  ${NSD_AddStyle} $0 ${SS_CENTER}

  ; --- Separator ---
  ${NSD_CreateLabel} 25% 76u 50% 1u ""
  Pop $0
  SetCtlColors $0 "" "${CM_BORDER}"

  ; --- Description ---
  ${NSD_CreateLabel} 10% 88u 80% 36u "Real-time usage tracking for Claude Pro && Max.$\r$\nLive countdowns, alerts, and a full dashboard."
  Pop $0
  SetCtlColors $0 "${CM_DIM}" "${CM_BG}"
  CreateFont $1 "Segoe UI" 9 400
  SendMessage $0 ${WM_SETFONT} $1 1
  ${NSD_AddStyle} $0 ${SS_CENTER}

  ; --- Install path ---
  ${NSD_CreateLabel} 5% 136u 90% 10u "Installing to: $INSTDIR"
  Pop $0
  SetCtlColors $0 "${CM_DIM}" "${CM_BG}"
  CreateFont $1 "Consolas" 7 400
  SendMessage $0 ${WM_SETFONT} $1 1
  ${NSD_AddStyle} $0 ${SS_CENTER}

  nsDialogs::Show
FunctionEnd

Function welcomePageLeave
FunctionEnd

; ===================================================================
; CUSTOM FINISH PAGE
; ===================================================================
!macro customFinishPage
  Page custom finishPageCreate finishPageLeave
!macroend

Function finishPageCreate
  !insertmacro EnableDarkFrame

  ; Rename button and hide Back/Cancel
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Finish"
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 2
  ShowWindow $0 ${SW_HIDE}

  nsDialogs::Create 1018
  Pop $finishDialog
  ${If} $finishDialog == error
    Abort
  ${EndIf}
  SetCtlColors $finishDialog "${CM_TEXT}" "${CM_BG}"

  ; --- Success title ---
  ${NSD_CreateLabel} 0 30u 100% 22u "Installation Complete"
  Pop $0
  SetCtlColors $0 "${CM_TEXT}" "${CM_BG}"
  CreateFont $1 "Segoe UI" 18 700
  SendMessage $0 ${WM_SETFONT} $1 1
  ${NSD_AddStyle} $0 ${SS_CENTER}

  ; --- Separator ---
  ${NSD_CreateLabel} 25% 60u 50% 1u ""
  Pop $0
  SetCtlColors $0 "" "${CM_BORDER}"

  ; --- Info text ---
  ${NSD_CreateLabel} 10% 72u 80% 36u "Claude Meter is ready. The widget will appear in your system tray.$\r$\nPress Ctrl+\ to toggle it anytime."
  Pop $0
  SetCtlColors $0 "${CM_DIM}" "${CM_BG}"
  CreateFont $1 "Segoe UI" 9 400
  SendMessage $0 ${WM_SETFONT} $1 1
  ${NSD_AddStyle} $0 ${SS_CENTER}

  ; --- Launch checkbox ---
  ${NSD_CreateCheckbox} 30% 120u 40% 14u " Launch Claude Meter"
  Pop $launchCheckbox
  SetCtlColors $launchCheckbox "${CM_TEXT}" "${CM_BG}"
  CreateFont $1 "Segoe UI" 9 400
  SendMessage $launchCheckbox ${WM_SETFONT} $1 1
  ${NSD_Check} $launchCheckbox

  nsDialogs::Show
FunctionEnd

Function finishPageLeave
  ${NSD_GetState} $launchCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    Exec '"$INSTDIR\${PRODUCT_FILENAME}.exe"'
  ${EndIf}
FunctionEnd

; ===================================================================
; INIT - Close running instances
; ===================================================================
!macro customInit
  FindWindow $0 "" "Claude Meter"
  ${If} $0 != 0
    System::Call 'user32::PostMessage(p $0, i ${WM_CLOSE}, p 0, p 0)'
    Sleep 2000
  ${EndIf}
!macroend
