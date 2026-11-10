param(
    [string]$ImageDirectory = (Join-Path $PSScriptRoot '../docs/images')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'readme-redactions.json') -Raw | ConvertFrom-Json
$maskColor = [System.Drawing.Color]::FromArgb(255, $manifest.color[0], $manifest.color[1], $manifest.color[2])

# 读取固定像素格式的完整缓冲区，用于验证只改动指定遮挡区域。
function Get-BitmapBytes([System.Drawing.Bitmap]$Bitmap) {
    $bounds = [System.Drawing.Rectangle]::new(0, 0, $Bitmap.Width, $Bitmap.Height)
    $data = $Bitmap.LockBits($bounds, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        if ($data.Stride -ne $Bitmap.Width * 4) { throw 'Unexpected bitmap stride' }
        $bytes = [byte[]]::new($data.Stride * $Bitmap.Height)
        [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
        return ,$bytes
    } finally {
        $Bitmap.UnlockBits($data)
    }
}

foreach ($entry in $manifest.images.PSObject.Properties) {
    $path = Join-Path $ImageDirectory $entry.Name
    $source = [System.Drawing.Bitmap]::new($path)
    $bitmap = $null
    $graphics = $null
    $brush = $null
    $temporary = "$path.redacted.png"
    try {
        if ($source.Width -ne $manifest.width -or $source.Height -ne $manifest.height) {
            throw "Image size changed; review redaction coordinates before processing $($entry.Name)"
        }
        $bounds = [System.Drawing.Rectangle]::new(0, 0, $source.Width, $source.Height)
        $bitmap = $source.Clone($bounds, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $source.Dispose()
        $source = $null
        $expected = Get-BitmapBytes $bitmap
        $regions = @($manifest.common) + @($entry.Value)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $brush = [System.Drawing.SolidBrush]::new($maskColor)

        foreach ($region in $regions) {
            $x, $y, $width, $height = $region.rect
            if ($x -lt 0 -or $y -lt 0 -or $width -le 0 -or $height -le 0 -or
                $x + $width -gt $bitmap.Width -or $y + $height -gt $bitmap.Height) {
                throw "Invalid redaction bounds in $($entry.Name)"
            }
            $graphics.FillRectangle($brush, [int]$x, [int]$y, [int]$width, [int]$height)
            $row = [byte[]]::new($width * 4)
            for ($pixel = 0; $pixel -lt $width; $pixel++) {
                $offset = $pixel * 4
                $row[$offset] = $maskColor.B
                $row[$offset + 1] = $maskColor.G
                $row[$offset + 2] = $maskColor.R
                $row[$offset + 3] = 255
            }
            for ($line = $y; $line -lt $y + $height; $line++) {
                [Array]::Copy($row, 0, $expected, ($line * $bitmap.Width + $x) * 4, $row.Length)
            }
        }
        $graphics.Dispose()
        $graphics = $null
        $actual = Get-BitmapBytes $bitmap
        $expectedHash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($expected))
        $actualHash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($actual))
        if ($expectedHash -ne $actualHash) { throw "Pixels outside redaction regions changed: $($entry.Name)" }

        $bitmap.Save($temporary, [System.Drawing.Imaging.ImageFormat]::Png)
        $bitmap.Dispose()
        $bitmap = $null
        $saved = [System.Drawing.Bitmap]::new($temporary)
        try {
            $savedHash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData((Get-BitmapBytes $saved)))
            if ($savedHash -ne $expectedHash) { throw "Saved PNG pixel verification failed: $($entry.Name)" }
        } finally {
            $saved.Dispose()
        }
        # 只用已校验的打码 PNG 替换原文件，不另存未脱敏备份。
        Move-Item -LiteralPath $temporary -Destination $path -Force
        Write-Output "$($entry.Name): $($regions.Count) opaque masks; other pixels unchanged"
    } finally {
        if ($null -ne $graphics) { $graphics.Dispose() }
        if ($null -ne $brush) { $brush.Dispose() }
        if ($null -ne $bitmap) { $bitmap.Dispose() }
        if ($null -ne $source) { $source.Dispose() }
    }
}
