param([Parameter(Mandatory=$true)][string]$TargetPids)
$ErrorActionPreference = 'Stop'
# Restrict counters to the benchmark's own application processes.
$memoryTaskIds = @($TargetPids.Split(',') | ForEach-Object {
  $number = [int]$_
  if ($number -le 0) { throw 'Invalid process ID.' }
  $number
})
$memoryTaskFilter = ($memoryTaskIds | ForEach-Object { 'IDProcess = ' + $_ }) -join ' OR '
@(Get-CimInstance -ClassName Win32_PerfRawData_PerfProc_Process -Filter $memoryTaskFilter |
  Select-Object IDProcess,WorkingSetPrivate) | ConvertTo-Json -Compress
