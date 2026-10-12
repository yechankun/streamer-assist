param([switch]$SmokeTest,[switch]$CaptureSmokeTest,[string]$SessionDirectory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
Add-Type -ReferencedAssemblies @([AppDomain]::CurrentDomain.GetAssemblies() | Where-Object { !$_.IsDynamic -and $_.Location } | ForEach-Object Location) @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public class OAuthDemoHotkeys : NativeWindow, IDisposable {
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h,int id,uint mods,uint key);
  [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h,int id);
  public event Action<int> Pressed;
  public OAuthDemoHotkeys(IntPtr h) { AssignHandle(h); }
  public bool Register(int id,uint key) { return RegisterHotKey(Handle,id,0x4000,key); }
  protected override void WndProc(ref Message m) { if(m.Msg==0x312 && Pressed!=null) Pressed(m.WParam.ToInt32()); base.WndProc(ref m); }
  public void Dispose() { for(int i=1;i<=3;i++) UnregisterHotKey(Handle,i); ReleaseHandle(); }
}
public static class OAuthDemoDpi {
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
[void][OAuthDemoDpi]::SetThreadDpiAwarenessContext([IntPtr](-4))
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$demoRoot=Join-Path $projectRoot 'release/google-oauth-demo'
$sceneData=Get-Content -LiteralPath (Join-Path $demoRoot 'scenes.json') -Raw -Encoding utf8 | ConvertFrom-Json
$sessionRoot=if($SessionDirectory) { [IO.Path]::GetFullPath($SessionDirectory) } else { Join-Path $demoRoot ('session-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'-'+[Guid]::NewGuid().ToString('N').Substring(0,6)) }
if(!$sessionRoot.StartsWith([IO.Path]::GetFullPath($demoRoot)+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or
  ((Test-Path -LiteralPath $sessionRoot) -and ((Get-Item -LiteralPath $sessionRoot).Attributes -band [IO.FileAttributes]::ReparsePoint))) { throw '촬영 도구의 세션 폴더를 선택하세요.' }
[void][IO.Directory]::CreateDirectory((Join-Path $sessionRoot 'segments'))
$ffmpeg=Join-Path $demoRoot 'tools/ffmpeg.exe'
$node=(Get-Command node.exe -ErrorAction Stop).Source
$script:parts=[Collections.Generic.List[object]]::new()
$script:captureRegion=$null; $script:recordProcess=$null; $script:renderProcess=$null
$script:currentPart=$null; $script:currentScene=0; $script:sessionFinished=$false
if($SessionDirectory -and (Test-Path -LiteralPath (Join-Path $sessionRoot 'recording.json'))) {
  $saved=Get-Content -LiteralPath (Join-Path $sessionRoot 'recording.json') -Raw -Encoding utf8 | ConvertFrom-Json
  if($saved.testOnly) { throw '테스트 영상은 실제 촬영 세션으로 이어 찍을 수 없습니다.' }
  foreach($part in $saved.parts) { $script:parts.Add($part) }
  $script:captureRegion=$saved.region
}
$form=[Windows.Forms.Form]::new()
$form.Text='Google OAuth 데모 촬영'; $form.ClientSize=[Drawing.Size]::new(530,620)
$form.StartPosition='CenterScreen'; $form.Font=[Drawing.Font]::new('Malgun Gothic',10)
$form.FormBorderStyle='FixedDialog'; $form.MaximizeBox=$false
$form.BackColor=[Drawing.Color]::FromArgb(20,22,25); $form.ForeColor=[Drawing.Color]::WhiteSmoke
function Add-Label([string]$Text,[int]$Top,[int]$Height) {
  $item=[Windows.Forms.Label]::new(); $item.Text=$Text; $item.Location=[Drawing.Point]::new(18,$Top)
  $item.Size=[Drawing.Size]::new(494,$Height); $form.Controls.Add($item); return $item
}
function Add-Button([string]$Text,[int]$Left,[int]$Top,[int]$Width) {
  $item=[Windows.Forms.Button]::new(); $item.Text=$Text; $item.Location=[Drawing.Point]::new($Left,$Top)
  $item.Size=[Drawing.Size]::new($Width,40); $item.FlatStyle='Flat'; $item.BackColor=[Drawing.Color]::FromArgb(39,43,49)
  $form.Controls.Add($item); return $item
}
$heading=Add-Label '실제 Google 동의 · 실제 YouTube 방송 촬영' 16 32
$heading.Font=[Drawing.Font]::new('Malgun Gothic',12,[Drawing.FontStyle]::Bold)
$help=Add-Label "F6 시작/중지 · F7 다음 장면 · F8 영상 만들기`n비밀번호·인증 코드 입력 전 F6으로 녹화를 멈추세요.`n마이크·컴퓨터 소리는 녹음하지 않습니다." 55 72
$openApp=Add-Button '촬영용 앱 열기' 18 132 236
$choose=Add-Button '촬영 영역 선택' 266 132 246
$regionLabel=Add-Label '앱과 브라우저를 같은 영역에 두고, 이 제어 창은 영역 밖에 놓으세요.' 184 50
$list=[Windows.Forms.ComboBox]::new(); $list.DropDownStyle='DropDownList'
$list.Location=[Drawing.Point]::new(18,241); $list.Size=[Drawing.Size]::new(494,30)
foreach($scene in $sceneData.scenes) { [void]$list.Items.Add($scene.title) }; $list.SelectedIndex=0
$form.Controls.Add($list)
$instruction=Add-Label $sceneData.scenes[0].instruction 281 144
$instruction.ForeColor=[Drawing.Color]::FromArgb(205,217,230)
$status=Add-Label '대기 중 · 녹화는 직접 시작해야 합니다.' 433 48
$status.Font=[Drawing.Font]::new('Malgun Gothic',11,[Drawing.FontStyle]::Bold)
$toggle=Add-Button '녹화 시작 (F6)' 18 489 236
$next=Add-Button '다음 장면 (F7)' 266 489 246
$finish=Add-Button '녹화 종료 · 자막 영상 만들기 (F8)' 18 541 494
$folder=Add-Button '촬영 폴더 열기' 18 591 494; $folder.Height=24
$toggle.Enabled=$null -ne $script:captureRegion; $finish.Enabled=$script:parts.Count -gt 0
if($script:captureRegion) {
  $regionLabel.Text='이전 촬영 영역: '+$script:captureRegion.width+' × '+$script:captureRegion.height+' · F6으로 이어 찍습니다.'
  $status.Text='이전 세션 복원 · 녹화는 일시 중지 상태입니다.'
  if($script:parts.Count) { $choose.Enabled=$false }
}
function Save-Manifest {
  [ordered]@{ appVersion=(Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version;
    scope=$sceneData.scope; createdAt=[DateTime]::UtcNow.ToString('o'); region=$script:captureRegion;
    audioRecorded=$false; testOnly=[bool]$CaptureSmokeTest; parts=@($script:parts.ToArray()); actualApiSuccess='Requires video review' } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $sessionRoot 'recording.json') -Encoding utf8
}
function Stop-Part {
  if(!$script:recordProcess) { return }
  $process=$script:recordProcess
  if(!$process.HasExited) { $process.StandardInput.WriteLine('q'); $process.StandardInput.Flush() }
  if(!$process.WaitForExit(12000)) { $process.Kill(); throw '녹화 파일 저장이 지연됐습니다. 원본 폴더를 확인하세요.' }
  $script:recordProcess=$null; $toggle.Text='녹화 재개 (F6)'; $list.Enabled=$true
  if($process.ExitCode -ne 0) { throw '녹화를 완료하지 못했습니다. capture-error.log를 확인하세요.' }
  $script:parts.Add($script:currentPart); $script:currentPart=$null; Save-Manifest
  $finish.Enabled=$true; $status.Text='일시 중지 · 로그인 정보 입력은 지금 진행하세요.'
}
function Start-Part {
  if(!$script:captureRegion -or $script:recordProcess -or $script:sessionFinished -or $script:renderProcess) { return }
  $partNumber=$script:parts.Count+1
  do {
    $file='segment-'+$partNumber.ToString('000')+'.mp4'
    $destination=Join-Path (Join-Path $sessionRoot 'segments') $file
    $partNumber++
  } while(Test-Path -LiteralPath $destination)
  $info=[Diagnostics.ProcessStartInfo]::new(); $info.FileName=$ffmpeg; $info.UseShellExecute=$false
  $info.CreateNoWindow=$true; $info.RedirectStandardInput=$true; $info.RedirectStandardError=$true
  $arguments=@('-y','-hide_banner','-loglevel','warning','-thread_queue_size','1024','-f','gdigrab','-framerate','15','-draw_mouse','1',
    '-offset_x',[string]$script:captureRegion.x,'-offset_y',[string]$script:captureRegion.y,'-video_size',($script:captureRegion.width.ToString()+'x'+$script:captureRegion.height),
    '-i','desktop','-an','-c:v','libx264','-preset','ultrafast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',$destination)
  foreach($argument in $arguments) { $info.ArgumentList.Add($argument) }
  $process=[Diagnostics.Process]::new(); $process.StartInfo=$info
  [void]$process.Start()
  $script:captureErrorTask=$process.StandardError.ReadToEndAsync()
  $script:recordProcess=$process
  $script:currentPart=[ordered]@{ file=$file; scene=$sceneData.scenes[$list.SelectedIndex].id; startedAt=[DateTime]::UtcNow.ToString('o') }
  $script:partStart=Get-Date; $list.Enabled=$false; $choose.Enabled=$false
  $toggle.Text='녹화 일시 중지 (F6)'; $status.Text='녹화 중'; $finish.Enabled=$true
}
function Invoke-Safe([scriptblock]$Action) {
  try { & $Action } catch {
    $status.Text='중단 · '+$_.Exception.Message
    [void][Windows.Forms.MessageBox]::Show($form,$_.Exception.Message,'촬영 도구','OK','Warning')
  }
}
$toggle.Add_Click({ Invoke-Safe { if($script:recordProcess) { Stop-Part } else { Start-Part } } })
$list.Add_SelectedIndexChanged({ $script:currentScene=$list.SelectedIndex; $instruction.Text=$sceneData.scenes[$list.SelectedIndex].instruction })
$next.Add_Click({ Invoke-Safe {
  $wasRecording=$null -ne $script:recordProcess; if($wasRecording) { Stop-Part }
  if($list.SelectedIndex -lt $list.Items.Count-1) { $list.SelectedIndex++ }
  if($wasRecording) { Start-Part }
} })
$choose.Add_Click({ Invoke-Safe {
  $overlay=[Windows.Forms.Form]::new(); $overlay.FormBorderStyle='None'; $overlay.TopMost=$true
  $overlay.StartPosition='Manual'; $overlay.Bounds=[Windows.Forms.SystemInformation]::VirtualScreen
  $overlay.BackColor=[Drawing.Color]::Black; $overlay.Opacity=0.35; $overlay.Cursor=[Windows.Forms.Cursors]::Cross
  $overlay.KeyPreview=$true; $script:selection=$null; $script:selectionStart=$null
  $overlay.Add_MouseDown({ if($_.Button -eq 'Left') { $script:selectionStart=$_.Location } })
  $overlay.Add_MouseMove({ if($script:selectionStart) {
    $script:selection=[Drawing.Rectangle]::FromLTRB([Math]::Min($script:selectionStart.X,$_.X),[Math]::Min($script:selectionStart.Y,$_.Y),[Math]::Max($script:selectionStart.X,$_.X),[Math]::Max($script:selectionStart.Y,$_.Y)); $overlay.Invalidate()
  } })
  $overlay.Add_Paint({ if($script:selection) { $_.Graphics.DrawRectangle([Drawing.Pens]::Lime,$script:selection) } })
  $overlay.Add_MouseUp({ if($script:selection -and $script:selection.Width -ge 640 -and $script:selection.Height -ge 360) { $overlay.DialogResult='OK'; $overlay.Close() } })
  $overlay.Add_KeyDown({ if($_.KeyCode -eq 'Escape') { $overlay.DialogResult='Cancel'; $overlay.Close() } })
  if($overlay.ShowDialog($form) -eq 'OK') {
    $script:captureRegion=[ordered]@{ x=$overlay.Left+$script:selection.X; y=$overlay.Top+$script:selection.Y; width=$script:selection.Width-($script:selection.Width%2); height=$script:selection.Height-($script:selection.Height%2) }
    $regionLabel.Text='선택 영역: '+$script:captureRegion.width+' × '+$script:captureRegion.height+' · 앱/브라우저를 이 안에 둡니다.'
    $toggle.Enabled=$true; Save-Manifest
  }
  $overlay.Dispose()
} })
$openApp.Add_Click({ Invoke-Safe {
  $profile=Join-Path $sessionRoot 'profile'
  $info=[Diagnostics.ProcessStartInfo]::new(); $info.FileName=$node; $info.WorkingDirectory=$projectRoot
  $info.UseShellExecute=$false; $info.CreateNoWindow=$true
  $info.Environment['STREAMER_ASSIST_OAUTH_DEMO_PROFILE']=$profile
  $info.ArgumentList.Add((Join-Path $projectRoot 'node_modules/electron/cli.js'))
  $info.ArgumentList.Add((Join-Path $PSScriptRoot 'oauth-demo-app.cjs'))
  [void][Diagnostics.Process]::Start($info)
} })
$finish.Add_Click({ Invoke-Safe {
  if($script:recordProcess) { Stop-Part }
  if(!$script:parts.Count -or $script:renderProcess) { return }
  Save-Manifest; $toggle.Enabled=$false; $next.Enabled=$false; $finish.Enabled=$false; $list.Enabled=$false
  $script:renderProcess=Start-Process -FilePath $node -ArgumentList @(('"'+(Join-Path $PSScriptRoot 'finalize-oauth-demo.cjs')+'"'),('"'+$sessionRoot+'"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $sessionRoot 'render.log') -RedirectStandardError (Join-Path $sessionRoot 'render-error.log')
  $status.Text='영어 자막과 MP4를 만드는 중… 원본은 보존합니다.'
} })
$folder.Add_Click({ Start-Process -FilePath 'explorer.exe' -ArgumentList ('"'+$sessionRoot+'"') })
$timer=[Windows.Forms.Timer]::new(); $timer.Interval=500
$timer.Add_Tick({
  if($script:recordProcess) {
    if($script:recordProcess.HasExited) {
      $script:captureErrorTask.GetAwaiter().GetResult() | Set-Content -LiteralPath (Join-Path $sessionRoot 'capture-error.log') -Encoding utf8
      $script:recordProcess=$null; $toggle.Text='녹화 재개 (F6)'; $list.Enabled=$true
      $status.Text='녹화가 중단됐습니다. 오류 로그를 확인하세요.'
    } else { $elapsed=(Get-Date)-$script:partStart; $status.Text='녹화 중 · '+$elapsed.ToString('mm\:ss')+' · '+$sceneData.scenes[$list.SelectedIndex].title }
  }
  if($script:renderProcess -and $script:renderProcess.HasExited) {
    $script:renderProcess.Refresh(); $code=$script:renderProcess.ExitCode; $script:renderProcess=$null
    if($code -eq 0) { $script:sessionFinished=$true; $status.Text='영상 생성 완료 · MP4를 열어 실제 동작과 로그인 구간을 검토하세요.' }
    else { $status.Text='편집 실패 · 원본/자막은 보존됐습니다. render-error.log를 확인하세요.'; $finish.Enabled=$true }
  }
})
$timer.Start()
$form.Add_FormClosing({
  if($script:recordProcess -or $script:renderProcess) {
    $answer=[Windows.Forms.MessageBox]::Show($form,'녹화 또는 편집 중입니다. 이 창을 유지하고 완료 버튼을 사용하세요.','촬영 중','OK','Information')
    $_.Cancel=$true
  }
})
$form.Add_Shown({
  $script:hotkeys=[OAuthDemoHotkeys]::new($form.Handle)
  $ok=$script:hotkeys.Register(1,0x75) -and $script:hotkeys.Register(2,0x76) -and $script:hotkeys.Register(3,0x77)
  if(!$ok) { $help.Text+=' (다른 앱이 단축키를 사용하면 버튼으로 조작하세요.)' }
  # PerformClick checks focusability and ignores minimized parents. Invoke the
  # enabled control's Click handler directly so recording can always be paused.
  $script:hotkeys.add_Pressed({ param($id)
    $button=switch($id) { 1 {$toggle} 2 {$next} 3 {$finish} }
    if($button -and $button.Enabled) {
      $method=$button.GetType().GetMethod('OnClick',[Reflection.BindingFlags]'Instance,NonPublic')
      [void]$method.Invoke($button,@([EventArgs]::Empty))
    }
  })
})
try {
  if($SmokeTest -or $CaptureSmokeTest) {
    if($form.Controls.Count -ne 12 -or $list.Items.Count -ne 10 -or $toggle.Enabled) { throw 'Recorder control validation failed.' }
    $form.StartPosition='Manual'
    if($CaptureSmokeTest) { $form.Location=[Drawing.Point]::new(20,20); $form.TopMost=$true }
    else { $form.Location=[Drawing.Point]::new(-32000,-32000) }
    $form.Show(); [Windows.Forms.Application]::DoEvents()
    $bitmap=[Drawing.Bitmap]::new($form.Width,$form.Height)
    $form.DrawToBitmap($bitmap,[Drawing.Rectangle]::new(0,0,$form.Width,$form.Height))
    $bitmap.Save((Join-Path $demoRoot 'recorder-preview.png')); $bitmap.Dispose()
    if($CaptureSmokeTest) {
      # Capture only this tool's known client area, covering every recorded pixel.
      $position=$form.PointToScreen([Drawing.Point]::new(0,0))
      $script:captureRegion=[ordered]@{ x=$position.X; y=$position.Y; width=$form.ClientSize.Width-($form.ClientSize.Width%2); height=$form.ClientSize.Height-($form.ClientSize.Height%2) }
      foreach($chapter in @(0,1)) {
        $list.SelectedIndex=$chapter; Start-Part
        $until=[DateTime]::UtcNow.AddSeconds(2)
        while([DateTime]::UtcNow -lt $until) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 50 }
        Stop-Part
      }
      & $node (Join-Path $PSScriptRoot 'finalize-oauth-demo.cjs') $sessionRoot
      if($LASTEXITCODE -ne 0) { throw 'Recorder capture and caption verification failed.' }
      Set-Content -LiteralPath (Join-Path $demoRoot 'smoke-session.txt') -Value $sessionRoot -Encoding utf8
      Write-Output 'PASS: bounded tool-only screen capture, pause/resume, two segments and subtitle MP4. This is not submission footage.'
    }
    Write-Output 'PASS: recorder controls, ten real-action scenes, stopped by default, preview rendered.'
  } else { [void]$form.ShowDialog() }
} finally { $timer.Stop(); $timer.Dispose(); if($script:hotkeys) {$script:hotkeys.Dispose()}; $form.Dispose() }
