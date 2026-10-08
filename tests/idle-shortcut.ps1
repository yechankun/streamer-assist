$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class StreamerIdleShortcut {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
}
'@
$probeKeys = [byte[]]@(0x11,0x12,0x10,0x81)
for ($attempt = 0; $attempt -lt 100; $attempt++) {
  $held = @($probeKeys | Where-Object { ([StreamerIdleShortcut]::GetAsyncKeyState($_) -band 0x8000) -ne 0 })
  if (!$held.Count) { break }
  Start-Sleep -Milliseconds 10
}
if ($held.Count) { throw 'Release modifier keys before running the shortcut probe.' }
try {
  foreach ($key in $probeKeys) { [StreamerIdleShortcut]::keybd_event($key,0,0,[UIntPtr]::Zero) }
} finally {
  [Array]::Reverse($probeKeys)
  foreach ($key in $probeKeys) { [StreamerIdleShortcut]::keybd_event($key,0,2,[UIntPtr]::Zero) }
}
