param([string[]]$IpAddress = @())

$ErrorActionPreference = 'Stop'
$certificateDirectory = Join-Path $PSScriptRoot '..\.sites-runtime\https'
$certificateDirectory = [IO.Path]::GetFullPath($certificateDirectory)
$pfxPath = Join-Path $certificateDirectory 'localhost.pfx'
if (Test-Path -LiteralPath $pfxPath) {
    Write-Output 'Local HTTPS certificate already exists.'
    exit 0
}

$addresses = @('127.0.0.1', '::1') + $IpAddress | Select-Object -Unique
foreach ($address in $addresses) {
    $parsedAddress = [System.Net.IPAddress]::Parse($address)
    if ($parsedAddress.ToString() -ne $address) {
        throw "Use a canonical IP address: $address"
    }
}

New-Item -ItemType Directory -Path $certificateDirectory -Force | Out-Null
# Only this Windows user may read the exported private key/password.
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetOwner($identity)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'
)
$acl.AddAccessRule($rule)
Set-Acl -LiteralPath $certificateDirectory -AclObject $acl

$san = '2.5.29.17={text}DNS=localhost'
foreach ($address in $addresses) { $san += '&IPAddress=' + $address }
$certificate = New-SelfSignedCertificate -Type Custom -Subject 'CN=localhost' `
    -FriendlyName 'SYNDICATE local HTTPS (server only)' `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 `
    -KeyExportPolicy Exportable -KeyUsage DigitalSignature,KeyEncipherment `
    -NotAfter (Get-Date).AddDays(180) `
    -TextExtension @($san, '2.5.29.37={text}1.3.6.1.5.5.7.3.1', '2.5.29.19={critical}{text}ca=0')

$passwordBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($passwordBytes) } finally { $rng.Dispose() }
$password = [Convert]::ToBase64String($passwordBytes)
$securePassword = ConvertTo-SecureString -String $password -AsPlainText -Force
Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $securePassword `
    -CryptoAlgorithmOption AES256_SHA256 | Out-Null
[IO.File]::WriteAllText((Join-Path $certificateDirectory 'password.txt'), $password)
$publicPath = Join-Path $certificateDirectory 'localhost.cer'
Export-Certificate -Cert $certificate -FilePath $publicPath | Out-Null
# Trust only this server certificate, only for the current Windows user.
Import-Certificate -FilePath $publicPath -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
Write-Output "Local HTTPS ready. Certificate expires $($certificate.NotAfter.ToString('yyyy-MM-dd'))."
Write-Output ('Certificate addresses: localhost, ' + ($addresses -join ', '))
