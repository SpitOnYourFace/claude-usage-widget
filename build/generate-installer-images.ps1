Add-Type -AssemblyName System.Drawing

$buildDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# --- Color palette (matches app CSS variables) ---
$bgColor       = [System.Drawing.Color]::FromArgb(12, 12, 18)      # #0c0c12
$surfaceColor  = [System.Drawing.Color]::FromArgb(19, 19, 29)      # #13131d
$surface2Color = [System.Drawing.Color]::FromArgb(27, 27, 40)      # #1b1b28
$borderColor   = [System.Drawing.Color]::FromArgb(42, 42, 61)      # #2a2a3d
$textColor     = [System.Drawing.Color]::FromArgb(226, 226, 240)   # #e2e2f0
$textDimColor  = [System.Drawing.Color]::FromArgb(126, 126, 152)   # #7e7e98
$accentColor   = [System.Drawing.Color]::FromArgb(212, 132, 90)    # #d4845a
$accentDark    = [System.Drawing.Color]::FromArgb(192, 106, 58)    # #c06a3a
$barFillColor  = [System.Drawing.Color]::FromArgb(124, 124, 186)   # #7c7cba
$greenColor    = [System.Drawing.Color]::FromArgb(74, 222, 128)    # #4ade80
$barBgColor    = [System.Drawing.Color]::FromArgb(37, 37, 56)      # #252538

# =============================================================
# SIDEBAR BITMAP — 164 x 314 (Welcome/Finish pages)
# =============================================================
$sw = 164
$sh = 314
$sidebar = New-Object System.Drawing.Bitmap($sw, $sh)
$sg = [System.Drawing.Graphics]::FromImage($sidebar)
$sg.SmoothingMode = 'AntiAlias'
$sg.TextRenderingHint = 'AntiAliasGridFit'

# Background gradient
$gradBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point(0, $sh)),
    $bgColor, $surface2Color
)
$sg.FillRectangle($gradBrush, 0, 0, $sw, $sh)

# Right edge accent stripe (3px)
$accentBrush = New-Object System.Drawing.SolidBrush($accentColor)
$sg.FillRectangle($accentBrush, ($sw - 3), 0, 3, $sh)

# Subtle border line next to accent
$borderBrush = New-Object System.Drawing.SolidBrush($borderColor)
$sg.FillRectangle($borderBrush, ($sw - 4), 0, 1, $sh)

# --- Decorative gauge arc (centered, upper area) ---
$gaugeCx = 82
$gaugeCy = 90
$gaugeR = 38
$pen1 = New-Object System.Drawing.Pen($barBgColor, 5)
$pen1.StartCap = 'Round'
$pen1.EndCap = 'Round'
$sg.DrawArc($pen1, ($gaugeCx - $gaugeR), ($gaugeCy - $gaugeR), ($gaugeR * 2), ($gaugeR * 2), 180, 180)

# Green arc (usage indicator — ~65%)
$pen2 = New-Object System.Drawing.Pen($greenColor, 5)
$pen2.StartCap = 'Round'
$pen2.EndCap = 'Round'
$sg.DrawArc($pen2, ($gaugeCx - $gaugeR), ($gaugeCy - $gaugeR), ($gaugeR * 2), ($gaugeR * 2), 180, 117)

# Accent arc (warning zone)
$pen3 = New-Object System.Drawing.Pen($accentColor, 5)
$pen3.StartCap = 'Round'
$pen3.EndCap = 'Round'
$sg.DrawArc($pen3, ($gaugeCx - $gaugeR), ($gaugeCy - $gaugeR), ($gaugeR * 2), ($gaugeR * 2), 297, 30)

# Needle
$needlePen = New-Object System.Drawing.Pen($textColor, 2)
$needlePen.StartCap = 'Round'
$needlePen.EndCap = 'Round'
$needleAngle = 245 * [Math]::PI / 180
$needleLen = 26
$nx = $gaugeCx + [Math]::Cos($needleAngle) * $needleLen
$ny = $gaugeCy + [Math]::Sin($needleAngle) * $needleLen
$sg.DrawLine($needlePen, $gaugeCx, $gaugeCy, [int]$nx, [int]$ny)

# Center dot
$dotBrush = New-Object System.Drawing.SolidBrush($accentColor)
$sg.FillEllipse($dotBrush, ($gaugeCx - 4), ($gaugeCy - 4), 8, 8)

# --- "Claude" text ---
$fontTitle = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$titleBrush = New-Object System.Drawing.SolidBrush($textColor)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = 'Center'
$sg.DrawString("Claude", $fontTitle, $titleBrush, ($sw / 2), 130, $sf)

# --- "Meter" text in accent ---
$fontSub = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$subBrush = New-Object System.Drawing.SolidBrush($accentColor)
$sg.DrawString("Meter", $fontSub, $subBrush, ($sw / 2), 158, $sf)

# --- Decorative mini bars (like usage bars) ---
$barY = 205
$barH = 6
$barMargin = 12
$barLeft = 22
$barRight = $sw - 30

# Bar 1 — full width, purple
$sg.FillRectangle((New-Object System.Drawing.SolidBrush($barBgColor)), $barLeft, $barY, ($barRight - $barLeft), $barH)
$sg.FillRectangle((New-Object System.Drawing.SolidBrush($barFillColor)), $barLeft, $barY, [int](($barRight - $barLeft) * 0.45), $barH)

# Bar 2
$barY2 = $barY + $barH + $barMargin
$sg.FillRectangle((New-Object System.Drawing.SolidBrush($barBgColor)), $barLeft, $barY2, ($barRight - $barLeft), $barH)
$sg.FillRectangle((New-Object System.Drawing.SolidBrush($greenColor)), $barLeft, $barY2, [int](($barRight - $barLeft) * 0.72), $barH)

# Bar 3
$barY3 = $barY2 + $barH + $barMargin
$sg.FillRectangle((New-Object System.Drawing.SolidBrush($barBgColor)), $barLeft, $barY3, ($barRight - $barLeft), $barH)
$sg.FillRectangle((New-Object System.Drawing.SolidBrush($accentColor)), $barLeft, $barY3, [int](($barRight - $barLeft) * 0.30), $barH)

# --- Bottom text ---
$fontSmall = New-Object System.Drawing.Font("Segoe UI", 8, [System.Drawing.FontStyle]::Regular)
$dimBrush = New-Object System.Drawing.SolidBrush($textDimColor)
$sg.DrawString("Real-time usage", $fontSmall, $dimBrush, ($sw / 2), 268, $sf)
$sg.DrawString("tracking", $fontSmall, $dimBrush, ($sw / 2), 282, $sf)

$sg.Dispose()
$sidebar.Save("$buildDir\installerSidebar.bmp", [System.Drawing.Imaging.ImageFormat]::Bmp)
$sidebar.Dispose()

Write-Host "Created installerSidebar.bmp (${sw}x${sh})"

# =============================================================
# HEADER BITMAP — 150 x 57 (Directory/Install pages)
# =============================================================
$hw = 150
$hh = 57
$header = New-Object System.Drawing.Bitmap($hw, $hh)
$hg = [System.Drawing.Graphics]::FromImage($header)
$hg.SmoothingMode = 'AntiAlias'
$hg.TextRenderingHint = 'AntiAliasGridFit'

# Background
$hg.Clear($surfaceColor)

# Bottom border
$hg.FillRectangle((New-Object System.Drawing.SolidBrush($borderColor)), 0, ($hh - 1), $hw, 1)

# Left accent stripe
$hg.FillRectangle($accentBrush, 0, 0, 4, $hh)

# Mini gauge icon
$iconCx = 28
$iconCy = 28
$iconR = 14
$thinPen1 = New-Object System.Drawing.Pen($barBgColor, 3)
$thinPen1.StartCap = 'Round'
$thinPen1.EndCap = 'Round'
$hg.DrawArc($thinPen1, ($iconCx - $iconR), ($iconCy - $iconR), ($iconR * 2), ($iconR * 2), 180, 180)
$thinPen2 = New-Object System.Drawing.Pen($greenColor, 3)
$thinPen2.StartCap = 'Round'
$thinPen2.EndCap = 'Round'
$hg.DrawArc($thinPen2, ($iconCx - $iconR), ($iconCy - $iconR), ($iconR * 2), ($iconR * 2), 180, 117)
# Needle
$hNeedlePen = New-Object System.Drawing.Pen($textColor, 1.5)
$hNeedleAngle = 245 * [Math]::PI / 180
$hNeedleLen = 10
$hnx = $iconCx + [Math]::Cos($hNeedleAngle) * $hNeedleLen
$hny = $iconCy + [Math]::Sin($hNeedleAngle) * $hNeedleLen
$hg.DrawLine($hNeedlePen, $iconCx, $iconCy, [int]$hnx, [int]$hny)
$hg.FillEllipse($dotBrush, ($iconCx - 2), ($iconCy - 2), 4, 4)

# "Claude Meter" text
$fontHeader = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
$hg.DrawString("Claude", $fontHeader, $titleBrush, 48, 12)
$fontHeaderAccent = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
# Measure "Claude" width to position "Meter" right after
$claudeSize = $hg.MeasureString("Claude ", $fontHeader)
$hg.DrawString("Meter", $fontHeaderAccent, $subBrush, (48 + $claudeSize.Width - 5), 12)

# Subtitle
$fontHeaderSm = New-Object System.Drawing.Font("Segoe UI", 7.5, [System.Drawing.FontStyle]::Regular)
$hg.DrawString("Usage tracking for Claude Pro/Max", $fontHeaderSm, $dimBrush, 48, 34)

$hg.Dispose()
$header.Save("$buildDir\installerHeader.bmp", [System.Drawing.Imaging.ImageFormat]::Bmp)
$header.Dispose()

Write-Host "Created installerHeader.bmp (${hw}x${hh})"

# =============================================================
# UNINSTALLER SIDEBAR — same as installer
# =============================================================
Copy-Item "$buildDir\installerSidebar.bmp" "$buildDir\uninstallerSidebar.bmp"
Write-Host "Created uninstallerSidebar.bmp (copy)"

Write-Host "Done - all installer bitmaps generated."
