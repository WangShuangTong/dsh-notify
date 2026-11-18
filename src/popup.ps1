param(
  [string]$Id = '',
  [string]$Kind = 'done',
  [string]$TitleB64 = '',
  [string]$BodyB64 = '',
  [string]$OpenLabelB64 = '',
  [string]$IgnoreLabelB64 = '',
  [int]$FocusPid = 0,
  [int]$AutoCloseMs = 15000,
  [int]$Sound = 1,
  [int]$Slot = 0,
  [string]$CapturePath = ''
)

# Topmost notification card. All user-visible text arrives Base64-encoded so
# this file stays ASCII and is parsed identically by Windows PowerShell 5.1.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

function Decode-Text([string]$value, [string]$fallback) {
  if ([string]::IsNullOrEmpty($value)) { return $fallback }
  try {
    return [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($value))
  } catch {
    return $fallback
  }
}

$Title = Decode-Text $TitleB64 'DSH'
$Body = Decode-Text $BodyB64 ''
$OpenLabel = Decode-Text $OpenLabelB64 'Open DSH'
$IgnoreLabel = Decode-Text $IgnoreLabelB64 'Dismiss'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class DshNotifyForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get {
      CreateParams cp = base.CreateParams;
      cp.ExStyle |= 0x08000000;
      return cp;
    }
  }
}

public class DshNotifyWin32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static bool FocusProcess(uint pid) {
    IntPtr visible = IntPtr.Zero;
    IntPtr hidden = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint p;
      GetWindowThreadProcessId(h, out p);
      if (p != pid || GetWindowTextLength(h) == 0) return true;
      if (IsWindowVisible(h)) { visible = h; return false; }
      if (hidden == IntPtr.Zero) hidden = h;
      return true;
    }, IntPtr.Zero);
    IntPtr target = visible != IntPtr.Zero ? visible : hidden;
    if (target == IntPtr.Zero) return false;
    ShowWindowAsync(target, IsIconic(target) ? 9 : 1);
    SetForegroundWindow(target);
    return true;
  }
}
"@ -ReferencedAssemblies System.Windows.Forms, System.Drawing

$form = New-Object DshNotifyForm
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::Dpi
$form.Size = New-Object System.Drawing.Size(430, 196)
$form.BackColor = [System.Drawing.Color]::FromArgb(30, 32, 38)
$form.ForeColor = [System.Drawing.Color]::White
$form.TopMost = $true
$form.ShowInTaskbar = $false

$workingArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$left = $workingArea.Right - $form.Width - 24
$top = $workingArea.Bottom - $form.Height - 24 - ($Slot * ($form.Height + 12))
$form.Location = New-Object System.Drawing.Point($left, $top)

$accent = New-Object System.Windows.Forms.Panel
$accent.Bounds = New-Object System.Drawing.Rectangle(0, 0, 4, $form.Height)
$accent.BackColor = [System.Drawing.Color]::FromArgb(77, 107, 254)
$form.Controls.Add($accent)

$titleLabel = New-Object System.Windows.Forms.Label
$titleLabel.Text = $Title
$titleLabel.AutoSize = $false
$titleLabel.Bounds = New-Object System.Drawing.Rectangle(20, 14, 390, 26)
$titleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$titleLabel.ForeColor = [System.Drawing.Color]::FromArgb(245, 247, 250)
$form.Controls.Add($titleLabel)

$bodyLabel = New-Object System.Windows.Forms.Label
$bodyLabel.Text = $Body
$bodyLabel.AutoSize = $false
$bodyLabel.AutoEllipsis = $true
$bodyLabel.Bounds = New-Object System.Drawing.Rectangle(20, 44, 390, 86)
$bodyLabel.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$bodyLabel.ForeColor = [System.Drawing.Color]::FromArgb(205, 210, 220)
$form.Controls.Add($bodyLabel)

$openButton = New-Object System.Windows.Forms.Button
$openButton.Text = $OpenLabel
$openButton.Bounds = New-Object System.Drawing.Rectangle(20, 142, 136, 36)
$openButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$openButton.BackColor = [System.Drawing.Color]::FromArgb(77, 107, 254)
$openButton.ForeColor = [System.Drawing.Color]::White
$openButton.FlatAppearance.BorderSize = 0
$form.Controls.Add($openButton)

$ignoreButton = New-Object System.Windows.Forms.Button
$ignoreButton.Text = $IgnoreLabel
$ignoreButton.Bounds = New-Object System.Drawing.Rectangle(166, 142, 96, 36)
$ignoreButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$ignoreButton.BackColor = [System.Drawing.Color]::FromArgb(45, 48, 56)
$ignoreButton.ForeColor = [System.Drawing.Color]::FromArgb(210, 214, 222)
$ignoreButton.FlatAppearance.BorderSize = 0
$form.Controls.Add($ignoreButton)

$closeButton = New-Object System.Windows.Forms.Button
$closeButton.Text = 'x'
$closeButton.Bounds = New-Object System.Drawing.Rectangle(396, 8, 24, 24)
$closeButton.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$closeButton.BackColor = [System.Drawing.Color]::FromArgb(30, 32, 38)
$closeButton.ForeColor = [System.Drawing.Color]::FromArgb(150, 156, 166)
$closeButton.FlatAppearance.BorderSize = 0
$form.Controls.Add($closeButton)

$openButton.Add_Click({
  try {
    if ($FocusPid -gt 0) {
      [void][DshNotifyWin32]::FocusProcess([uint32]$FocusPid)
    }
  } catch {
    # Focus is best effort; the activation record still opens the session.
  }
  [Console]::WriteLine("activate $Id")
  $form.Close()
})

$ignoreButton.Add_Click({
  [Console]::WriteLine("dismiss $Id")
  $form.Close()
})

$closeButton.Add_Click({
  [Console]::WriteLine("dismiss $Id")
  $form.Close()
})

if ($AutoCloseMs -gt 0) {
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = $AutoCloseMs
  $timer.Add_Tick({
    [Console]::WriteLine("timeout $Id")
    $form.Close()
  })
  $timer.Start()
}

if ($Sound -eq 1) {
  try {
    [System.Media.SystemSounds]::Asterisk.Play()
  } catch {
    # Sound is optional; a missing audio device must not block the card.
  }
}

# Optional off-screen render for documentation and tests: draw the real card
# into a PNG after it has painted, then close. Unused by normal notifications.
if (-not [string]::IsNullOrEmpty($CapturePath)) {
  $captureTimer = New-Object System.Windows.Forms.Timer
  $captureTimer.Interval = 1500
  $captureTimer.Add_Tick({
    $captureTimer.Stop()
    try {
      $form.Refresh()
      $bitmap = New-Object System.Drawing.Bitmap($form.Width, $form.Height)
      $form.DrawToBitmap($bitmap, (New-Object System.Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
      $bitmap.Save($CapturePath, [System.Drawing.Imaging.ImageFormat]::Png)
      $bitmap.Dispose()
      [Console]::WriteLine("captured $CapturePath")
    } catch {
      [Console]::WriteLine("capture-failed $($_.Exception.Message)")
    }
    $form.Close()
  })
  $captureTimer.Start()
}

[Console]::WriteLine('ready')
[System.Windows.Forms.Application]::Run($form)
[Console]::WriteLine('closed')
