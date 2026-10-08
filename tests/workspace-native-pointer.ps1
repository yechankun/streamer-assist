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
[StructLayout(LayoutKind.Sequential)] public struct MouseInput {public int X;public int Y;public uint Data;public uint Flags;public uint Time;public UIntPtr Extra;}
[StructLayout(LayoutKind.Sequential)] public struct Input {public uint Type;public MouseInput Mouse;}
[DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
[DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
[DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
[DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint count,Input[] inputs,int size);
public static void Send(int x,int y,uint flags) {
  int left=GetSystemMetrics(76),top=GetSystemMetrics(77),width=GetSystemMetrics(78),height=GetSystemMetrics(79);
  var input=new Input {Mouse=new MouseInput {
    X=(int)Math.Max(0,Math.Min(65535,Math.Floor((x-left+0.5)*65536/width))),
    Y=(int)Math.Max(0,Math.Min(65535,Math.Floor((y-top+0.5)*65536/height))),
    Flags=flags|0x8000|0x4000|0x2000|1
  }};
  if(SendInput(1,new[]{input},Marshal.SizeOf(typeof(Input)))!=1)
    throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
}
public static void Release() {
  var input=new Input {Mouse=new MouseInput {Flags=4}};
  SendInput(1,new[]{input},Marshal.SizeOf(typeof(Input)));
}
}
'@
[WorkspaceMouse]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
$workspaceOriginalCursor=New-Object WorkspaceMouse+Point
[WorkspaceMouse]::GetCursorPos([ref]$workspaceOriginalCursor) | Out-Null
try {
  while($workspaceMouseLine=[Console]::In.ReadLine()){
    $workspaceMouseCommand=$workspaceMouseLine | ConvertFrom-Json
    if($workspaceMouseCommand.type -eq 'stop'){break}
    # Coordinates and button changes enter the Windows input queue together.
    # SetCursorPos followed by a separate click can race queued cursor updates.
    $workspaceMouseFlags=0
    if($workspaceMouseCommand.type -eq 'mouseDown'){$workspaceMouseFlags=2}
    if($workspaceMouseCommand.type -eq 'mouseUp'){$workspaceMouseFlags=4}
    [WorkspaceMouse]::Send([int]$workspaceMouseCommand.x,[int]$workspaceMouseCommand.y,[uint32]$workspaceMouseFlags)
    [Console]::Out.WriteLine('ok');[Console]::Out.Flush()
  }
}finally{[WorkspaceMouse]::Release();[WorkspaceMouse]::SetCursorPos($workspaceOriginalCursor.X,$workspaceOriginalCursor.Y) | Out-Null}
