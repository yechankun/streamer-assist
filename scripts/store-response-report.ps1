function ConvertTo-SafeStoreMessages {
  param([object[]]$Messages, [string]$AccessToken)
  foreach ($message in ($Messages | Where-Object { $_ })) {
    $text = [string]$message
    foreach ($secretName in @('MSSTORE_TENANT_ID', 'MSSTORE_CLIENT_ID', 'MSSTORE_CLIENT_SECRET')) {
      $secretValue = [Environment]::GetEnvironmentVariable($secretName)
      if ($secretValue) { $text = $text.Replace($secretValue, '[redacted]') }
    }
    if ($AccessToken) { $text = $text.Replace($AccessToken, '[token]') }
    $text = [regex]::Replace($text, 'https?://\S+', '[URL]')
    $text = [regex]::Replace($text, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]')
    $text = [regex]::Replace($text, '\b[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b|\b[0-9]{10,}\b', '[ID]')
    if ($text.Length -gt 1200) { $text = $text.Substring(0,1200) }
    $text
  }
}
