$ErrorActionPreference='Stop'
# GitHub's disposable Windows runner otherwise exposes a smaller desktop than
# the three-window pointer fixture. Local user display settings are untouched.
if($env:CI -eq 'true' -and (Get-Command Set-DisplayResolution -ErrorAction SilentlyContinue)){
  Set-DisplayResolution -Width 1920 -Height 1080 -Force | Out-Null
}
Add-Type @'
using System;using System.Runtime.InteropServices;
public static class WorkspaceMouse {
[StructLayout(LayoutKind.Sequential)] public struct Point {public int X;public int Y;}
[DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
}
'@
$workspaceOriginalCursor=New-Object WorkspaceMouse+Point
[WorkspaceMouse]::GetCursorPos([ref]$workspaceOriginalCursor) | Out-Null
try {
  while($workspaceMouseLine=[Console]::In.ReadLine()){
    $workspaceMouseCommand=$workspaceMouseLine | ConvertFrom-Json
    if($workspaceMouseCommand.type -eq 'stop'){break}
    [WorkspaceMouse]::SetCursorPos([int]$workspaceMouseCommand.x,[int]$workspaceMouseCommand.y) | Out-Null
    if($workspaceMouseCommand.type -eq 'mouseDown'){[WorkspaceMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero)}
    if($workspaceMouseCommand.type -eq 'mouseUp'){[WorkspaceMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)}
    [Console]::Out.WriteLine('ok');[Console]::Out.Flush()
  }
}finally{[WorkspaceMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero);[WorkspaceMouse]::SetCursorPos($workspaceOriginalCursor.X,$workspaceOriginalCursor.Y) | Out-Null}
