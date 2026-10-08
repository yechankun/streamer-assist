param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$replayArchive=[IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($Archive))
try {
  $replayEntries=@($replayArchive.Entries | Where-Object { $_.Name -ceq 'TwitchDownloaderCLI.exe' })
  if($replayEntries.Count -ne 1 -or $replayEntries[0].Length -gt 256MB){throw 'Invalid TwitchDownloaderCLI archive.'}
  $replayDestination=[IO.Path]::GetFullPath($Target)
  if([IO.Path]::GetFileName($replayDestination) -cne 'TwitchDownloaderCLI.exe'){throw 'Invalid executable target.'}
  $replayInput=$replayEntries[0].Open();$replayOutput=[IO.File]::Create($replayDestination+'.tmp')
  try{$replayInput.CopyTo($replayOutput);$replayOutput.Flush($true)}finally{$replayOutput.Dispose();$replayInput.Dispose()}
  [IO.File]::Move($replayDestination+'.tmp',$replayDestination)
}finally{$replayArchive.Dispose()}
